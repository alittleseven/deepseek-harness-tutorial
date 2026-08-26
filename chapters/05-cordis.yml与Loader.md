# 第 5 章　cordis.yml 与 Loader：配置文件如何变成插件实例

> **本章讲法**：接口/使用型 + 机制型——场景驱动："我要用 YAML 声明一棵插件树"。先解决"文件里那一行行文本到底是什么"，再看它们如何变成插件实例，最后用最小可运行示例验证全部语义。
>
> **学习目标**（可测）：
> 1. 写出一份能挂载一个自写插件的 `cordis.yml`，并能说出每一行与插件实例、fiber 的对应关系；
> 2. 精确复述 patch 的三类操作（insert / 按 id 覆盖 / disabled）与"插入行立即建索引"的含义；
> 3. 解释为什么 config 是**整行替换**而不是合并，以及"patches 内联"与"独立 patch 文件"等价的根据；
> 4. 说清 `!!js` 表达式的求值时机，以及 schemastery 校验发生在插值之后的顺序。

## 5.1 场景：用一份文本文件声明整棵插件树

第 1 章里你已经见过整棵插件树模样：bundle 把插件一行行"铺"出来（`dsh --dump-config` 的输出就是证据）。第 2、3 章你已经亲手写过插件（一个函数、一个对象、一个 Service 子类），也知道 `ctx.plugin(plugin, config)` 会创建 fiber 并启动它。现在的问题是：**谁来记住"应该挂载哪些插件、各带什么配置"**？答案是一份文本文件——`cordis.yml`——以及把它变活的 Loader。

这一章只研究一件事：**从 YAML 文本到插件实例的转换器**。它由三个 vendored 包组成，都在仓库根目录下 `vendor/` 里：`cordis-plugin-loader`（目录 `vendor/loader`）负责"把配置行变成插件实例"，`cordis-plugin-include`（目录 `vendor/include`）负责"从文件读出配置行并应用补丁"（该 include 插件本身也是 loader 的一种"文件后端"），`cordis-plugin-group` 负责嵌套组（见 5.2.3）。三者都是框架层实现，不是 dsh 的业务代码——它们在 `vendor/README.md` 的清单里对应上游包与版本（loader = `@cordisjs/plugin-loader` 1.0.0-rc.5、include = `@cordisjs/plugin-include` 1.0.4、group = `@cordisjs/plugin-group` 1.0.0，`vendor/README.md:18-20`），dsh 把它们改名进 `@deepseek-ai` 作用域并做了 16 条本地修改（本章将触及第 8、11、15 条）。三者的分工可以记成一句话：**loader 认插件，include 认文件，group 认嵌套**。

在深入之前，先把本章要用的三个新概念按"先讲后用"的顺序铺开：YAML（5.1.1）、Entry（5.2）、`!!js`（5.3）、patch（5.4）。每一节都遵循"类比 → 精确定义 → 最小示例"三步。

### 5.1.1 YAML：先认识这门"数据语言"

**③ 最小示例先行**，因为 YAML 在仓库里几乎只出现在一种形态——顶层数组：

```yaml
# cordis.yml：一个"条目列表（entry list）"
- id: greeter          # 数组元素 1：一个映射（mapping）
  name: './greeter.ts'
- id: second           # 数组元素 2
  name: './other.ts'
```

**① 类比**：如果你写过 `.json`，那么 YAML 就是"允许不写引号、允许注释、用缩进代替花括号"的同类数据格式。它像用记事本写的一份分条清单：`- ` 开头是一"条"，每条下面 `键: 值` 是这条的属性。

**② 精确定义**：YAML（"YAML Ain't Markup Language"的递归缩写）是一种人类可读的数据序列化语言，是 JSON 的超集——任何合法 JSON 都是合法 YAML，因此同一份数据可以两种格式书写。dsh 用它表示两种数据：**条目列表**（顶层数组，本章主角）与 **patch 列表**（5.4 的主角）。YAML 里用缩进表达嵌套、`- ` 表示数组元素、`key: value` 表示映射项、`#` 起注释。解析时 dsh 用的是 js-yaml 的 `JSON_SCHEMA` 方言并扩展了一个自定义标签（见 5.3），所以这份 YAML 中"合法的值"被严格限定为 JSON 类型加一个特殊标签——不要期待它像完整 YAML 那样支持任意锚点、时间戳等类型。

### 5.1.2 转换链路全景

从文本到实例的完整链路（本章先走读，`boot` 函数与 mount 细节在第 6 章 6.6 展开）：

```
cordis.yml 文本
  → Include 插件读取、yaml 解析、应用 patches      （vendor/include）
  → EntryTree 为每个配置行创建 Entry             （vendor/loader，EntryGroup.create）
  → Entry：import 模块 → registry.plugin(插件) → fiber.await()
  → 每个配置行 = 一个插件实例 = 一个 fiber          （vendor/cordis）
```

