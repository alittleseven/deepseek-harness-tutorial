# 第 3 章　插件与可逆副作用：Fiber 状态机与 effect

> **本章学习目标**（读完本章，你应该能够）：
> 1. 给出 fiber、epoch、effect、disposable 的规范定义（中英对照），并准确解释"可逆"的含义；
> 2. 说出 `ctx.effect` / `ctx.on` / `ctx.plugin` / `ctx.inject` 四种注册 API 的语义差异与共同归宿，并说明 `ctx.waterfall` / `ctx.serial` 为何不属于注册；
> 3. 用 epoch 依赖串推演"提供方卸载 ⇒ 依赖方连带卸载"，画出 PENDING → LOADING → ACTIVE → UNLOADING 的状态迁移；
> 4. 写出插件三种形态（函数 / `{ apply }` 对象 / Service 子类）归一为同一个 callback 的等价关系；
> 5. 借助反事实推演论证：为什么"每个注册都必须是 effect"是 Cordis 的底线纪律。
>
> **本章讲法**：机制/原理型——从一个反直觉的问题出发（"改一个配置就要重启进程？"），沿"fiber 怎么创建 → effect 怎么登记 → 状态怎么迁移 → 依赖怎么连带卸载"的因果链逐步推演，每一步都与源码逐句对照，最后做反事实推演收尾。

## 3.1 问题场景：改一个配置就要重启进程吗？

传统服务程序中，改一条配置、换一个实现，通常意味着：停进程 → 改文件 → 重启。重启的代价不只是几秒钟的阻塞：进程里所有内存状态（会话、连接、缓存）全部丢失，任何人都不愿意为一处文案改动付这种代价。

dsh 面对的正是这个问题，而且更尖锐：harness 的产品形态是"配置即插件树"——用户通过 `cordis.yml` 选择提供方、开关能力（第 5、6 章会展开）。如果每次改配置都要重启，那么"用配置替换产品的一部分"（第 1 章承诺的愿景）就名存实亡。Cordis 的答案是**热重载**：插件在运行中被卸载、再加载，进程不退出，其他插件不受影响。官方教程演示了全过程（`docs/cordis-tutorial/06-composition-and-hmr.zh.md:23-59`）：HMR（hot module replacement，热模块替换）插件监视文件，保存一个插件源文件后，日志立刻出现

```
hello from my first plugin
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

照理说这不算什么新鲜事——很多框架都支持热重载。真正的问题在于：**旧插件"撤干净"了吗？** 如果旧插件注册过事件监听器、提供过服务、开过定时器，而重载只换掉了函数体，那么新旧两份行为会同时存活：同一个事件被触发两次、同一个服务名出现两个实现、旧定时器在后台空转。更隐蔽的是**引用悬空**：消费方拿到了旧提供方的对象引用，旧提供方却被移除了。

所以热重载的成立前提不是"能加载新的"，而是"**能完整卸载旧的**"。Cordis 把这一前提做到了机制层面：每一个注册都附带撤销动作，卸载由状态机统一驱动，依赖关系决定谁随谁卸载。本章就把这套机制拆开。

## 3.2 fiber：一次插件加载的运行时实例

### ① 类比：操作系统里的进程

可执行文件与进程是两个概念：一份 `ls` 二进制可以被 fork 出多个进程，每个进程有自己独立的地址空间、打开文件表与生命周期。插件和 fiber 的关系与之类似：**一份插件代码可以同时被挂载多次**（比如同一个工具插件在不同 profile 里出现），每次挂载产生一个独立的运行时实例——它有自己的上下文、配置、状态与资源清单。操作系统说"进程是程序的运行实例"，Cordis 说"fiber 是插件的运行实例"，这个类比可以贯穿本章。

### ② 精确定义

> **Fiber（纤程）**：一次插件应用（`ctx.plugin(...)` 或 loader 的一个配置行）产生的运行时实例。它记录该实例的依赖状态、经校验的配置、生命周期效果（effect）与清理动作，并持有该插件专属的上下文 `ctx`。定义见 `vendor/cordis/src/fiber.ts:179-183`。

来看它的字段（`vendor/cordis/src/fiber.ts:184-210`）：

```ts
export class Fiber {
  /** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
  public uid: number | null
  /** The context this fiber's plugin runs in (extends the parent context). */
  public readonly ctx: Context
  /** The validated plugin config (updated by `update()`). */
  public config: any
  /** The raw plugin config, re-resolved before each activation. */
  public _config: any
  /** Current lifecycle state; transitions emit `internal/status`. */
  public state = FiberState.PENDING
  /** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
  public readonly dispose: () => Promise<void>
  /** Snapshot of required service implementations while loaded; `undefined` otherwise. */
  public store: Dict<Impl> | undefined
  /** The in-flight load/unload transition, if one is currently running. */
  public inertia: Promise<void> | undefined
  public readonly _hooks: Dict<DisposableList<Function>> = Object.create(null)
  public readonly _disposables = new DisposableList<Disposable>()
}
```

对着这张表逐项认识（行号均为 `vendor/cordis/src/fiber.ts`）：

- `uid`：全局唯一编号，来自注册表的计数器（`parent.registry.counter`，`vendor/cordis/src/fiber.ts:235`；计数器定义 `vendor/cordis/src/registry.ts:207-209`）。**它同时是依赖串的零件**，3.6 节会看到它被拼进 epoch。根纤维的 uid 固定为 0 且永不置空（`vendor/cordis/src/fiber.ts:320-321`）；普通纤维被卸载时会置为 `null`（`vendor/cordis/src/fiber.ts:268`），`null` 即"已死"。
- `ctx`：插件执行的上下文。创建时执行 `parent.extend({ fiber: this })`（`vendor/cordis/src/fiber.ts:236`）——子上下文原型继承父上下文，但用自有属性 `fiber` 遮蔽，所以 `ctx.fiber` 总是指向"拥有当前执行环境"的那个纤维（第 2 章的 extend 语义在这里第一次派上实际用场）。
- `config` / `_config`：一份原始配置、一份校验后的配置。分离的目的是**懒解析**：原始配置保留到依赖激活之后才经过 `internal/config` 瀑布与标准 schema 校验（`vendor/cordis/src/fiber.ts:641-644`）；这是 vendored 本地修改第 15 条（`vendor/README.md:47`）的核心内容，第 5 章讲 `!!js` 插值时会再遇到。
- `dispose`：`() => Promise<void>`，卸载入口，可 `await`。
- `store`：**已加载期间**对所需服务实现的快照 `{ 服务名 → impl }`；`undefined` 表示当前未加载。它是 epoch 计算的数据源。
- `inertia`（惯性）：进行中的加载/卸载过程。迁移期间新的状态变化要求"等当前过程结束再说"——与物理惯性同义。
- `_hooks`、`_disposables`：分属两个容器。`_hooks` 存该纤维私有的 `internal/update` 监听器（第 4 章展开）；`_disposables` 是本纤维全部 effect 的释放清单（3.3 节）。

### ③ 最小示例

这是 Cordis 官方教程第 2 章的一个片段（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:29-42`）：

