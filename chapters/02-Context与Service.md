# 第 2 章　Context 与 Service：Cordis 的依赖容器

> **本讲法**：这是一章"概念型"内容，你后面 15 章几乎每一页都要用到其中的两个词（Context、Service）和一个机制（按名解析）。所以本章不赶进度：先给一个贯穿全章的类比（**酒店前台与房卡**），再用源码给出精确定义，接着讨论边界与例外，最后写一个可以亲手运行的最小示例。类比负责"直觉先行"，源码负责"证据兜底"，两者会反复对照。
>
> **前置**：第 1 章（仅需知道"树由 entry 组成、entry 由插件驱动"）、TypeScript 类与 `declare module`、Promise/async。本章源码全部位于 `vendor/cordis/src/`——仓库把 Cordis 框架 vendor（本地固化）了，这是 dsh 自有框架层，见 2.7 节。

**学习目标**。学完本章，你将能够：

1. 用"酒店前台与房卡"类比向别人解释 Context 是什么、服务怎么被找到；
2. 说清 `new Context()` 里发生了什么，为什么构造函数返回的不是 `this`；
3. 解释 `ctx.greeter.greet()` 读取时发生了什么（Proxy 的哪个分支、沿 fiber 链怎么走）；
4. 区分 `extend`、`isolate`、`intercept` 三种"子 Context"，并推导配置合并顺序；
5. 复述 `provide` 的完整契约与三个典型报错（重复注册、未 provide 就 set、跨 fiber set）；
6. 说明"服务即 effect、卸载即注销"的含义。

---

## 2.1 问题引入：插件之间如何按名找到对方

第 1 章我们看到，`dsh` 的树里挤着几十个插件：模型适配器、文件系统提供方、工具注册表、会话日志、agent loop……它们必须互相协作。最直接的做法是**模块 import**：`consumer.ts` 写 `import { GreeterService } from './greeter.ts'`，直接用导出类。但这样做有三个致命缺点：

1. **实现被钉死**：换成另一个问候实现就要改代码、重新构建；
2. **无法热替换**：运行中换一个提供方需要进程重启；
3. **依赖方向倒挂**：消费方必须知道提供方在哪个文件、类名叫什么。

Cordis 的选择是——**消费方只报"能力名"，不碰提供方**。官方教程的定义是："服务是一个插件提供、其他插件通过 `ctx` 消费的具名能力。在 harness 中，`ctx.tools`、`ctx.llm` 和 `ctx.agents` 都是服务。消费方只指定 `'tools'` 之类的能力，而不导入其提供方，因此配置可以选择提供方，无需修改消费方"（`docs/cordis-tutorial/03-services.zh.md:5`）。

注意这句话的后半句：**配置可以选择提供方**。这正是第 1 章 1.5.2 里 `cordis.yml` 把 `name` 从 `@deepseek-ai/dsh-llm-deepseek` 换成 `@deepseek-ai/dsh-llm-pi-ai` 就能换模型来源的机制基础（`examples/headless-agent/cordis.yml:18` 注释）。而且这种替换不是"下次启动生效"：服务在运行期间消失，依赖它的插件会自动卸载，服务恢复后重新加载（`docs/cordis-tutorial/03-services.zh.md:76`）。要做到这一点，服务必须**与提供方解耦到"只认名字"的程度**——这就是本章的主角 Context 与 Service。

## 2.2 认识 Context：酒店前台与房卡

### 2.2.1 直觉类比：一座"服务酒店"

把整个应用想象成一座酒店大楼，这个类比将贯穿本章：

| 类比对象 | 真实事物 | 说明 |
|---|---|---|
| 酒店大楼 | **Context**（上下文） | 一座楼里有一整套房间（服务）与一套住客（插件）管理规则 |
| 前台 | **`ctx`**（Context 实例的代理） | 你只跟前台打交道，报服务名，前台替你找房间 |
| 房卡上的房间名 | **服务名（service name）** | 如 `'greeter'`、`'tools'`、`'llm'`；凭名字入住，不关心房间在几楼几号 |
| 住客 | **插件（plugin）** | 办理入住（启动）时领到自己的房卡；退房（卸载）时交还一切 |
| 入住周期 | **fiber** | 从办理入住到退房的完整生命周期（详见第 3 章；本章只用到"每个插件有一个 fiber"这一事实） |
| 连锁分店 | **子 Context**（`extend`/`isolate`/`intercept`） | 2.5 节详细分解 |
| 入住时发的附加说明单 | **intercept 配置** | 2.5.3 节 |
| 退房手续 | **effect 的逆执行** | 服务随住客退房而注销，房间自动腾空 |

用这个类比重述 2.1 的问题：消费方想做"问候"这件事，它不打电话给问候服务的具体员工（不 import），而是到前台报名字 `'greeter'`（`ctx.greeter`），前台把房卡递过来。员工是换过的？没关系，名字没变，房卡照拿。

**类比到此为止，下面是精确的。**

### 2.2.2 精确定义：接口、类与构造器