其中"EntryTree 为每个配置行创建 Entry"对 `group: true` 的行会递归展开（子清单里的行也走同一条链），因此这条链路对**任意深度**的树都成立——这是本章后面所有机制（patch 的组内插入、热重载的整树重建）的共同底座。

## 5.2 Entry：清单上的一行 = 一个插件实例

### 5.2.1 三步理解 Entry

**① 类比**：把 `cordis.yml` 想成一份旅行团行程单，每一行是一个"站点"（destination）。站点上写三件事：**去哪儿**（模块名 `name`）、**怎么称呼这个站点**（稳定 id）、**带什么行李**（配置 `config`）。第 3 章说过，每挂一个插件就产生一个 fiber；那么"行程单上的一个站点"在代码里就是 `Entry`——**一个配置节点，它管理着一个插件实例的整个生命周期**（import、启动、配置热更、卸载）。

**② 精确定义**：Entry 对应的"行"的类型是 `EntryOptions`（`vendor/loader/src/config/entry.ts:9-22`）：

```ts
export interface EntryOptions {
  /** Stable id inside the containing entry tree. */
  id: string
  /** Module specifier imported by the entry tree. */
  name: string
  /** Config passed to the plugin. */
  config?: any
  /** Marks this entry as a nested group. */
  group?: boolean | null
  /** Prevents this entry and descendants from running. */
  disabled?: boolean | null
  /** Required services or service intercept config for this entry. */
  inject?: Inject | null
}
```

Loader 自身还补充了两个选项 `intercept`、`isolate`（`vendor/loader/src/config/isolate.ts:5-9`），它们是第 2 章「拦截配置 / 隔离表」在配置文件里的入口（`isolate: { planMode: true }` 的写法见 `apps/cli/config/agent-presets/standard/agent.cordis.yml:107-108`，第 7 章再细讲）。运行时对象 `Entry`（`vendor/loader/src/config/entry.ts:52-61`）持有 `options` 与一个**专属子上下文**：构造函数里 `this.ctx = loader.ctx.extend({ [Entry.key]: this })`（`vendor/loader/src/config/entry.ts:66-68`）——每个 Entry 都在 loader 上下文下 extend 出一片"领地"，第 3 章的 fiber 就把插件挂在这片领地上；id 则通过 getter 把父链上的 id 用分隔符 `:`（`EntryTree.sep`，`vendor/loader/src/config/tree.ts:8`）串起来，所以嵌套组里的一行地址形如 `root:child`（`vendor/loader/src/config/entry.ts:75-81`）——这正是 patch 里写 id 时用的地址格式。

**③ 最小示例**：上面 5.1.1 的两行 YAML 意味着：Loader 会 import `./greeter.ts` 模块，把导出的插件用 `registry.plugin(plugin, undefined)` 启动成一个 fiber；`greeter` 这个 id 成为它在这棵树里的寻址地址。

### 5.2.2 一个配置行如何变成活的插件

这是整章最核心的一小段，走读 `Entry._start`（`vendor/loader/src/config/entry.ts:291-302`）：

```ts
private async _start(plugin: any) {
  let fiber: Fiber | undefined
  try {
    await this._patchContext([])
    this.loader.showLog(this, 'apply')
    fiber = this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack)
    await fiber.await()
  } catch (error) {
    await this._dispose(fiber)
    throw error
  }
}
```

逐句讲：`_patchContext([])` 先把 Entry 的子上下文原型对齐到当前父级（把 `intercept`/`isolate` 原型链接好，细节见 `vendor/loader/src/config/entry.ts:114-122` 与 `vendor/loader/src/config/isolate.ts:96-153`）；然后 `registry.plugin(plugin, this.options.config, …)`——这正是第 3 章那个创建 fiber 的 API，`this.options.config` 就是 `cordis.yml` 里那一行的 `config`；等待 `fiber.await()`（第 3 章：等待 PENDING→ACTIVE 并重抛失败）。若启动失败，`_dispose(fiber)` 把半成品 fiber 卸载后抛错——所以**一行配置的失败在加载期就浮出水面**，而不是运行时才炸。

`Entry.create → Entry.update` 还维护了一个"事务"：`update(options)`（`vendor/loader/src/config/entry.ts:142-246`）先把新旧选项做 diff——`isNullable(value)` 的键会被删除而不是赋 `null`，键序经 `sortKeys` 归一（`vendor/loader/src/config/entry.ts:146-154`），再逐键 `deepEqual` 比较，**没有任何差异且非强制更新就直接返回**（`vendor/loader/src/config/entry.ts:158-160`）——所以文件名被重写但内容没变时，热重载不会做任何事。有差异时：只 `config` 变化走 `_patchContext` 热更新——不重启，fiber.update 走 `internal/update` waterfall（`vendor/loader/src/config/entry.ts:194-212`）；只有 `name`/`inject`/`group` 变化才 import 新模块、卸载旧 fiber、再启动（`vendor/loader/src/config/entry.ts:214-245`），任一步失败回滚到旧插件/旧配置。这套事务是仓库对上游做的重要本地修改（vendor README 第 8 条）：**热重载时改坏的一行不会杀死整棵树**——第 6 章的 HMR 就建立在它之上。