```ts
export function apply(ctx: Context) {
  // Mount a child plugin and keep its fiber to dispose it later.
  const fiber = ctx.plugin(heartbeat)
  // The demo timer is itself an effect ...
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

要点：`ctx.plugin(heartbeat)` 返回一个**可 await 的 fiber 包装**（`vendor/cordis/src/registry.ts:330-335`：`await ctx.plugin(x)` 等价于等 `fiber.await()` 落定），而 `await fiber.dispose()` 会等该插件全部清理完成后才返回——包括异步清理、包括它子挂载的插件（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:66`）。

## 3.3 effect 与 disposable：可逆的副作用

热重载的前提是"完整卸载旧插件"，而"完整卸载"在实现上等价于一个问题：**这个插件登记过的每一件事，如何按登记原样撤销？** Cordis 的答案是 effect。

### ① 类比：酒店退房清单

入住时前台登记：你借了毛巾 A、房卡 B、早餐券 C。退房时不是"请把房间恢复原状"这种模糊指令，而是拿着清单逐项核对撤销。当天的前台（插件）可能已经换人（热重载），但只要清单还在，退房动作就不会遗漏、不会多做。effect 就是 Cordis 的"退房清单"：登记时写条目，卸载时按条目撤销。

### ② 精确定义

> **effect（副作用效果单元）**：`ctx.effect(execute, label?)` 会**立即**执行 `execute` 函数；`execute` 的返回值是一个 `disposable`（释放函数，类型 `() => T`，见 `vendor/cordis/src/fiber.ts:74`），在 fiber 卸载（或手动调用返回的 disposer）时按**注册逆序**运行。effect 体还可以是 Promise、同步/异步迭代器——可迭代的 effect 逐个产出多个 disposer，逐个登记（`vendor/cordis/src/fiber.ts:83-93`）。
>
> **可逆（reversible）**：插件登记的一切资源与行为——提供服务、注册监听器、挂载子插件、开启定时器——都必须有一个配对的撤销动作；"登记"与"撤销"绑定为同一份 effect 记录，随宿主纤维一起存亡。Cordis 官方把它列为五个核心概念之一：**注册是可逆的副作用**（`docs/cordis-primer.zh.md:13`）。

类型定义精读（`vendor/cordis/src/fiber.ts:83-93`）：

```ts
export type Effect<T = any> =
  | SyncEffect<T>
  | AsyncEffect<T>

type SyncEffect<T = any> =
  | Disposable<T>
  | Iterable<Disposable<T>, void, void>   // 同步生成器：yield 多个 disposer

type AsyncEffect<T = any> =
  | Promise<Disposable<T>>                 // 异步取得唯一 disposer
  | AsyncIterable<Disposable<T>, void, void>
```

### ③ 最小示例

官方教程的 heartbeat（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:18-27`）：

```ts
function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}
```

登记（`ctx.effect`）时启动定时器；`clearInterval` 即撤销动作。官方记录的实际输出（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:53-60`）：

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

### 源码走读：`effect()` 是怎么登记与撤销的

只看主干，省略重入加固细节（`vendor/cordis/src/fiber.ts:418-522`）：

```ts
effect(execute: () => Effect, label = 'anonymous'): any {
  this.assertActive()
  if (this.state === FiberState.UNLOADING) {
    throw new CordisError('INACTIVE_EFFECT')       // ① 卸载中拒绝新 effect
  }
  const disposables: Disposable[] = []
  ...
  const dispose = () => {                           // ② 撤销器：逆序逐个运行
    if (disposing) return disposalTask
    disposing = true
    let task!: void | Promise<void>
    for (const disposable of disposables.splice(0).reverse()) {
      ...
    }
    return disposalTask = task
  }
  ...
  removeWrapper = this._disposables.push(wrapper)   // ③ 先挂清单，再跑主体
  try {
    task = this._execute(runner)                    // ④ 立即执行 effect 体
  } catch (reason) { ...throw reason }
  ...
}
```

四步对应四个设计决定：