**定义 2.1（Context）。** Context 是 Cordis 的**依赖容器**：它持有服务注册表、事件总线、插件注册表与日志服务，并提供一个"按名解析了服务"的代理对象 `ctx`。类自身注释的定义是："Root and child dependency containers for Cordis plugins"（根级与子级的 Cordis 插件依赖容器）；同一注释紧接着说明代理设计："一个 context 是一个 proxy：普通属性读取会走服务解析器，而 `extend()`、`isolate()`、`intercept()` 创建带作用域的子 context，且不修改父级"（`vendor/cordis/src/context.ts:35-41`）。

接口形态在 `vendor/cordis/src/context.ts:16-33` 定义，注释（`:9-14`）解释了它为什么是"接口"：具体 `Context` 类在运行时被代理，这个接口由核心服务与插件**声明合并增强**，用来描述可以从 `ctx` 读取的属性。接口成员包括四个内置服务（`events`、`logger`、`reflect`、`registry`，`:26-32`）、根引用 `root`（`:22`）、相对路径解析基准 `baseUrl`（`:24`），以及两个符号键表 `isolate` 与 `intercept`（`:18-20`）——后两者是 2.5 节的地基。

再看构造器（`vendor/cordis/src/context.ts:71-84`），十四行代码、十二个语句，每一行都在装楼：

```ts
constructor() {
  this[symbols.isolate] = Object.create(null)
  this[symbols.intercept] = Object.create(null)
  const self = new Proxy<this>(this, ReflectService.handler)
  this.root = self
  this.baseUrl = undefined
  this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])
  this.reflect = new ReflectService(self)
  this.registry = new RegistryService(self)
  this.events = new EventsService(self)
  this.logger = new LoggerService(self)
  this.fiber._disposables.clear()
  return self
}
```

逐行解读：

- `vendor/cordis/src/context.ts:72-73`：两张空表。`isolate` 表将在 2.5 节记录"服务名 → 作用域符号"，`intercept` 表记录"服务名 → 附加配置"。
- `:74`：**关键一行**——`new Proxy(this, ReflectService.handler)`。`self` 是代理而不是 `this`；从此 `ctx.xxx` 的每次读取都经过 `ReflectService.handler.get`（2.4 节）。`:83` 的 `return self` 意味着**构造函数返回的是代理**——如果你写 `const ctx = new Context()`，你拿到的是代理；直接操作 `this` 的地方只发生在 `:72-81` 这段"装楼"阶段。
- `:75`：`root` 指向自己（代理），所有子 Context 共享这个根引用。
- `:77`：创建根 fiber。注意参数：`new Fiber(self, {}, Object.create(null), null, () => [])` 与构造器签名逐位对齐——`vendor/cordis/src/fiber.ts:222-228` 的形参顺序是 `parent`、`config`、`inject`、`runtime`、`getOuterStack`，所以这里 `config` 是空对象、`inject` 是空表、`runtime` 为 `null`：根 fiber 不对应任何插件，它是"楼本身"的入住记录。`:82` 的 `this.fiber._disposables.clear()` 清空根 fiber 的效果表——因为根 fiber 没有真实插件，它的 `execute` 是空函数（`vendor/cordis/src/fiber.ts:325-330`）。
- `:78-81`：装四个内置服务：反射层（`reflect`，2.4 节主角）、插件注册表（`registry`）、事件总线（`events`）、日志（`logger`）。它们不是"外部安装"的，而是**楼的自带设施**——`ctx.reflect`、`ctx.events` 这类属性读取当然也要经过代理，但代理对"自有属性"直接放行（`vendor/cordis/src/reflect.ts:140-142`），所以它们是稳定的。

**定义 2.2（Service）。** Service 是"在 `ctx` 上暴露一个具名 API"的基类：子类在构造器里调用 `super(ctx, name)`，实例**立即注册**，并随拥有它的 fiber 卸载而自动移除（`vendor/cordis/src/service.ts:5-10` 的类注释；注册发生在 `vendor/cordis/src/service.ts:57` 的 `self.ctx.reflect.provide(name, self, this[symbols.check])`）。

### 2.2.3 最小可运行示例：一个 `greeter` 服务

把下面的代码存为 `greeter.ts`，放在仓库根目录（这样 `@deepseek-ai/cordis` 能通过 workspace 解析到 `vendor/cordis`）：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 编译时：声明合并，把 greeter 加进 Context 接口（只影响类型，不生成代码）
declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

// 运行时：Service 子类本身就是插件（类形态）
class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')          // 以名称 greeter 注册
  }
  greet(who: string) {
    return `Hello, ${who}!`
  }
}