### 5.2.3 group：行里的"子清单"

行程单上还可以有一行"分团"：`group: true` 的行，其 `config` 不再是本插件的配置，而**是子条目列表**（`EntryGroup`，`vendor/loader/src/config/group.ts:6-14`）。Group 插件（`vendor/loader/src/config/group.ts:116-128`）挂载时 `await this.update(this.config)`——把子列表逐行 `create` 成子 Entry，`internal/update` 事件触发时整体重建子列表（`vendor/loader/src/config/group.ts:122`）。它就是 `cordis:group` builtin 的实现（`apps/cli/config/agent-presets/standard/agent.cordis.yml:105` 的 `name: cordis:group` 即它）。嵌套组让"一棵树"名副其实，也是第 7 章 agent preset 用一行隔离一组插件的基础。

**⚠ 没有 `id` 会怎样**：`EntryGroup.create` 调 `tree.ensureId(options)`（`vendor/loader/src/config/group.ts:20-21`，定义在 `vendor/loader/src/config/tree.ts:66-73`）——没有 id 就现场生成一个随机 8 位十六进制串。后果：每次重新读文件，这行的 id 都不同，Entry 的 diff 全变，表现为"先删后加"（整个插件重启而非热更）。所以**凡是要被 patch 或热更的行，必须写稳定的 id**。

## 5.3 `!!js`：货箱上的标签

### 5.3.1 三步理解 `!!js`

**① 类比**：海运集装箱上贴的标签告诉你"里面装的是危险品还是水果"，但标签并不改变箱内货物，只是声明。YAML 标签（tag）就是一个节点的类型声明；`!!js` 是标签 `tag:yaml.org,2002:js` 的缩写，声明"**这个标量的内容不是普通字符串，而是一段 JavaScript 表达式**"。

**② 精确定义**。`!!js` 不是 YAML 标准标签，所以默认方言不认识它——`cordis-plugin-include` 用 js-yaml 的扩展机制把它注册进自己的方言（`vendor/include/src/index.ts:9-15`）：

```ts
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),   // 解析结果：一个"表达式包裹节点"
  predicate: isJsExpr,
  represent: (data) => data['__jsExpr'],
})
```

注意 `construct`：解析成功后 `process.cwd()` 这样的字符串**不会变成函数调用**，只变成一个对象 `{ __jsExpr: 'process.cwd()' }`——真正的求值推迟到 Loader 激活插件时。这个方言被命名为 `entryListSchema` 并显式导出（`vendor/include/src/index.ts:23`：`yaml.JSON_SCHEMA.extend(JsExpr)`），Include 用它解析配置文件（`vendor/include/src/index.ts:250-251`），`dsh --dump-config` 也用它（`packages/boot/app-boot/src/index.ts:393`），保证"打印用的方言 = 挂载用的方言"。

求值发生在 `interpolate`（`vendor/loader/src/config/utils.ts:12-22`）：递归遍历值，凡见到 `isJsExpr(value)`（`value instanceof Object && '__jsExpr' in value`，`vendor/loader/src/config/utils.ts:25-27`）就替换为 `evaluate(ctx, value.__jsExpr)`（`vendor/loader/src/config/utils.ts:5-9`）；**普通对象与数组按元素递归**（`vendor/loader/src/config/utils.ts:15-20` 对数组 `map`、对对象走 `valueMap`），所以 `config` 里嵌套多层的表达式同样会被求值——遍历不进入"是否应当求值"的开关，只认节点形状。