1. **`UNLOADING` 中拒绝新 effect**（`vendor/cordis/src/fiber.ts:420-422`）：卸载已经开始，再登记新资源就是"漏网之鱼"，永远不会被清理。这是 vendored 本地修改第 6 条明确加固的行为（`vendor/README.md:38`）："Effect creation is rejected while the owner is `UNLOADING`"。
2. **逆序撤销**：`disposables.splice(0).reverse()`。为什么逆序？因为 effect 之间通常有栈式依赖——后登记的常引用先登记的（后开的事件监听器可能依赖先注册的服务）。先撤销"后登记的"可以保证撤销时依赖仍然存活。
3. **先挂清单再跑主体**（`vendor/cordis/src/fiber.ts:520` 在 `522` 之前）：如果 effect 主体执行期间宿主纤维恰好开始卸载，卸载器能立刻"看见"这个正在建立的 effect 并等待它完成——这是本地修改第 6 条"owner 包装先于 setup 注册"的重入加固。
4. **立即执行**：effect 不是登记回调等以后再跑，而是**当下就跑**。这也是可以理解的：定时器要现在就开、监听器要现在就挂，否则插件行为就是空谈。

**卸载侧的并发语义**要特别留意。`_unload` 的清理（`vendor/cordis/src/fiber.ts:675-686`）：

```ts
private async _unload() {
  await Promise.all(this._disposables.clear().map(async (dispose) => {
    try {
      await composeError(async (info) => {
        await Promise.resolve()
        info.error = new Error()
        await runDisposable(dispose)
      }, this._runner.getOuterStack)
    } catch (reason) {
      this.ctx.logger.error(reason)
    }
  }))
  ...
}
```

`DisposableList.clear()` 返回**逆序数组**（`vendor/cordis/src/utils.ts:27-31`），随后 `Promise.all` 并发执行。也就是说：**撤销顺序只保证"逆序",但多个异步 disposer 是并发跑的**。官方教程原话提醒（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:94`）："如果拆除步骤必须按顺序执行，请把它们放在同一个 disposer 中，并在其中依次等待每步完成。"——这条纪律请记牢，它是第 3、4 章反复出现的排障点。

## 3.4 Fiber 状态机：六态、两次跃迁

### 精确定义

Fiber 的状态由枚举定义（`vendor/cordis/src/fiber.ts:139-154`）：

```ts
export const enum FiberState {
  PENDING,    // 等待所需服务
  LOADING,    // 插件回调正在运行
  ACTIVE,     // 已加载并正在提供
  FAILED,     // 回调或配置校验抛错
  DISPOSED,   // 已移除，不可重启
  UNLOADING,  // disposer 正在运行
}
```

官方教程画的状态机（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:72-75`）：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

### 状态"推导"而非"赋值"

一个经常被误解的点：`state` 永远不直接迁到 ACTIVE——ACTIVE 是**推导**出来的。看 `_getState`（`vendor/cordis/src/fiber.ts:574-579`）：

```ts
private _getState() {
  if (this.uid === null) return FiberState.DISPOSED
  if (this._error) return FiberState.FAILED
  if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
  return FiberState.PENDING
}
```

优先级清晰：uid 置空 ⇒ 死；有错误 ⇒ 败；epoch 有效（见 3.6）⇒ 活；否则 ⇒ 等依赖。而 `_updateState`（`vendor/cordis/src/fiber.ts:581-595`）负责广播与善后：

```ts
private _updateState(callback: () => void | FiberState) {
  const oldState = this.state
  this.state = callback() ?? this._getState()
  if (oldState === this.state) return
  this.context.emit('internal/status', this, oldState)     // ① 状态事件
  // only notify changes between ACTIVE and NON-ACTIVE states
  if (oldState !== FiberState.ACTIVE && this.state !== FiberState.ACTIVE) return
  for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
    const impl = this.ctx.reflect.store[key as symbol]
    if (impl.fiber !== this) continue
    this.ctx.reflect.notify([impl.name])                   // ② ACTIVE 进出即惊动依赖方
  }
}
```

`internal/status` 事件让 HMR / 调试工具能观察到每个纤维的状态流（第 4 章会看到 `internal/*` 事件族的完整面貌）；② 是 3.6 节依赖串的发动机之一：**一个纤维进入 ACTIVE 或离开 ACTIVE 时，它提供的所有服务都要通知依赖方**——这正是"服务就绪后消费方才被唤醒"的纽带。

### 状态迁移的唯一驱动：`_setEpoch`

迁移自己从不"主动发生"，它们全部由 `_setEpoch` 发起（`vendor/cordis/src/fiber.ts:625-639`）：

```ts
private _setEpoch(epoch: string) {
  const oldEpoch = this._runner.epoch
  if (epoch === oldEpoch) return                    // 依赖没变，什么都不做
  this._runner.epoch = epoch
  if (this.inertia) return                          // 迁移中：先落账，后处理
  this._updateState(() => {
    if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
      this.inertia = this._reload()                 // 依赖齐了 → 加载
      return FiberState.LOADING
    } else {
      this.inertia = this._unload()                 // 依赖缺了 → 卸载
      return FiberState.UNLOADING
    }
  })
}
```

函数名 `setEpoch`（设置纪元）而实际干的是"按纪元变化驱动状态机"，名字本身就点明了因果：**纪元变了才有迁移，纪元没变就不动**。两个分支拼起来正好解释状态机里的环：

- 依赖从"缺"到"齐"（`oldEpoch === INACTIVE` 而新值非 INACTIVE）⇒ `_reload`：先校验配置再执行插件体（`vendor/cordis/src/fiber.ts:646-673`），失败记录到 `_error` 并 `logger.error`，状态回落 PENDING/FAILED；
- 依赖从"齐"到"缺" ⇒ `_unload`：撤干净所有 disposer（3.3 节），若此时纪元又变了（别人趁卸载时把依赖补回来了）则**再**进入 `_reload`（`vendor/cordis/src/fiber.ts:688-694`）。