const app = new Context()          // 建楼：装好四个内置服务与根 fiber
await app.plugin(GreeterService)   // 入住：GreeterService 作为插件被挂载
console.log(app.greeter.greet('world'))   // 报服务名 → 拿到实例 → 调用
```

运行（不需要任何构建步骤，tsx 只是把 TS 即时翻译）：

```sh
node --import tsx/esm greeter.ts
# 输出：Hello, world!
```

逐行说明（每条都对应源码中的实锤）：

- `super(ctx, 'greeter')` 做了什么？`vendor/cordis/src/service.ts:42-58`：把 `name` 设为 `'greeter'`（若省略则取类的静态 `provide` 字段，`:43`），设置 `this.ctx` 与 `this.name`（`:53-54`），然后 `ctx.reflect.provide('greeter', self, check)`（`:57`）。**注册本身是一个 effect**——类注释说 "The service is registered immediately and is automatically removed with the owning fiber"（`vendor/cordis/src/service.ts:8-10`）。这正是 2.6 节要展开的"服务即 effect"。
- `await app.plugin(GreeterService)` 是在挂载"类形态插件"：`vendor/cordis/src/fiber.ts:251-257` 显示，若回调是构造器就 `new callback(ctx, config)` 并跑 `[init]` 钩子。`app.plugin` 方法是 `registry` 服务混入 `ctx` 的（`vendor/cordis/src/reflect.ts:219-222` 的 `mixin('registry', ['inject', 'plugin'])`），它的返回值可被 `await`：`vendor/cordis/src/registry.ts:185` 的类型是 `Fiber & PromiseLike<Fiber>`，`:331-333` 把 `then` 接到 `fiber.await()` 上（`packages/boot/app-boot/src/index.ts:771` 正是 `await ctx.plugin(Loader)`）。
- `app.greeter` 是怎么"变"出实例的？这就是 2.4 节：代理拦截了读取，沿 fiber 链找到 `provide` 时存入的实现。读到实例的那一瞬间，你**并没有 import 任何提供方文件**。
- `declare module` 块：官方教程明确说它"使用 TypeScript 声明合并，把 `greeter` 加入 `Context` 接口……它不会生成代码；没有该声明时，服务在运行时仍能工作，但消费方会失去类型安全"（`docs/cordis-tutorial/03-services.zh.md:40`）。

> 本示例未在本机实际执行（当前环境未运行任何 Node 命令，属（未验证））；代码依据上述源码逐行核对，若你的仓库版本高于本书提交号，请以 `vendor/cordis/src/service.ts` 为准，API 不会变，行号可能漂移。

## 2.3 注册与唯一性：`provide` 的完整契约

### 2.3.1 一次注册的五步

`ctx.reflect.provide(name, value, check?)` 的实现在 `vendor/cordis/src/reflect.ts:277-305`，它被包在 `this.ctx.fiber.effect(...)` 里（`:278`）——**提供即 effect**。其主体五步：

1. **声明属性类型**（`vendor/cordis/src/reflect.ts:279-284`）：在 `props`（Context 属性目录，`vendor/cordis/src/reflect.ts:211`）里登记 `name` 是 `service` 类型；若同名属性已被声明为 `accessor`，抛错 `property "x" is already declared as accessor`（`:282`）。这保证名字空间里"一个名字一种含义"。
2. **取作用域键**（`:286-287`）：`this.ctx.root[symbols.isolate][name] ??= Symbol(name)`——首次注册时，为名字生成一个**全局唯一的 Symbol**，存入根的 isolate 表；`const key = this.ctx[symbols.isolate][name]` 再取当前上下文的版本（子 Context 可能覆盖）。**store 以这个 Symbol 为键**，而不是字符串名（`vendor/cordis/src/reflect.ts:208-209` 注释："Service implementations, keyed by isolation label"）。这是"同名服务可以存在于不同作用域"的全部秘密。
3. **查重**（`:289-291`）：`if (this.store[key]) throw new Error(...)`——**同一个作用域里，一个服务名只能注册一次**。报错文案是 `service "x" has been registered at <fiber.name>`，尖括号里是**先占者的 fiber 名**。这条报错你迟早会遇到：两个插件在同一作用域都提供了 `tools` 之类通用名，或同一个插件被挂了两次。
4. **入册**（`:292-293`）：`store[key] = impl`（全局册）且 `fiber.store![name] = impl`（当前 fiber 自己的快照）。`impl` 记录 `{ name, value, fiber, check }`（`:288`）——注意**登记了提供方 fiber**，这是第 6 步"谁写的谁删"的依据。
5. **通知**（`:294-296`）：若当前 fiber 已 ACTIVE，`this.notify([name])`——让所有等待该服务的 fiber 重新检查依赖（`notify` 遍历所有 runtime 的所有 fiber，对声明了 `inject` 的逐个 `_checkImpl` + `_refresh`，`vendor/cordis/src/reflect.ts:314-336`）。**消费方因此被"叫醒"**：你不用轮询，服务一出现，等待者自动启动。

### 2.3.2 注销：disposer 的逆序清扫

`provide` 返回的 disposer（`vendor/cordis/src/reflect.ts:297-303`）做三件事：从 store 删除（`:298`）→ `notify` 并 `await` 所有受影响的 fiber（`:299-300`，注释说"先保证自身可访问，再清理依赖"）→ 从 `fiber.store` 删除（`:302`）。**提供方卸载时，这个 disposer 由 fiber 的 effect 机制自动执行**——你不需要（也不应该）手动调用。这就是"服务自动注销"的实现：`vendor/cordis/src/service.ts:57` 把 provide 交给 `ctx.reflect`，类注释（`vendor/cordis/src/service.ts:8-10`）说的"automatically removed with the owning fiber"在此闭环。

### 2.3.3 边界：唯一性的"作用域"

重申第 3 步：**唯一性是 per-scope 的**。两个不同 isolate 作用域（2.5.2 节）可以有同名服务、指向不同实现——这正是"agent preset 里的服务行需要 `isolate` realm"（`docs/architecture.zh.md:116`）的机制底座。同作用域内二次注册才是错误。判断"是否同一作用域"，代码用的不是字符串比较而是** Symbol 恒等**：`store` 按 `ctx[symbols.isolate][name]` 得到的符号键取（`vendor/cordis/src/reflect.ts:238-243` 的 `_getImpl` 里 `store[key]` 正是这么查的）。符号谁生成的？第 2 步——根的 isolate 表，每个名字首次出现时生成一次（`vendor/cordis/src/reflect.ts:286`）。

## 2.4 `ctx.xxx` 按需解析：走到前台的那一刻

### 2.4.1 代理的 `get` 陷阱：六个分支

`new Context()` 返回的代理，其 `get` 陷阱在 `vendor/cordis/src/reflect.ts:135-171`。我们逐分支走一遍（读代码时请把 `target` 当作原始 Context 对象、`ctx` 当作代理本身）：

```ts
get: (target, prop, ctx) => {
  if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx)   // 分支 1
  if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx))  // 分支 2
  const error = new Error(`cannot get property "${prop}" without inject`)  // 分支 3 的"预警"
  try {
    const def = target.reflect.props[prop]
    if (def?.type === 'accessor') return def.get.call(ctx, ctx[symbols.receiver], error)  // 分支 4
    if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)   // 分支 5
    return ctx.events.waterfall('internal/get', ctx, prop, error, () => { ... })  // 分支 6
  } catch (e) { throw e === error ? enhanceError(e) : e }
}
```

- **分支 1（`isSpecialProperty`，`vendor/cordis/src/reflect.ts:136-139`）**：符号键、`prototype`/`then`、数字字符串、以 `_` 开头的属性，一律**绕过服务解析**直接透传（判定函数在 `vendor/cordis/src/reflect.ts:80-91`，注释写明这四类）。为什么？`then` 必须直通，否则 `await ctx` 会把 ctx 当 thenable；`_` 开头是内部约定（如 `_getImpl`）；数字串是数组索引习惯。
- **分支 2（自有属性，`:140-142`）**：`Reflect.has(target, prop)` 为真就直接返回。`ctx.reflect`、`ctx.events`、`ctx.fiber`、`ctx.root` 都在此命中——它们是"楼的自带设施"或构造器里定义的字段，不该经过服务查找。
- **分支 3（carrier error，`:144`）**：预先造一个 `cannot get property "x" without inject` 的 Error。它先不抛，而是沿途传递；一旦确认"真的找不到（且不该找）"，就抛出并增强栈（`:168-170`）。这个错误消息是 Cordis 最经典的报错之一：**你读了 `ctx.xxx`，但既没有服务提供它，也没有任何插件 `inject` 它**。
- **分支 4（accessor，`:146-150`）**：`props[prop]` 声明为 `accessor` 时调用自定义 get 钩子。accessor 是"计算属性"，由 `ctx.accessor()` 注册（`vendor/cordis/src/reflect.ts:345-353`），与服务的区别是它没有 store 实现、每次现算。
- **分支 5（根 fiber，`:152`）**：`!ctx.fiber.runtime` 意味着这是根 Context（根 fiber 无 runtime，`vendor/cordis/src/fiber.ts:320-333`）。此时退化为 `ctx.reflect.get(prop, false)`——**非严格**读取：没有就算了，返回 `undefined`，不报错。这正是为什么在插件还没装之前 `ctx.logger` 之类能安全读取。
- **分支 6（正式解析，`:153-167`）**：走 `waterfall('internal/get', ...)` 事件链（waterfall 是"每个监听器调用 `next()` 才放行"的分派模式，第 4 章详解；这里只有一个内置监听器，相当于直调）。其核心循环：

```ts
const key = target[symbols.isolate][prop]        // 本作用域下该服务的符号
let fiber = (ctx[symbols.shadow] ?? ctx).fiber    // 从当前 fiber 开始
while (true) {
  const impl = fiber.store?.[prop]                // ① 当前 fiber 的 store 里有？
  if (impl) return getTraceable(ctx, impl.value)
  if (prop in fiber.inject) {                     // ② 声明了 inject 但未激活？
    error.message = `cannot get required service "${prop}" in inactive context`
    throw error
  }
  if (!fiber.runtime) throw error                 // ③ 到根还没有 → 找不到
  if (fiber.parent[symbols.isolate][prop] !== key) throw error  // ④ 父级作用域变了 → 隔离断裂
  fiber = fiber.parent.fiber                      // ⑤ 向父 fiber 爬
}
```

把这段翻译成"前台寻房"：① 先在当前住客（当前插件 fiber）的自有抽屉里找；② 若该住客**声明过**要这间房（`inject`）却还没拿到，说明他还在等房（PENDING），此时读取是错误用法；③ 爬到楼的管理处（根 fiber）还没有，就是真没有；④ 若爬楼过程中发现父级的"作用域符号"与当前不同——例如子 Context 隔离了 `greeter` 而父级没有——说明你越界了，立即停止（**隔离即防火墙**）；⑤ 否则爬到父 fiber 继续。

### 2.4.2 "按需解析"到底按什么需

读者可能会问：每次 `ctx.greeter` 都爬一次 fiber 链，代价如何？答案是——**解析发生在读取时（lazy），但读取者自己决定何时读**。官方教程的说法是：`inject` 声明让插件保持 PENDING 直到依赖就绪，所以 `apply` 里可以放心读 `ctx.greeter`；**加载顺序与文件顺序无关，决定插件何时启动的是依赖关系**（`docs/cordis-tutorial/03-services.zh.md:59`）。而对没声明 `inject` 的可选依赖，官方推荐用 `ctx.get(name)` 探测（`docs/cordis-tutorial/03-services.zh.md:82-90`）——`get` 是"不带 inject 要求"的读取：只查 store、不触发依赖等待，`strict` 默认 `true` 时连"非 ACTIVE fiber 提供的实现"都跳过（`vendor/cordis/src/reflect.ts:233-243`）。

运行期语义上，解析是**活的**：服务消失→依赖它的插件（声明了 inject 的）被卸载；服务回来→重新加载（`docs/cordis-tutorial/03-services.zh.md:74-78`）。这一"活的依赖"就是 2.1 节所说的热替换能力，其实现一半在 `notify`（`vendor/cordis/src/reflect.ts:314-336`），一半在 fiber 的生命周期状态机——第 3 章完整讲解。

### 2.4.3 fiber 首次露面：最小定义

分支 6 里反复出现的 `fiber`，本章最小定义如下（完整状态机在第 3 章）：

**定义 2.3（fiber）。** fiber 是**一次插件应用的生命周期单元**：一个插件被挂载，就有一个 fiber（`vendor/cordis/src/fiber.ts:178-183` 的类注释："Runtime instance of one plugin application"）。root fiber 特例：`uid = 0`、状态恒为 `ACTIVE`、`execute` 为空函数、`dispose = () => this.restart()`——**永不卸载**（`vendor/cordis/src/fiber.ts:320-333`）。每个 fiber 持有自己的 store（其插件提供的服务）、inject（其依赖声明）与 effects（其可逆副作用登记）。`ctx.fiber` 就是"我当前住在哪个 fiber"的指针——分支 6 的爬链就是沿 `fiber.parent` 一路向根。

## 2.5 `extend` / `isolate` / `intercept`：三种"分身"与配置合并

### 2.5.1 共同点：不改父级

三种方法都创建**子 Context**（连锁分店），且都不改父级——注释原文分别是 `The parent is not mutated.`（`vendor/cordis/src/context.ts:94`）、`without affecting the parent scope`（`:114`）、`The parent context is not affected.`（`:133`）。区别只有一个问题：**分店隔离什么？**

### 2.5.2 逐个走读

**`extend(meta)`（`vendor/cordis/src/context.ts:99-107`）**——"开一家同设施的柜台"：子对象原型继承父的一切（`Object.create(getTraceable(this, this))`），`meta` 的自有属性**遮蔽**继承来的同名项（`:102-104`）。它不改父级，但也不隔离任何服务——它隔离的是**元数据**（比如给子 Context 挂一个 `label`）。isolate 与 intercept 在内部都调用它（`:124`、`:144`），所以它是"万能分身术"的底座。

**`isolate(name, label?)`（`vendor/cordis/src/context.ts:121-125`）**——"在分店里给某个服务开独立房间系统"：新建隔离表 `Object.create(this[symbols.isolate])`，并写入 `shadow[name] = label ?? Symbol(name)`（`:122-123`）。从此该 context 之下，读写服务 `name` 都走新符号而非父级的符号——可以挂不同的实现而不影响父作用域（`:110-114` 注释）。注释还强调：**给两次 `isolate()` 传同一个 `label`，会把两个作用域合并**（`:115`）——这就是"把一个提供方和它的消费方圈进同一 realm"的机制（`docs/architecture.zh.md:116` 说 agent preset 需要这个）。

**`intercept(name, config)`（`vendor/cordis/src/context.ts:139-145`）**——"入住时附加的说明单"：新建拦截表 `Object.create(this[symbols.intercept])` 并写 `intercept[name] = config`（`:142-143`）。效果是：该 context 之下启动的插件，解析服务 `name` 的配置时会把 `config` **合并进去**（祖先的条目在前；见 `Service[symbols.resolveConfig]`，`:127-133` 注释）。

三者对照表：

| 维度 | `extend(meta)` | `isolate(name, label)` | `intercept(name, config)` |
|---|---|---|---|
| 隔离对象 | 元数据（meta 自有属性） | 服务 `name` 的**作用域符号** | 服务 `name` 的**配置** |
| 底层 | 原型继承 + 遮蔽 | extend + 隔离表 | extend + 拦截表 |
| 对象变了吗 | 不变（新建） | 不变（新建） | 不变（新建） |
| 同一 label 复用 | — | 合并作用域（`vendor/cordis/src/context.ts:115`） | 后写覆盖（表原型链） |
| 典型用途 | 给子树打标记、传参 | 一服务多实现、agent 隔离 | 给某插件族统一注入配置 |

### 2.5.3 配置合并顺序的推导

`intercept` 的配置最终怎么合并？答案在 `resolveConfig`（`vendor/cordis/src/service.ts:86-102`）：

```ts
[symbols.resolveConfig](base?, head?) {
  let intercept = this.ctx[Context.intercept]      // 从当前（最叶子）的拦截表开始
  const configs: any[] = []
  while (this.name in intercept) {
    if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name])
    intercept = Object.getPrototypeOf(intercept)   // 沿原型链向祖先爬
  }
  if (base) configs.unshift(base)                  // base 压到最前（最低优先级）
  if (head) configs.push(head)                     // head 追加到最后（最高优先级）
  if (this['Config']?.merge) return this['Config'].merge(...configs)
  else return Object.assign({}, ...configs)        // 浅合并，后者胜
}
```

推导合并顺序（这是本章最重要的一个推导，请跟着走一遍）：

1. `configs.unshift` 配合"从叶子往根爬"，等价于"**根先、叶后**"——祖先的 intercept 在最前面，离当前 context 最近的拦截在最后面；
2. `base` 再 `unshift`，成为**最前**（最低优先级）；`head` 最后 `push`，成为**最后**（最高优先级）；
3. 合并方式：服务声明了 `this['Config'].merge`（一个可选的静态合并器）就用它，否则 `Object.assign({}, ...configs)` ——**浅合并**，同名键后者胜（`vendor/cordis/src/service.ts:97-101`）。

一句话记住：**intercept 的优先级是"离根越远、优先级越高"，base 垫底、head 封顶；浅合并、后者胜**。`LoggerService` 自己的拦截解析（`vendor/cordis/src/logger.ts:239-249`）几乎逐行复刻了这个模式——只是把名字钉死在 `'logger'` 上：`_resolveConfig()` 沿 `symbols.intercept` 原型链收集（`:240-247`）后 `Object.assign`（`:248`）。这个"同一模式、两个实现"的现象值得注意：`Service[symbols.resolveConfig]`（`vendor/cordis/src/service.ts:86-102`）的通用实现把"声明 `Config.merge` 才深合并"作为**可选**路径，而 logger 的 `_resolveConfig`（`vendor/cordis/src/logger.ts:239-249`）是"固定浅合并"的**必选**路径——注意 `resolveConfig` 由 fiber 的配置解析链调用（`vendor/cordis/src/fiber.ts:643` 的 `_resolveConfig` 先走 `internal/config` 瀑布再校验 schema，见第 3、5 章），并非发生在 Service 构造器里。读源码时看到重复不要惊讶，这是"通用性 vs 明确性"的取舍。（推断）

### 2.5.4 可调用的服务：`[Service.invoke]`

还有一个"服务形状"的变体：**服务实例本身可以是个函数**。`vendor/cordis/src/service.ts:50-52`：

```ts
if (self[symbols.invoke]) {
  self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker)
}
```

若子类实现了 `[symbols.invoke]` 方法，构造器就把实例包装成**可调用对象**——保留原 prototype 方法的同时，`self(...)` 会转发到 `invoke`。`createCallable` 的实现（`vendor/cordis/src/utils.ts:226-233`）创建函数、把 `name` 设为服务名、把原型链设为"实例原型 + Function.prototype"。最著名的例子是 `ctx.logger('task')`：`LoggerService[symbols.invoke]`（`vendor/cordis/src/logger.ts:251-261`）按当前拦截配置解析出名字与级别，返回一个具名 Logger；`vendor/cordis/src/logger.ts:263-269` 甚至把 `error/info/warn/debug` 直接挂到原型上转发给调用本身，所以 `ctx.logger.error('...')` 也成立。`Service[symbols.extend]`（`vendor/cordis/src/service.ts:65-73`）对可调用服务同样保留可调用性（`vendor/cordis/src/service.ts:67-69`）。

## 2.6 边界与例外：什么时候会报错

（本节回答"读源码时最容易踩的四个坑"。）

**① 只能读，不能随意写：`ctx.xxx = y` 需要权限。** proxy 的 `set` 陷阱（`vendor/cordis/src/reflect.ts:173-197`）：非特殊属性若未在 `props` 里声明，且当前 fiber 有 runtime（不是根），直接抛 `cannot set property "x" without provide`（`:178-183`）。声明过且是 accessor 的走 setter（`:186-189`）；是 service 的回退到 `internal/set` 事件链（`:191-193`），最终到 `ReflectService.set`（`vendor/cordis/src/reflect.ts:254-265`）：若从未 provide 过，报 `cannot set property "x" without provide`（`:257-259`）；若提供方 fiber **不是当前 fiber**，报 `cannot set property "x" in multiple fibers`（`:260-262`）。翻译成房卡语言：**只有开这间房的人（提供方 fiber）才能换房里的陈设，其他住客只能使用。**

**② 读取有"新鲜度"要求：strict 模式跳过非活跃实现。** `ctx.get(name)` 默认 `strict = true`：`_getImpl` 对 `impl.fiber.state !== ACTIVE` 的实现直接返回 `undefined`（`vendor/cordis/src/reflect.ts:237-243`）。为什么？一个 UNLOADING 的 fiber 正在退房，它的服务已经不可信；拿到半截实现反而危险。

**③ 服务即 effect：注册/注销成对出现，且卸载顺序逆序。** `provide` 包在 `fiber.effect` 里（`vendor/cordis/src/reflect.ts:278`），effect 的契约是：执行体立即运行，产生的 disposer 逆序收集、在 fiber 卸载或 disposer 被调用时串行执行（`vendor/cordis/src/fiber.ts:402-441`，`:431` 的 `splice(0).reverse()`）。`provide` 的 disposer 正是 `vendor/cordis/src/reflect.ts:297-303`。所以**你永远不需要"手动注销服务"**——插件卸载时，它提供的一切自动消失；反过来，若在插件代码里写了"手动删除 store"之类，才是违反契约。另外注意 effect 注册的时机：`vendor/cordis/src/fiber.ts:419-422` 显示，fiber 处于 `UNLOADING` 时再注册 effect 会被拒绝（`INACTIVE_EFFECT`）——退房手续办到一半，不能再开新订单。

**④ 命名空间是扁平的。** 所有服务名共用一个扁平命名空间（`docs/cordis-tutorial/03-services.zh.md:92-94`）：请为自己的服务加有辨识度的前缀；harness 已经占用 `tools`、`llm` 等普通名。这解释了 2.3.1 查重报错的现实意义——不是 Cordis 小家子气，而是**名字就是契约**，撞名即事故。

## 2.7 与 dsh 的关系：vendored Cordis 与本地修改

### 2.7.1 为什么是 `@deepseek-ai/cordis`

`dsh` 没有把 Cordis 当作普通 npm 依赖，而是**vendor 进仓库**（`vendor/cordis/`）。`vendor/README.md:3-5` 说明动机：把框架层完全收归自身（可审计、可打补丁、可固定版本），并把所有 vendored 包的 npm 名改到 `@deepseek-ai` scope（`cordis` → `@deepseek-ai/cordis`），因为 harness 包把 Cordis 声明为 peer 依赖，若按上游名发布就是占名。

因此本章引用的 `vendor/cordis/src/context.ts` 里的 `@param`/`@returns` 注释，很多并非上游原文，而是**本地修改 #7**（JSDoc 增强："Comment-only; no code changes"，`vendor/README.md:39`）——本章所以能频繁引用这些注释，正是这次修改的功劳。

### 2.7.2 版本的两个数字

`vendor/README.md:17` 的清单表写的是：cordis，上游名 `cordis`，**版本 `4.0.0-rc.7`**，上游仓库 `cordiverse/cordis`，commit `56b3d4f725681cf4556c1a8695a709cc3b6eed74`；而 `vendor/cordis/package.json:4` 的 `version` 是 **`4.0.1`**。两处数字为何不同？表格语义是"上游快照"——README 正文说 "the manifest below still reads as an upstream snapshot"，且"Directory names and upstream version numbers are deliberately unchanged"（`vendor/README.md:5`）；package.json 则是仓库内发布版本——本地修改 #2（package.json 重建，`vendor/README.md:34`）把版本推进到 4.0.1 而**保留**了 manifest 表里的上游版本快照记录。读代码时以 `package.json` 为准，追溯上游差异以表为准。（推断：两者不一致是为同时满足"可追溯上游"与"本地独立发布"两个目标。）

### 2.7.3 与本章相关的本地修改清单

`vendor/README.md:33-50` 共 **18 条**本地修改（条目编号 1–18；不是 16 条，全书引用以 18 条为准）。本章相关条目：

| 编号 | 内容 | 与本章关系 |
|---|---|---|
| #6 | `cordis/src/fiber.ts` 生命周期加固（`vendor/README.md:38`） | effect 的卸载时序、UNLOADING 拒绝注册等，2.6 节③的描述依据；完整状态机第 3 章 |
| #7 | JSDoc 注释增强（`vendor/README.md:39`） | 纯注释；2.2 节引用的类注释大多出自此条 |
| #15 | 懒配置解析（`vendor/README.md:47`） | 配置表达式延迟到依赖激活后再求值；第 3、5 章详解 |
| #16 | `cordis/package.json` 发布 `src`（`vendor/README.md:48`） | 保留 `./src/*` 导出（`vendor/cordis/package.json:23,31`），教程才能引用源码行号 |
| #17 | `@deepseek-ai` rescope（`vendor/README.md:49`） | `@deepseek-ai/cordis` 名称与身份来源 |

另外，`vendor/cordis/src/index.ts:1-14` 是 barrel 导出：本章所用 `Context`、`Service` 全部从这里 re-export（九个子模块共 2693 行）。`bin.js`（`vendor/cordis/bin.js:1-16`）是 Cordis 自带的演示启动器（`new Context()` + Loader + include `./cordis.yml`）——读了本章再看它，你已经能看懂每一行。

## 本章小结

- **Context** 是依赖容器，**Service** 是"在 `ctx` 上暴露具名 API"的基类；`new Context()` 装四个内置服务、造根 fiber，并**返回代理**（`vendor/cordis/src/context.ts:71-84`）。
- **注册即 effect**：`super(ctx, name)` → `provide` 五步（声明 props → 取 isolate 符号 → 查重 → 入册 → 通知）；同作用域重复注册抛 `service "x" has been registered at <fiber.name>`（`vendor/cordis/src/reflect.ts:277-305`）。
- **读取即解析**：`ctx.xxx` 走 Proxy 六分支（特殊属性直通 → 自有属性直通 → accessor → 根退化 → 沿 fiber 链爬 store）；隔离决定能否跨层，`inject` 声明决定是否"等房"（`vendor/cordis/src/reflect.ts:135-171`）。
- **三种分身**：`extend` 隔离元数据、`isolate` 隔离作用域符号（同名服务多实现）、`intercept` 隔离配置——都不改父级；配置合并为"根先叶后、base 垫底、head 封顶、浅合并后者胜"（`vendor/cordis/src/context.ts:99-145`、`vendor/cordis/src/service.ts:86-102`）。
- **边界**：写服务只许提供方 fiber；strict 读跳过非 ACTIVE 实现；服务随 fiber 卸载自动注销；服务名扁平命名空间。
- dsh 使用 vendored `@deepseek-ai/cordis`（上游 4.0.0-rc.7 快照 + 18 条本地修改），本章引用注释多来自本地修改 #7。

## 练习

**理解层**
1. 不用看代码，用酒店类比解释：为什么"消费方只报名字"比"import 提供方"更适合"配置换实现"（提示：结合 `docs/cordis-tutorial/03-services.zh.md:5` 与 `:76`）。
2. 请说出 `new Context()` 中 `:74` 与 `:83` 两行配合的意图（为什么必须 `return self` 且 `self` 是 Proxy）。

**应用层**
3. 写一个计数器服务 `CounterService`（`super(ctx, 'counter')`，方法 `inc()`/`value()`），并写一个插件在 `apply` 里 `ctx.counter.inc()` 两次后打印。要求：用 `declare module` 增强类型；说明 `ctx.counter` 第一次读取发生在哪个分支。
4. 用 `extend` 与 `isolate` 各写一段：父子 Context 共享/不共享同一计数器。记录两者的服务解析差异，并画一张"沿 fiber 链搜索"的示意图（提示：`vendor/cordis/src/reflect.ts:153-167` 的爬链循环）。

**综合层**
5. 某插件启动报 `service "tools" has been registered at <sometools>`。请解释：这条错误在 `vendor/cordis/src/reflect.ts:289-291` 的哪个条件触发；给出两种合法修复（提示：作用域符号、命名空间，`docs/cordis-tutorial/03-services.zh.md:92-94`）。
6. 服务 A 在子 Context 用 `intercept('logger', { level: 'debug' })`，父 Context 用 `intercept('logger', { level: 'info' })`，服务在子 Context 下解析。推导最终 `level` 并给出依据（提示：`vendor/cordis/src/service.ts:86-102` 的 unshift 顺序与 Object.assign 后者胜）。

**挑战层**
7. 参照 `LoggerService[symbols.invoke]`（`vendor/cordis/src/logger.ts:251-261`）与 `vendor/cordis/src/service.ts:50-52`，写一个可调用的 `EchoService`：`ctx.echo('hi')` 返回模板字符串，同时保留 `ctx.echo.description` 属性可读。说明你的子类需要实现哪个符号方法、`createCallable`（`vendor/cordis/src/utils.ts:226-233`）在其中扮演什么角色。

## 延伸阅读

- `docs/cordis-primer.md`——Cordis 入门（假定你已了解 Cordis 的架构文档都从这里开始）。
- `docs/cordis-tutorial/03-services.zh.md`——本章多处引用的服务教程；顺带读 `02-lifecycle-and-effects` 与 `04-events`，与第 3、4 章衔接。
- `vendor/cordis/src/{context,service,reflect}.ts`——本章三个核心文件；`fiber.ts` 留到第 3 章。
- 上游仓库 `cordiverse/cordis`（清单见 `vendor/README.md:17`）——对比上游可看出 18 条本地修改的取舍。