```ts
export const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`)
```

`with (ctx)` 意味着表达式里能直接写 `ctx` 上的一切——服务名（如 `dshHomePath`，boot 时被 provide，`packages/boot/app-boot/src/index.ts:770`）、以及外层作用域可见的全局（`process`、`Math`、`console` 等）。`examples/headless-agent/cordis.yml:54` 的 `cwd: !!js process.cwd()` 与 `:67` 的 `compression: !!js "process.env.DSH_SNAPSHOT === undefined ? 'zstd' : 'none'"` 都是这个机制的真实用例。**安全提示**：配置文件即代码——只加载你信任的 cordis.yml 与 patch 文件。

**③ 何时求值——这是本小节的关键**。Loader 在 `internal/config` 这个 waterfall 事件（第 4 章：waterfall 是环绕式中间件）上挂了一个全局监听器（`vendor/loader/src/index.ts:92-101`）：

```ts
ctx.on('internal/config', function (this: Fiber, _config, next) {
  const config = next()
  if (!this.entry || this.parent.fiber?.entry === this.entry) return config
  const plugin = this.runtime?.callback as Record<PropertyKey, unknown> | undefined
  if (plugin?.[EntryGroup.key]) return config     // 树载体（Group/Include）保持字面
  return interpolate(this.ctx, config)
}, { global: true })
```

含义：fiber 解析配置时（`vendor/cordis/src/fiber.ts:641-644` 的 `_resolveConfig` 先走 `internal/config` waterfall），**每个 Entry 根 fiber 用自己的 ctx 求值一次**自己的 `config`；树载体（Group 与 Include，都标了 `EntryGroup.key`，见 `vendor/include/src/index.ts:182`）的 config 是"别的行的列表"，必须保持字面，不插值——否则会把子行的 `!!js` 提前烤死。`disabled` 字段则不同：它不在 config 插值里，而是**每次挂载决策时**用 Entry 自己的 ctx 求值（`vendor/loader/src/config/entry.ts:104-108` 的 `disabledOf`），所以 `packages/bundle/base/cordis.patch.yml:178-180` 可以写 `disabled: !!js process.platform === 'win32'` 做平台门控。其余元数据（`name`/`id`/`inject`）保持字面——在那些字段里写 `!!js` 只会得到一个 `{__jsExpr}` 对象而不是表达式结果。

**③ 最小示例**：

```yaml
- id: greeter
  name: './greeter.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? '默认问候'