`_reload` 里有一句容易被忽略的**防竞态检查**（`vendor/cordis/src/fiber.ts:650-658`）：

```ts
await Promise.resolve()
// A disposer queued before this checkpoint may already have invalidated
// the load. Do not run plugin code for a stale epoch ...
if (this._runner.epoch === oldEpoch) {
  this.config = this._resolveConfig(this._config)
  await this._execute(this._runner)
  this._error = undefined
}
```

加载是异步的：在"决定加载"与"真正执行插件体"之间隔了一个微任务。如果这个微任务窗口里依赖又没了，就直接放弃执行——**绝不执行一个已经过期的加载**。这是本地修改第 6 条加固的一部分（"skip plugin execution when reentrant disposal invalidates the load epoch before its first checkpoint"，`vendor/README.md:38`）。

对外，插件作者与状态机打交道主要就两个入口：`await fiber`（等落定，失败则抛错，`vendor/cordis/src/fiber.ts:704-710`）与 `fiber.dispose()`；改动配置走 `fiber.update(config)`（`vendor/cordis/src/fiber.ts:736-753`），它会先走 `internal/update` 瀑布（第 4 章），默认动作是 `restart()`——先 `_setEpoch(INACTIVE)` 再 `_refresh`（`vendor/cordis/src/fiber.ts:718-723`），等于"卸载原地重来"。

## 3.5 六种注册 API：语义差异与共同归宿

插件主体里最常用的六个 `ctx` API——`effect` / `on` / `waterfall` / `serial` / `plugin` / `inject`——常被混称为"六种注册方式"。这个说法**一半对、一半错**，把错的那点纠正过来，恰恰是理解第 4 章的关键。

### 三种真正的注册 API

`ctx.effect` 本身不在 `Context` 类上，而是 mixin 进来的：`ReflectService` 构造器执行 `this.mixin('fiber', ['runtime', 'effect'])`（`vendor/cordis/src/reflect.ts:220`），所以 `ctx.effect ≡ ctx.fiber.effect`。同理 `ctx.on` 来自 `mixin('events', ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])`（`vendor/cordis/src/reflect.ts:222`），`ctx.plugin` / `ctx.inject` 来自 `mixin('registry', ['inject', 'plugin'])`（`vendor/cordis/src/reflect.ts:221`）。

四种注册 API 的语义差异与共同归宿（行号均为本次复核）：

| API | 注册的"东西" | 实现落点 | 卸载时撤销什么 |
|---|---|---|---|
| `ctx.effect(execute, label?)` | 任意自定义资源 + 其 disposer | 直接进当前纤维 `_disposables`（`vendor/cordis/src/fiber.ts:520`） | 按逆序运行 execute 返回的 disposer |
| `ctx.on(name, listener, opts?)` | 一个事件监听器 | `EventsService.register` → `ctx.fiber.effect(...)`（`vendor/cordis/src/events.ts:254-260`） | 从钩子表移除该监听器（`vendor/cordis/src/events.ts:269-275`） |
| `ctx.plugin(child, config?)` | 一个子插件 | 子纤维的 `dispose` 作为 effect 挂到父纤维（`vendor/cordis/src/fiber.ts:265-297`） | 递归卸载子纤维及其一切 |
| `ctx.inject(deps, callback)` | 一个"依赖就绪才跑"的插件体 | 等价 `ctx.plugin({ inject, apply: callback, name: callback.name })`（`vendor/cordis/src/registry.ts:300-302`） | 同上（它只是对象形态插件的语法糖） |

**共同归宿**：四种 API 的注册动作最终都成为**当前纤维（`ctx.fiber`）effect 栈**里的一条记录。因此只要宿主纤维被卸载，它们全部自动回滚——不需要插件作者记住任何 `removeListener` / `unregister`。这正是"注册是可逆的副作用"的实现：**可逆性是框架给的，不是插件作者自觉维护的**。

### 两个不属于注册的 API

`ctx.waterfall` 与 `ctx.serial` 是**分发**（dispatch）方法：它们把事件发给已经注册的监听器并运行它们，本身不登记任何资源、不进入 effect 栈。真正容易混淆的原因是：Cordis 框架**自己**用它们把"每个纤维的私有钩子"接入全局链条——`EventsService` 构造器（`vendor/cordis/src/events.ts:134-156`）注册了两个全局监听器：

```ts
this.on('internal/listener', function (this: Context, name, listener, options: EventOptions) {
  if (name === 'internal/update' && !options.global) {
    const hooks = this.fiber._hooks['internal/update'] ??= new DisposableList()
    const method = options.prepend ? 'unshift' : 'push'
    return hooks[method](listener)
  }
})

this.on('internal/update', function (config, noSave, next) {
  const cbs = [...this._hooks['internal/update'] || []]
  const _next = () => {
    const cb = cbs.shift() ?? next
    return cb.call(this, config, noSave, _next)
  }
  return _next()
}, { global: true, prepend: true })
```

含义：如果一个纤维注册了 `internal/update` 监听器，它会被"特判"进该纤维的 `_hooks`（`vendor/cordis/src/fiber.ts:202`）；全局 `internal/update` 瀑布随后按纤维逐个重放这些私有钩子——于是 `fiber.update()`（`vendor/cordis/src/fiber.ts:748`）才能依次跑每个纤维自己的更新逻辑。这里出现了一个完整的"事件系统 × 纤维"耦合样例，**第 4 章会把它拆成独立主题**；现在只需记住结论：`on` 注册监听器并进入 effect 栈，`waterfall` / `serial` 运行监听器但不注册。