```

`greeting` 的值在插件启动时由表达式算出：环境变量有值用环境变量，否则用默认值。

## 5.4 patch：给写好的清单开"处方"

### 5.4.1 为什么需要 patch

场景：组合包（bundle，第 7 章展开）已经把整棵树铺好了——base 里插进了 timer、session、tools 等行——但这些行住在 `node_modules` 里的 `cordis.patch.yml` 中，属于"安装自带"，你不能改它；你也不想 fork 一份。你要做的只是三件小事：**改一行的配置、加一行、禁掉一行**。patch（补丁）就是干这个的：它不改原文件，只声明"对哪一行做什么"。

**精确定义**：patch 列表是 `PatchOptions[]`（`vendor/include/src/index.ts:144-156`）：

```ts
export interface PatchOptions {
  id?: string
  insert?: EntryOptions[]
  name?: string
  config?: any
  group?: boolean | null
  disabled?: boolean | null
  inject?: any
  intercept?: any
  isolate?: any
  [key: string]: any
}
```

读法：一条 patch 要么 `insert`（插入若干行），要么带 `id`（命中已有行）并给出要覆盖的键；`name` 只用于**校验**而非赋值。

### 5.4.2 applyEntryPatches 逐段走读

所有 patch 语义浓缩在一个纯函数里，全量摘录其骨架（`vendor/include/src/index.ts:58-128`）：

```ts
export function applyEntryPatches(
  data: EntryOptions[],
  patches: PatchOptions[] | undefined,
  warn: (message: string, ...args: any[]) => void,
): EntryOptions[] {
  data = structuredClone(data)                    // ① 输入永不修改
  if (!patches?.length) return data

  const entryMap = new Map<string, EntryOptions>() // ② 递归建 id 索引
  const buildMap = (entries: EntryOptions[]) => {
    for (const entry of entries) {
      if (entry.id) entryMap.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) buildMap(entry.config)
    }
  }
  buildMap(data)

  for (const patch of patches) {                  // ③ 逐条应用
    const { id, insert, name, ...overrides } = patch

    if (insert) {                                 // ③a insert 分支
      if (id) {
        const target = entryMap.get(id)
        if (!target) { warn('patch insert: entry %C not found', id); continue }
        if (!target.group) { warn('patch insert: entry %C is not a group', id); continue }
        if (!Array.isArray(target.config)) target.config = []
        target.config.push(...insert)             // 插入到组内
      } else {
        data.push(...insert)                      // 插入顶层
      }
      buildMap(insert)                            // ③b 插入行立即建索引 ★
      continue
    }

    if (!id) { warn('patch: id is required for non-insert patches'); continue }
    const target = entryMap.get(id)
    if (!target) { warn('patch: entry %C not found', id); continue }
    if (name && name !== target.name) {           // ③c name 只校验
      warn('patch: name mismatch for %C (expected %C, got %C), skipping', id, target.name, name)
      continue
    }
    for (const [key, value] of Object.entries(overrides)) {  // ③d 整键覆盖
      if (key === 'id') continue
      target[key] = value
    }
  }
  return data
}
```

逐段解读：

- **① 克隆**：`structuredClone(data)`。注释（`vendor/include/src/index.ts:44-52`）说得很明白：输入永不修改、结果永远脱离输入——即使没有 patch。理由：patching 或挂载时如果直接改共享的 entry 对象，早期补丁的结果会被"烤进"缓存解析，之后热重载想移除某条补丁就再也回不去了。**clone 是"可回退"的代价**。
- **② 索引**：只认有 `id` 的行；嵌套组递归进同一张 Map——组内子行全局可寻址。没有 id 的行/补丁对不上号。
- **③a insert 无 id**：追加到顶层；**带 id**：目标必须是组（`group: true`），插进它的 `config` 子列表；目标缺失或不是组 → `warn` 跳过（不抛错）。
- **③b ★ 插入行立即建索引**：`buildMap(insert)`。这一行代码是整个多层补丁系统的基石：**同一份 patch 列表里，后面的 patch 可以命中前面刚插入的行**。上游 cordis 是一次性建好索引后就不再更新，dsh 特意修复成即时索引（vendor README 本地修改第 11 条；`vendor/include/src/index.ts:96-100` 注释：每个来源一层、层与层之间必须能配置或禁用上一层插入的行，否则插入行将"静默不可补丁"）。
- **③c name 校验**：提供了 `name` 且与目标行 `name` 不符 → warn 跳过。这是防手滑（把 `id: tools` 的 patch 误当成 `id: tool-fs` 之类）的护栏，**name 本身不会被覆盖**。
- **③d 整键覆盖**：`target[key] = value`——逐键直接赋值，**不做任何合并**；`config` 因此是**整行替换**。这也是第 6 章"多层补丁"能确定性地"后来者胜"的原因。

### 5.4.3 三类操作与"整行替换不合并"

| 操作 | 写法 | 效果 |
|---|---|---|
| 插入 | `- insert: [ 行… ]`（可带 `id` 指定组） | 顶层或组内加行；插入行立刻可被后续 patch 命中 |
| 覆盖 | `- id: x` + 任意键（含 `config`） | 目标行整键替换；config 整体替换不合并 |
| 禁用 | `- id: x` + `disabled: true` | 该行及后代不运行（`vendor/loader/src/config/entry.ts:84-98`：group 恒启用；沿父链检查） |

"整行替换"的设计理由，`packages/bundle/base/cordis.patch.yml:1-13` 的头注释写得直接：

> A patch replaces the targeted row's whole `config` rather than merging into it, so a row whose value differs by mode does NOT live here: it belongs to each mode bundle, keeping any single row down to one bundle layer plus the user's.

翻译成规则：**一行配置的"完整形态"必须能由某一层独立写全**。如果支持合并，"旧键残留"与"谁优先"将充满歧义（比如 base 设了 `a: 1, b: 2`，web-app 只想改 `a`——合并语义下 `b` 保留还是被清掉？两派实现都有道理）。整行替换把规则钉死为"**每行最终状态 = 最后一个写它的层**"（last write wins per row）。实践含义：你想覆盖一行时，要写出**整份** config，而不是"增量"。

### 5.4.4 `patches:` 内联与独立 patch 文件：等价性

场景再进一层：`--patch` 是文件，bundle 层也是文件——那"把补丁直接写在 config 里"（内联）和"写成独立文件"是不是一回事？答案是**等价**，依据在调用链上：

- `Include.Config` 本身就有 `patches?: PatchOptions[]` 字段（`vendor/include/src/index.ts:161-170`）；
- 挂载时 `mountRootInclude` 把补丁数组放进这个字段（`packages/boot/app-boot/src/index.ts:514-517`：`{ path, ...patches.length > 0 ? { patches: [...patches] } : {} }`）；
- Include 挂载时 `_apply` 里统一 `applyPatches(candidate.data, this.config.patches)`（`vendor/include/src/index.ts:315-321`）。

也就是说：**无论补丁来自哪个文件、谁的手，最终都是同一个 `applyEntryPatches(data, patches)` 调用**，`data` 来自被 include 的条目文件，`patches` 来自配置文件里内联的数组或解析好的 patch 文件。两者唯一的差别是**来源与可监视性**：独立文件可以被 HMR 监视（第 6 章 `watchUserPatches` 就是在监视 `cordis.patch.yml`），内联数组没有独立文件可盯。5.6 的实验将用嵌套 include 同时演示两形态。

### 5.4.5 多处 patch 的叠加顺序

规则很简单，但后果要背下来：

1. **同列表内按数组顺序**；同一个 id 被多次命中时，因为索引里的对象是同一个，**后面的覆盖前面的**；
2. **跨列表**按第 6 章 6.5 的补丁栈：bundle 层按 `dsh.profile.bundles` 顺序 → profile 层 → home 层 → `--patch` → agent-presets → telemetry，后层胜；
3. **目标缺失 ≠ 失败**：挂载侧只 `warn` 后跳过该条（`applyEntryPatches` 内所有 `warn` 分支，`vendor/include/src/index.ts:58-128`）——一个 overlay 可以被多个 surface 共享，不该因某个 surface 没有那行就崩；但 **patch 文件本身解析错误（非数组、元素不是 mapping）是失败**，`parsePatchList` 直接抛错（`packages/boot/app-boot/src/index.ts:320-338`）。区分很清楚：**"文件坏"失败，"行找不到"警告**。

## 5.5 schemastery：配置在插值之后校验

### 5.5.1 顺序：先求值，后校验

回顾 `vendor/cordis/src/fiber.ts:641-644`：

```ts
private _resolveConfig(config: any) {
  config = this.context.waterfall(this, 'internal/config', config, () => config)
  return this.runtime ? resolveConfig(this.runtime, config) : config
}
```

`internal/config` waterfall 先跑（Loader 的插值钩子就挂在这里，5.3 已读），**然后**才 `resolveConfig`——Standard Schema 校验。顺序不是偶然：`!!js` 表达式要"用该插件的上下文与服务求值"，而校验必须看到**求值后的最终值**。反过来（先校验后插值）会让 schema 对着 `{__jsExpr}` 对象报"类型错误"。

### 5.5.2 Cordis 只认 Standard Schema，schemastery 提供适配

fiber 校验函数（`vendor/cordis/src/fiber.ts:50-62`）：

```ts
export function resolveConfig(runtime: Plugin.Runtime, config: any) {
  if (!runtime.Config) return config
  // TODO: async validation
  const result = runtime.Config['~standard'].validate(config)
  if ('then' in result) throw new TypeError('Async config validation is not supported')
  if (result.issues) throw new ValidationError(result.issues)
  return result.value
}
```

要点：运行时没声明 `Config` schema 就原样放行；声明了就用 `['~standard'].validate` —— 这是 Standard Schema 规范（`@standard-schema/spec`）的通用校验入口，任何实现了 `~standard` 的库都能用（zod、valibot、schemastery……）。**异步校验被显式拒绝**（`vendor/cordis/src/fiber.ts:54-56`，上游标注 TODO）。

dsh 的插件用 vendored schemastery（`vendor/schemastery`）。它给 `Schema` 原型挂了一个 `~standard` getter（`vendor/schemastery/src/index.ts:275-292`）：

```ts
Object.defineProperty(Schema.prototype, '~standard', {
  get(this: Schema) {
    return {
      version: 1,
      vendor: 'schemastery',
      validate: (value: unknown) => {
        try {
          return { value: Schema.resolve(value, this, {})[0] }      // 校验+默认值补齐+类型转换
        } catch (error) {
          if (ValidationError.is(error)) {
            return { issues: [{ message: error.message, path: error.options.path }] }
          }
          throw error
        }
      },
    }
  },
})
```

`Schema.resolve(value, this, {})[0]` 成功的返回值就是**补齐了默认值、经过类型转换的最终配置**——这就是"`apply` 总是收到完整且校验过的配置"的来源。校验失败时，Cordis 侧把 issues 聚合成 `ValidationError`（`vendor/cordis/src/fiber.ts:19-36`），消息形如：

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

**为什么是 vendored 版而不是 npm 直装**：`schemastery` 随仓库 vendored（版本 3.18.0，`vendor/README.md:16`），其清单额外声明了条件 `exports` 映射（import → `.mjs`、require → `.cjs`）。原因是 pnpm 直接链接目录本身，若没有 `exports`，Node 的 ESM 解析会兜底到 `main` 字段、加载 CJS 入口，而 CJS 入口里对 `@deepseek-ai/cosmokit` 的**惰性 `require`** 在模块钩子宿主（vitest）下会与同一链接模块的 ESM 加载竞态（`vendor/README.md:5`）。这个细节提醒我们：**vendored 不是"复制一份代码"，而是"把框架握在手里、并为其运行时形态负责"**——dsh 对框架的 16 条本地修改，不少正是修正"上游在某宿主下会出错"的行为（第 14 条防 Windows 写回丢失、第 8 条事务化、第 11 条 patch 语义，后两者本章已用过：5.2.2 与 5.4.2）。

### 5.5.3 最小示例：同名导出

插件通常同时导出**类型**与**运行时校验器**，二者同名（`docs/cordis-tutorial/05-config.zh.md`，写法以 5.6 的 greeter 为准）：

```ts
export interface Config { greeting: string; targets: string[] }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})
```

消费方通过 `import type` 拿到类型，Cordis 通过运行时值拿到校验器。名字相同的接口与常量在 TypeScript 中合法并存、互不干扰（"声明合并"只在类型层面）。

## 5.6 最小可运行示例：greeter 插件与三次 patch 实验

以下实验**离线可测**（不需要 API key），只需仓库已 `pnpm install`。在仓库根下建临时目录并按官方 cordis 教程的启动器运行（见 `docs/cordis-tutorial/index.zh.md` 的准备工作）：

```sh
mkdir -p tmp/cordis-tutorial && cd tmp/cordis-tutorial
node --import tsx ../../vendor/cordis/bin.js
```

启动器 `vendor/cordis/bin.js` 全文只有 10 余行：创建 `new Context()` → `ctx.baseUrl = cwd` → `ctx.plugin(Loader)` → 创建一个 `cordis-plugin-include` 条目加载 `./cordis.yml`。之后一切由你的 YAML 决定。

**① greeter.ts（约 20 行插件）**：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'greeter'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

**② cordis.yml（约 8 行）**：

```yaml
- id: greeter
  name: './greeter.ts'
  config:
    targets: ['alpha', 'beta']