## 3.6 依赖串与 epoch：提供方卸载，依赖方连带卸载

到这一步，工作台上有两件工具：纤维（负责"一次插件应用"的容器）与 effect（负责"撤销"的清单）。接下来回答本节的核心问题：**为什么提供方一卸载，消费方会被"连带"卸载？** 答案是依赖串（dependency chain）与纪元（epoch）。

### ① 类比：登机牌上的航班号

乘客的登机牌上印的不是机长的姓名，而是**航班编号**。机长换人（提供方被替换），航班号不变，乘客照常登机；但若航班被取消（提供服务被卸载），所有持该航班登机牌的乘客都会收到改签/取消通知——**乘客被动响应，而不是自己去打听航班状态**。Cordis 的依赖跟踪就是这个逻辑：消费方身上的"登机牌"记录着"我要的服务此刻由哪个纤维实例提供"，提供方一变，通知自动送达。

### ② 精确定义

> **epoch（纪元）**：当前纤维依赖状态的一个**字符串签名**。对 `inject` 声明的每个服务名，取"提供该服务的纤维的 uid"，用冒号拼接（如 `3:7`，顺序即 inject 声明顺序）；任一所需服务缺失时，epoch 取哨兵值 `INACTIVE`（`'__INACTIVE__'`，`vendor/cordis/src/fiber.ts:176`）。epoch 相等 ⇒ 依赖集合完全一致；epoch 变化 ⇒ 触发状态机迁移（`vendor/cordis/src/fiber.ts:611-639`）。

### ③ 源码链走读

**第一环：依赖如何登记。** 纤维构造器把 `inject` 表逐项写入子上下文的拦截表（`vendor/cordis/src/fiber.ts:238-245`），随后发布 `internal/plugin` 事件通知观察者（`vendor/cordis/src/fiber.ts:302`），**只有发布之后**才做依赖检查（`vendor/cordis/src/fiber.ts:314-319`）：

```ts
// Keep the initial notification's historical PENDING view. The loader
// may also extend `inject` in that notification, so resolve dependencies
// only after publication. ...
if (this.uid !== null && parent.fiber.state !== FiberState.UNLOADING) {
  for (const name of Object.keys(this.inject)) {
    this._checkImpl(name)
  }
  this._refresh()
}
```

顺序倒过来会怎样？观察者（loader）还没机会给纤维补充依赖声明，检查就白做了。这是本地修改第 6 条"`internal/plugin` 发布后才解析依赖"的由来（`vendor/README.md:38`）。

**第二环：服务如何认领。** `_checkImpl`（`vendor/cordis/src/fiber.ts:597-609`）：

```ts
_checkImpl(name: string) {
  const impl = this.ctx.reflect._getImpl(name, true)
  if (!impl) return delete this._store[name]
  try {
    if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) {
      return delete this._store[name]
    }
  } catch (error) { ... }
  this._store[name] = impl
}
```

`_getImpl(name, true)` 的 strict 语义（`vendor/cordis/src/reflect.ts:237-243`）：**只认处于 ACTIVE 状态的提供方**。提供方还在 PENDING/LOADING 时，它的服务对依赖方"不可见"。`impl.check` 是可选可用性谓词（服务基类可以声明"只有当……才可用"，如 Loader 的 `config.await` 检查），谓词失败同样视为未满足。凡未满足者从 `_store` 删除——注意没有"缓存旧实现"的余地。

**第三环：签名如何计算。** `_refresh`（`vendor/cordis/src/fiber.ts:611-623`）：

```ts
_refresh() {
  let epoch: string | boolean = false
  epoch = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) {
      epoch = INACTIVE
      break
    }
    epoch += ':' + impl.fiber.uid
  }
  this._setEpoch(epoch)
}
```

读三遍这 10 行：`epoch` 是一串 uid 的拼接；缺任何一项立即短路为 `INACTIVE`；**签名里是 `impl.fiber.uid`——提供方纤维的 uid，而不是服务名**。这一条带来全书反复使用的推论：

> **推论（提供方实例即身份）**：依赖跟踪的单位是"提供方纤维实例"，不是"服务名"。同一服务换了提供方（即使名字完全一样），uid 必然不同，epoch 必然改变，消费方必然被卸载重载。

**第四环：变化如何送达。** 提供方卸载时，`ctx.provide` 返回的 disposer 执行（`vendor/cordis/src/reflect.ts:297-303`）：

```ts
return async () => {
  delete this.store[key]
  const fibers = this.notify([name])
  await Promise.allSettled(fibers.map(fiber => fiber.await()))
  // ensure self access before dependencies cleanup
  delete this.ctx.fiber.store![name]
}
```

先删实现，再 `notify`，等所有受惊动的纤维落定后，才清理自己上下文里的快照。`notify`（`vendor/cordis/src/reflect.ts:314-336`）遍历注册表中**每一个 runtime 的每一个纤维**，凡 `inject` 命中且作用域匹配的，逐一 `_checkImpl` + `_refresh`——依赖方 epoch 随即变成 `INACTIVE`，`_setEpoch` 启动 `_unload`。**这就是"提供方卸载 ⇒ 依赖方连带卸载"的完整因果链**：删除实现 → notify → 消费方重算 epoch → 状态机卸载消 费方。配合第三环，提供方恢复（重新挂载、新 uid）时同一链条反向运作，消费方自动 `_reload`——老代码无需改动。

顺带一提 `_updateState` 里那次 notify（3.4 节②）：提供方从 LOADING 转入 ACTIVE 时也会惊动依赖方，这正是消费方从 PENDING 被唤醒的时机——否则消费方永远不知道"服务此刻终于可用了"。