```

运行：`Hello, alpha!` 与 `Hello, beta!`——`greeting` 没写，schema 的 `.default('Hello')` 补齐；**apply 收到的 config 是完整且已校验的**。

**③ `!!js` 与校验失败**：把 `greeting` 换成 `greeting: !!js process.env.DEMO_GREETING ?? '你好'`，设 `DEMO_GREETING=嗨`，输出变 `嗨, alpha!`；若把 `targets: 'not-an-array'`，启动即报 `ValidationError: invalid config: - $.targets expected array but got not-an-array (at targets)`，进程以状态码 1 退出（插件进入 FAILED，见第 3 章 fiber 状态机）。

**④ patch 实验**：新建被补丁的目标清单 `tree.yml`（约 6 行）：

```yaml
- id: greeter
  name: './greeter.ts'
  config:
    targets: ['from-tree']
```

再建根清单 `cordis.yml`（约 13 行），用**嵌套 include** 模拟 dsh 的挂载方式（内置补丁数组 = dsh 传给根 include 的 `patches`）：

```yaml
- id: inner
  name: '@deepseek-ai/cordis-plugin-include'
  config:
    path: './tree.yml'
    patches:
      # 补丁 1：整行替换——tree.yml 里的 targets 被整体清掉再写新值
      - id: greeter
        config:
          greeting: '你好'
          targets: ['内联补丁', '整行替换生效']
      # 补丁 2：插入一行
      - insert:
          - id: greeter-2
            name: './greeter.ts'
            config:
              targets: ['刚插入']
      # 补丁 3：命中"补丁 2 刚插入的行"——插入行立即建索引 ✦
      - id: greeter-2
        config:
          greeting: '第二层'
          targets: ['后来居上']
      # 补丁 4：禁用
      - id: greeter
        disabled: true
```

观察：① 输出只有 greeter-2 的 `第二层, 后来居上!`（补丁 3 命中补丁 2 插入的行，说明即时索引生效）；② `from-tree` 消失——整行替换而非合并；③ 补丁 4 禁用 greeter，若把它删掉则恢复 `你好, 内联补丁!`/`你好, 整行替换生效!`；④ 把补丁 1-3 的内容抄进 `overlay.yml` 文件，再用 `dsh --profile <name> --patch overlay.yml`（需构建 dsh，**未验证**：本机未构建）或第 6 章的方式加载——最终都汇入同一个 `applyEntryPatches`，语义与内联一致（5.4.4 的等价性）。

## 5.7 常见配置错误：现象与源码根因

把本章的校验与告警规则换成一张排障表（每条都能在源码里找到判定点）。这张表也是 5.6 实验"失败实验"的索引：

| 现象 | 谁报、怎么报 | 源码判定点 |
|---|---|---|
| 配置文件顶层不是数组 | Include 读文件后直接抛 `ConfigFileError('validate')`：`config file must be a top-level array` | `vendor/include/src/index.ts:261-263` |
| patch 文件顶层不是数组 | `parsePatchList` 抛错：`must be a top-level YAML array of loader patch entries` | `packages/boot/app-boot/src/index.ts:329-331` |
| patch 文件的某个元素不是 mapping | `parsePatchList` 抛错并点名第几个元素 | `packages/boot/app-boot/src/index.ts:332-336` |
| patch 的 `id` 在（本层及更早层）找不到 | **只警告不报错**，该条被跳过；挂载侧打印 `patch: entry "x" not found` | `vendor/include/src/index.ts:110-112` |
| patch 带了 `name` 且与目标行不符 | **只警告**：`name mismatch for "x" (expected "a", got "b"), skipping`——防手滑的护栏 | `vendor/include/src/index.ts:116-119` |
| 非 insert 的 patch 忘记写 `id` | **只警告**：`patch: id is required for non-insert patches` | `vendor/include/src/index.ts:105-107` |
| 目标行不是组却往它 `insert` | 警告 `entry "x" is not a group`，跳过 | `vendor/include/src/index.ts:87-90` |
| 在 `name`/`id`/`inject` 等元数据里写 `!!js` | 不报错，但得到 `{ __jsExpr }` 对象——这些字段**不进 interpolate** | `vendor/loader/src/index.ts:92-101` |
| 在子行的 config 里写 `!!js`，行却属于组/Include 的 config | 整段保持字面不求值——树载体的 config 是"别的行的列表"，求值属于子行自己的 fiber | `vendor/loader/src/index.ts:98-100`（Include 标 `EntryGroup.key`，`vendor/include/src/index.ts:182`） |
| 一行没有 `id`，热重载后配置"变了" | 每次重读生成新随机 id（`tree.ensureId`，`vendor/loader/src/config/tree.ts:66-73`）→ diff 全变 → 该行被卸载重装 | `vendor/loader/src/config/tree.ts:66-73` |
| schema 校验失败 | `resolveConfig` 抛 `ValidationError`，消息列出每条 issue（含路径） | `vendor/cordis/src/fiber.ts:50-62`、`19-36` |

两句话总结这张表的判定哲学：**"文件自身坏"（读不到、解析不了、类型不对）是启动失败，必须抛错；"某一行对不上"（id 缺失、name 不符、目标不是组）只是警告，因为同一份 overlay 要跨多个 surface 复用（5.4.5）。** 第二句话在 dsh 里还有一处更严格的表现：`parsePatchList` 对**源文件**的 `!!js` 表达式不做求值（dump 与"校验前"阶段都不求值，见 6.5），但 patch 文件里写非 JSON 类型的值仍然会被 js-yaml 拒绝——方言是 `JSON_SCHEMA` 加一个 `!!js` 标签，仅此而已（`vendor/include/src/index.ts:23`）。

## 5.8 本章小结

1. `cordis.yml` 是**条目列表**（EntryOptions 数组），Loader 用它挂载插件：每一行 → 一个 `Entry` → import 模块 → `registry.plugin` → 一个 fiber；`group: true` 的行是嵌套子清单。
2. `!!js`（`tag:yaml.org,2002:js`）是 YAML 方言扩展出的"表达式标签"，解析成 `{__jsExpr}` 节点，由 Loader 在 `internal/config` waterfall 中按**每个 Entry 的上下文**求值；`disabled` 按每次挂载决策求值；其余元数据保持字面；树载体（Group/Include）保持字面。
3. patch = 对已确定的清单开处方：`applyEntryPatches` 是纯函数（clone → 建 id 索引 → 逐条 insert/覆盖），config **整行替换不合并**（last write wins per row）；**插入行立即建索引**，同列表后续 patch 可再命中。
4. 内联 `patches:` 与独立 patch 文件**等价**：都是 `Include.Config.patches` → 同一次 `applyEntryPatches`；差别只在来源与 HMR 可监视性。
5. 校验（Standard Schema）发生在**插值之后**；schemastery 的 `~standard` 适配器负责校验与默认值补齐，`apply` 收到的永远是完整且校验过的配置。

## 5.9 分层练习

**理解**：
1. 用自己的话回答：`cordis.yml` 里一行的 `config` 与插件收到的 config 有什么不同？（提示：插值与校验）
2. 为什么"插入行立即建索引"是第 6 章多层补丁（bundle 层 + 用户层）能工作的前提？

**应用**：
3. 为 greeter 写一份 patch：把 `targets` 换成你指定的值（不做合并），并解释为什么原来 `tree.yml` 里的 `targets` 完全消失。
4. 把 `disabled: !!js process.platform === 'win32'` 改写成 `process.platform !== 'win32'`，说出语义反转后哪个平台会运行该行——再到 `packages/bundle/base/cordis.patch.yml:178-180` 验证原意。

**综合**：
5. 设计一份 overlay，它必须满足：插入 `greeter-2` 且**在同一份列表里**再覆盖它的配置（使用 5.6 实验的写法）；写出该列表并解释索引时序。
6. 一个 patch 文件在 surface A 上正常、surface B 上"没有任何效果"——列举至少两种可能原因（提示：目标不存在只 warn；name 校验失败；id 变了）。

**挑战**：
7. 论证"如果 `applyEntryPatches` 不 clone 输入，热重载会如何破坏可回退性"（提示：cache 里的条目对象被补丁原地修改后，移除补丁无法恢复原值——从 `vendor/include/src/index.ts:43-53` 注释反推）。

## 5.10 延伸阅读

- 仓库内：`docs/cordis-tutorial/05-config.zh.md`（配置与校验的动手版）、`docs/cordis-tutorial/06-composition-and-hmr.zh.md`（id 稳定性与 HMR）、`docs/cordis-primer.zh.md`（Loader 配置一节：`!!js` 何时求值）。
- `vendor/README.md`：本地修改清单（第 8 条事务化、第 11 条 patch 语义导出、第 15 条懒配置解析）。
- 源码：`vendor/include/src/index.ts`（本章主角）、`vendor/loader/src/config/entry.ts`、`vendor/loader/src/config/utils.ts`。
- 上游：https://github.com/cordiverse/cordis （`@cordisjs/plugin-loader`、`@cordisjs/plugin-include`）；js-yaml 的 `JSON_SCHEMA` 与自定义 Type；Standard Schema（https://standardschema.dev/）；Schemastery（https://github.com/shigma/schemastery）。