### PENDING 是合法状态，不是错误

`inject` 是声明式的，因此"所需服务尚未提供"不是故障：纤维安静地待在 PENDING（`_getState` 返回 PENDING，不抛错、不占事件循环）。官方教程的诊断手段是遍历注册表检查 `fiber.state`（`docs/cordis-tutorial/06-composition-and-hmr.zh.md:61-109`）；"插件既无输出也无报错"时，第一件事永远是查状态。

## 3.7 插件三形态：归一为同一个 callback

插件（plugin）是 Cordis 唯一的外部入口，但提供插件的方式有三种（`vendor/cordis/src/registry.ts:92-95`）：

```ts
export type Plugin<T = any> =
  | Plugin.Function<T>      // (ctx, config) => any
  | Plugin.Constructor<T>   // new (ctx, config) => any
  | Plugin.Object<T>        // { apply(ctx, config) }
```

三形态如何归一？分两步。

**第一步：归一为 callback。** `RegistryService.resolve`（`vendor/cordis/src/registry.ts:222-228`）把任意形态变成纯函数：

```ts
resolve(plugin: Plugin): Function | undefined {
  try {
    if (typeof plugin === 'function') return plugin
    if (isApplicable(plugin)) return plugin.apply
  } catch {}
}
```

函数形态原样返回；对象形态取 `plugin.apply`；两者都不是 ⟹ `ctx.plugin` 直接抛错"invalid plugin, expect function or object with an apply method"（`vendor/cordis/src/registry.ts:319`）。这个 callback 成为注册表的**身份键**：同一 callback 共享一个 runtime（`vendor/cordis/src/registry.ts:322-328`），一次 `ctx.plugin()` 调用产生一个 fiber 挂进 `runtime.fibers`。**"一份插件代码可多实例"与"同一 callback 标识一个插件"因此同时成立。**

**第二步：归一为执行方式。** `_runner.execute`（`vendor/cordis/src/fiber.ts:250-261`）：

```ts
execute: function () {
  if (isConstructor(runtime.callback)) {
    const instance = new runtime.callback(this.ctx, this.config)
    for (const hook of instance?.[symbols.initHooks] ?? []) {
      hook()
    }
    return instance?.[symbols.init]?.()
  } else {
    return runtime.callback(this.ctx, this.config)
  }
},
```

`isConstructor` 排除箭头函数与生成器函数（`vendor/cordis/src/utils.ts:79-89`）：可 `new` 的用 `new` 构造并跑 `@Inject` 方法钩子与 `[Service.init]`；不可 `new` 的按普通函数调用。Service 子类因此自然成立——`GreeterService` 构造器里 `super(ctx, 'greeter')` 直接调用 `ctx.reflect.provide(name, self, check)`（`vendor/cordis/src/service.ts:42-59`），而 provide 是 effect（`vendor/cordis/src/reflect.ts:278`），于是"服务注册"顺理成章地进入构造它的纤维的 effect 栈。

等价关系汇总：

| 形态 | 归一后的 callback | 何时"执行" | 典型身份 |
|---|---|---|---|
| 导出 `apply` 的函数 | 函数本身 | 直接 `callback(ctx, config)` | 绝大多数 dsh 插件（如 tool 包） |
| `{ apply(ctx, config) }` 对象 | `plugin.apply` | 同上 | `ctx.inject` 的语法糖产物；带 `inject` 声明的插件 |
| Service 子类 | 类本身 | `new`；构造即 `provide` | `ctx.llm` / `ctx.fs` 等核心服务 |

`ctx.inject(deps, cb)` 是对象形态的语法糖（`vendor/cordis/src/registry.ts:300-302`），且名字取自 `cb.name`。翻译成语义：**"在依赖就绪后，把回调当作插件跑一遍"**——它把 3.6 节的依赖声明与 3.2 节的 fiber 打包成一个调用，是写插件时最常用的形态。

## 3.8 最小示例：两插件依赖链与卸载顺序观察

现在把本章机制串成一个可离线运行的实验：一个提供方（`provider`）提供一个计数服务并登记两个可观察的 effect；一个消费方（`consumer`）硬依赖该服务并登记一个事件监听器；主插件挂载两者，随后**显式卸载提供方**，观察消费方被连带卸载，再重新挂载提供方，观察消费方自动恢复。

```ts
// tmp/cordis-tutorial/chain.ts
import { type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    counter: { value: number; bump(): number }
  }
}

// 与 FiberState 枚举顺序一致（vendor/cordis/src/fiber.ts:147-154）；
// 真实代码里请直接 import { FiberState } 比较（见文档 06 章 diagnose 示例）。
function stateName(state: number): string {
  return ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'][state] ?? String(state)
}

/** 提供方：提供一个 counter 服务 + 两个可观察的 effect */
export function provider(ctx: Context) {
  console.log('[provider] apply begin')
  const box = { value: 0, bump() { return ++this.value } }

  ctx.effect(() => {
    console.log('[provider] effect A registered')
    return () => console.log('[provider] cleanup A')
  })

  ctx.provide('counter', box)          // provide 本身就是一个 effect

  ctx.effect(() => {
    console.log('[provider] effect B registered')
    return () => console.log('[provider] cleanup B')
  })
}

/** 消费方：硬依赖 counter，并登记一个事件监听器作观察 */
export const consumer = {
  inject: ['counter'],
  apply(ctx: Context) {
    console.log('[consumer] apply begin, counter.value =', ctx.counter.value)
    ctx.on('demo/tick', () => console.log('[consumer] demo/tick received'))
    ctx.effect(() => () => console.log('[consumer] cleanup effect'))
  },
}

/** 主插件：挂载两者，拆掉提供方，再重新挂载 */
export const name = 'chain-main'
export function apply(ctx: Context) {
  const a = ctx.plugin(provider)
  const b = ctx.plugin(consumer)

  setTimeout(async () => {
    console.log('--- 1. dispose provider ---')
    await a.dispose()
    console.log('--- 2. consumer after provider gone ---')
    ctx.emit('demo/tick')                 // 监听器应已被连带卸载：无输出
    console.log('consumer fiber state:', b.state, '=', stateName(b.state))
    console.log('--- 3. remount provider ---')
    ctx.plugin(provider)
    await new Promise(r => setTimeout(r, 50))
    process.exit(0)
  }, 300)
}
```

配套 `tmp/cordis-tutorial/cordis.yml`：

```yaml
- name: './chain.ts'
```

运行命令与官方教程一致（在 `tmp/cordis-tutorial` 下，无需 API key，`docs/cordis-tutorial/index.zh.md:17-36`）：

```sh
node --import tsx ../../vendor/cordis/bin.js
```

**预期输出**（按源码语义逐步推演，未在本次写作环境中运行验证）：

```
[provider] apply begin
[provider] effect A registered
[provider] effect B registered
[consumer] apply begin, counter.value = 0
--- 1. dispose provider ---
[provider] cleanup B
[consumer] cleanup effect
[provider] cleanup A
--- 2. consumer after provider gone ---
consumer fiber state: 0 = PENDING
--- 3. remount provider ---
[provider] apply begin
[provider] effect A registered
[provider] effect B registered
[consumer] apply begin, counter.value = 0
```

逐段对照源码解释为什么是这样（这正是本章的主线复习）：

1. **`[consumer]` 为什么最后才出现**：提供方无依赖，其纤维创建即进入 LOADING；但 `_reload` 的第一个 `await Promise.resolve()`（`vendor/cordis/src/fiber.ts:650`）使插件体延后一个微任务。消费方在同一轮同步代码里创建时，`counter` 尚未提供 ⟹ 停在 PENDING（`vendor/cordis/src/fiber.ts:611-623`）。等提供方转入 ACTIVE，`_updateState` 的 notify（`vendor/cordis/src/fiber.ts:588-594`）把消费方唤醒并完成加载。
2. **卸载顺序是"B → 消费方 → A"**：提供方 `_disposables` 的登记顺序为 effect A、provide、effect B，`DisposableList.clear()` 逆序（`vendor/cordis/src/utils.ts:27-31`）后为 B、provide、A。provide 的 disposer 同步段执行 `notify(['counter'])`（`vendor/cordis/src/reflect.ts:297-303`），消费方 epoch 变 `INACTIVE` 随之 `_unload`——所以 cleanup B、consumer cleanup、cleanup A 依次打印。
3. **`demo/tick` 没有输出**：消费方的 `ctx.on` 是 effect，连带的卸载已把它从钩子表移除（`vendor/cordis/src/events.ts:254-275`）——监听器不会变成幽灵。
4. **卸载后是 PENDING 而不是 DISPOSED**：epoch 卸载只让纤维回到等待态（uid 未置空，`_getState` 推导为 PENDING），因为"依赖可能再回来"。只有父纤维卸载、disposer 真正执行时 uid 才置 `null`（`vendor/cordis/src/fiber.ts:268`）。
5. **重挂载后消费方自动复活**：新提供方纤维获得新 uid（`vendor/cordis/src/registry.ts:207-209`），epoch 从 `INACTIVE` 变 `:N+1`，`_setEpoch` 驱动 `_reload`——插件代码老与"重载"无关，全部由机制完成。

## 3.9 反事实推演：不卸载会怎样

机制看完了，用反事实来检验它的必要性：**如果 Cordis 不提供 fiber / effect 这套机制，插件被"移除"时不撤销注册，会发生什么？** 逐个推演（每个场景的后果都有对应源码佐证）：

**反事实一：提供方卸载但不注销服务（悬空引用）。** 若 `provide` 的 disposer 不运行，`reflect.store[key]` 里的 `impl` 将残留。后果有二：其一，同名服务再次注册时直接抛错——`service "counter" has been registered at <...>`（`vendor/cordis/src/reflect.ts:289-291`）。热替换就此死亡：新产品永远挂不上，因为旧产品"占着坑"；其二，消费方持有的 `impl.value` 是旧实例对象，而旧纤维已被卸载——引用悬空，读写的是"死物件"。热重载最常见的崩溃（"为什么换实现报 already registered"）根源就在这。

**反事实二：监听器不撤销（幽灵监听）。** 若 `ctx.on` 不回滚，钩子数组（`vendor/cordis/src/events.ts:299`）会随每次 HMR 递增。旧插件逻辑继续收到事件、继续执行已过时的行为；日志里出现莫名其妙的重复输出，且难以定位——因为"违规者"是一个已经被删除的插件。官方教程专门立了纪律：只观察的 waterfall 监听器必须调用 `next()`（`docs/cordis-primer.zh.md:38`），那是"行为"层面的要求；"注册"层面的对应纪律就是本节：监听器必须随宿主纤维消亡。

**反事实三：定时器不撤销（泄漏）。** 若 `ctx.effect` 的 disposer 不运行，`setInterval` 永不清理。进程无法退出（官方教程 heartbeat 的 cleanup 日志说明反例），长跑会话里每热重载一次就多一个后台空转的循环——设备性能与电量被悄悄吃掉。

**反事实四：子插件不撤销（孤儿纤维）。** 若 `ctx.plugin` 的子纤维 disposer 不执行，父插件卸载后子插件仍在运行、仍在提供服务、仍在被依赖方引用——依赖树出现"无人认领的节点"，而依赖链（3.6 节）的完整性被打破：消费方以为自己在依赖某个活着的提供方，实际上提供方已经死了。

四条反事实的统一结论：**"注册"与"撤销"必须绑定**，而且撤销必须由框架**自动、递归、完整**地执行，不能指望插件作者记得。这正是"可逆副作用"这个词的分量：可逆不是可选优化，而是插件系统能够热重载、能够替换提供方、能够整树回收的地基。代码层面，本地修改第 6 条还专门加固了"卸载过程中谁也不能再偷偷登记新 effect"（`vendor/cordis/src/fiber.ts:420-422`，`vendor/README.md:38`）——连"清理中途复活"这条后门都堵上了。

## 3.10 本章小结

1. **fiber 是插件的运行时实例**：一次 `ctx.plugin()` 或一个 loader 配置行对应一个纤维，拥有唯一 uid、专属子上下文、配置快照、依赖快照与 effect 清单（`vendor/cordis/src/fiber.ts:179-210`）。
2. **effect 是"登记—撤销"二元组**：`ctx.effect` 立即执行主体、收集 disposer；`_disposables.clear()` 逆序返回、异步并发撤销（`vendor/cordis/src/utils.ts:27-31`，`vendor/cordis/src/fiber.ts:675-686`）；要保序就把多步塞进同一个 disposer。
3. **状态机六态**：PENDING / LOADING / ACTIVE / FAILED / UNLOADING / DISPOSED；ACTIVE 由 epoch 推导（`_getState`），所有迁移由 `_setEpoch` 驱动（`vendor/cordis/src/fiber.ts:574-639`）。
4. **四种注册 API**（`effect` / `on` / `plugin` / `inject`）殊途同归——全部进入当前纤维的 effect 栈；`waterfall` / `serial` 是分发方法，运行监听器而非登记它们（`vendor/cordis/src/reflect.ts:219-222`）。
5. **epoch 依赖串**：`':' + 提供方纤维 uid` 拼接，缺失即 `INACTIVE`；提供方实例变更 ⇒ epoch 变更 ⇒ 消费方连带卸载/重载（`vendor/cordis/src/fiber.ts:611-639`，`vendor/cordis/src/reflect.ts:297-336`）。
6. **插件三形态归一**：函数 / `{apply}` 对象 / Service 子类 → 同一 callback（`vendor/cordis/src/registry.ts:222-228`），函数体或构造器（`vendor/cordis/src/fiber.ts:250-261`）。
7. **可逆性是机制不是自觉**：不卸载的一切后果——悬空引用、重复注册报错、幽灵监听、资源泄漏——都由"注册=effect"机制统一兜底。

## 3.11 分层练习

**理解层**
1. 不看源码，写出 `FiberState` 六态的枚举顺序，并为每个状态各举一个"进入该状态的真实场景"。
2. 用 3.8 节术语回答：`await a.dispose()` 期间，消费方纤维的什么字段最先变化、由谁触发？

**应用层**
3. 设 A 提供 x 服务、B 同时注入 x 与 y、C 注入 y。按注册顺序挂载 A、B、C，写出三者的初态；随后卸载 A，写出每个纤维的 epoch 变化过程与终态（可用 `:uid` 记号）。
4. 把 3.8 节示例中 consumer 的 `ctx.on` 与 `ctx.effect` 交换登记顺序，推演 `--- 2. ---` 之后的输出差异，并解释。

**综合层**
5. 论证"不卸载 B 时 A 的悬空行为"：设 A 提供 `counter` 服务、B 持有 `ctx.counter` 引用；若 A 的 fiber 被 dispose 但它的 provide disposer 未运行，B 的 `ctx.counter.bump()` 调用会发生什么（对照 `vendor/cordis/src/reflect.ts:241` 的 strict 过滤与 `vendor/cordis/src/fiber.ts:268` 的 uid 置空）？给出两种修复方案（框架级/插件级）。
6. 为什么 `runtime.fibers` 用 `DisposableList` 而不是数组？（提示：对比 `vendor/cordis/src/utils.ts:14-31` 三个操作与数组的 `splice`——O(1) 删除、clear 逆序、迭代稳定。）

**挑战层**
7. 设计一个"可热替换"的插件：要求提供方 A 换为 A′ 时，消费方 B 不感知（即 B 不得依赖 A 的具体类型），但 B 必须在 A′ 挂载后立刻使用新实例。结合 `provide` / `notify` / 纤维 uid 语义论证你的方案，并指出 3.6 节推论为何使"B 不重启"不可能。

## 3.12 延伸阅读

- `docs/cordis-tutorial/02-lifecycle-and-effects.zh.md`：官方教程第 2 章，本章最小示例的母版，含已验证的运行输出。
- `docs/cordis-tutorial/03-services.zh.md`：服务与 `inject` 的官方讲解，含"加载后仍跟踪依赖"一节（对应 3.6 节）。
- `docs/cordis-tutorial/06-composition-and-hmr.zh.md`：HMR 全流程与 PENDING 诊断（`diagnose.ts` 模式）。
- `docs/cordis-primer.zh.md`：五核心概念与"注册是可逆的副作用"的官方表述。
- `vendor/cordis/src/fiber.ts`：本章引用主干；建议整读（754 行）。
- `vendor/README.md` 本地修改第 6 条（fiber 生命周期加固）与第 15 条（懒配置解析）：教材以本仓库行为为准，这两条是"上游没有的加固"清单。
- 上游 Cordis 仓库：https://github.com/cordiverse/cordis （`packages/core`，commit `56b3d4f`，即本仓库 vendor 快照的上游版本）。
