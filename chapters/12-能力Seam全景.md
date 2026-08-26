# 第 12 章　能力 Seam 全景：三种角色一种思想

> **本章学习目标**（读完本章，你应该能够）：
> 1. 给出能力 seam 及三角色（Service Definition / Provider / Consumer）的规范定义与职责边界，并说明哪些包合并了多个角色；
> 2. 说出八个 seam 的注册键（`ctx.fs`、`ctx.shell`、`ctx.subprocess`、`ctx.terminals`、`ctx.sandbox`、`ctx.lsp`、`ctx.codeRuntime`、`ctx.web`）、事件词汇与错误码惯例；
> 3. 解释 fs 的"工具—策略"解耦：观察型策略不注册任何服务，为何能改变写入行为；
> 4. 写一个"替换提供方"的 patch（fs-local → fs-sandbox），理解 one-world 不变式；
> 5. 说明 `declare module '@deepseek-ai/cordis'` 类型扩充（联邦类型声明）的作用，以及沙箱平台链与审批的失败关闭语义。
>
> **本章讲法**：对比型——三角色主表撑起一章：同一套"定义—提供—消费"蓝图在八个能力 seam 上重复出现，差异只在词汇粒度、策略形态与替换成本。第 4 章对比五种事件分发模式（行为并列），本章对比八条能力接缝（结构并列）。

## 12.1 楔子：三个角色，一条接缝

### ① 类比：插座、发电厂与电器

想象一个房间的电力系统。**插座**统一规定电压、孔距与形状；**发电厂**把能量送进插座——烧煤、水电、太阳能发电厂可随时替换，插座与电器一无所知；**电器**（台灯、冰箱）只认插座，从不问"电是哪来的"。唯一规定是：插座规格全国统一。dsh 的能力系统同构：让模型"读文件"需要三样东西——**服务定义**（插座：`FileSystem` 抽象类规定 12 个原语签名）、**提供方**（发电厂：`fs-local`/`fs-sandbox` 具体实现类）、**消费方**（电器：`tool-fs` 把能力包装成模型工具）。这一结构就是**能力接缝（capability seam，下文简称 seam）**。

### ② 精确定义

> **能力 seam**：由"服务定义包 → 服务提供方包 → 消费方包"三层构成、可整体替换的能力设施。定义包只声明契约（抽象 Service 子类 + 词汇类型 + 错误码 + 事件接口 + `Context` 注册键），零实现；提供方包实现抽象类并以 cordis 插件形式加载；消费方包（通常是 `tool-*`）把能力包装成模型工具，只依赖定义包的类型与 `ctx.<key>` 运行值，不关心提供方是谁。

三角色职责如表（"典型包"列以 fs 为例；八 seam 全表见本节末）：

| 角色 | 职责 | 不允许做什么 | 典型包 |
|---|---|---|---|
| Service Definition | 定义抽象类、注册键、词汇类型、错误码、事件接口 | 不得包含具体后端逻辑 | `packages/fs/fs` |
| Service Provider | 实现抽象类，作为插件加载并注册 `ctx.<key>` | 不得被消费方直接 import | `fs-local`、`fs-sandbox` |
| Consumer | 面向模型的工具（`defineTool`），经 `ctx.<key>` 调用 | 不得依赖任何具体提供方 | `tool-fs` |

三个关键机制支撑这个结构（均有源码为证）：

1. **注册键唯一性**。定义包声明 `Context.fs`（见 12.2），提供方在构造函数里调用 `super(ctx, 'fs')`（`packages/fs/fs/src/index.ts:88`）——cordis 以这个字符串键做重复注册检查，同上下文 `ctx.fs` 只允许一个实现，加载第二个直接抛错（`packages/shell/shell/src/index.ts:48-50`："loading a second throws, which is cordis' standard duplicate-service behavior"）。"只能有一个实现"正是"可替换"的前提：替换不是叠加，而是换人。
2. **词汇归定义包**。错误码（`FsErrorCode`）、事件名（`fs/*`）、不透明键（`FsTargetKey`）都归定义包，"而不是让每个提供方自己发明字符串"（`packages/fs/fs/src/types.ts:192-194` 注释）。消费方只认一套词汇。
3. **策略可以绕开服务**：交给执行流水线瀑布（第 11 章）、包装 argv（12.6 沙箱）、监听 `fs/*` 事件（12.2.6 观察者）——三者互不耦合，正是"一种思想"的多样性。

### ③ 最小示例：看到"替换"发生

下面这个 patch 片段（来自 `examples/acp-agent/cordis.yml:160-174` 与 `packages/bundle/base/cordis.patch.yml:443-444`，两处写法等价）把 fs 的提供方从本地换成沙箱：

```yaml
# 方案 A：直接指定（examples/acp-agent/cordis.yml）
- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
  config:
    cwd: !!js process.cwd()
- id: fs-observation-policy
  name: '@deepseek-ai/dsh-fs-observation-policy'
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
```

```yaml
# 方案 B：基础组合包自带（packages/bundle/base/cordis.patch.yml:443-444）
- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
```

注意两个方案里**消费方 `tool-fs` 一行未变**：`read`/`write`/`edit`/`read_image` 照旧，工具代码不需要知道 `ctx.fs` 背后是谁。这就是"替换一个提供方"的全部代价：**一行 yml**。（未验证：`dsh --profile …` 实测需构建产物与模型调用，本章以源码与配置走读代替实测。）

### 八条接缝一张表

| seam | 注册键 | 定义包 | 提供方（默认/示例） | 消费方 | 词汇与错误码 |
|---|---|---|---|---|---|
| 文件系统 | `ctx.fs` | `packages/fs/fs` | `fs-local`、`fs-sandbox`（base 默认）、`fs-e2b` | `tool-fs` | `FsErrorCode`（13 码）、`fs/write-intent` 等 3 事件 |
| shell | `ctx.shell` | `packages/shell/shell` | `bash-local`、`bash-sandbox`、`pwsh-*` | `tool-bash` | request/spec/result 词汇 |
| 子进程 | `ctx.subprocess` | `packages/subprocess/subprocess` | `subprocess-local`、`subprocess-e2b` | `bash-local`、`lsp-stdio`、`terminal-bash` | `SubprocessSpawnSpec` 等，无默认值 |
| 终端 | `ctx.terminals` | `packages/terminal/terminal` | `terminal-bash`（opt-in） | `tool-terminal` | `TerminalErrorCode`（8 码） |
| 沙箱 | `ctx.sandbox` | `packages/sandbox/sandbox` | `sandbox-local` | `bash-sandbox`、`fs-sandbox`、`terminal-bash` | `SandboxMode` 三档、`sandbox/mode` 事件 |
| 语言服务器 | `ctx.lsp` | `packages/lsp/lsp` | `lsp-stdio` | `tool-lsp` | `LspOperation` 闭集、`LspError` |
| 代码执行 | `ctx.codeRuntime` | `packages/code-runtime/code-runtime` | `code-runtime-worker-thread` | `run_code`（Code Mode） | `CodeRunFailure` 六种 kind |
| 网络 | `ctx.web` | `packages/web/web` | `web-search-deepseek`（默认）、`web-search-exa/perplexity`、`web-fetch-http` | `tool-web` | `WEB_PROVIDER_*` 错误族 |

后面各节按"标本 → 概述"的顺序走读。

## 12.2 fs：一个完整 seam 的标本

fs 是打磨最细的 seam：`packages/fs/fs/README.zh.md` 自述"四层文件系统栈"（工具/执行器、政策、提供方约定、提供方），演示了三角色的所有变体。

### 12.2.1 定义层：12 个原语与一段类型扩充

`FileSystem` 抽象类定义了 12 个抽象原语（`packages/fs/fs/src/index.ts:86-250`）；冒号后为声明行号：

| 原语 | 行号 | 一句话语义 |
|---|---|---|
| `resolve` | packages/fs/fs/src/index.ts:116 | 把给定路径解析为稳定目标（异步——远程后端可能要往返） |
| `processPath` | packages/fs/fs/src/index.ts:126 | 子进程能打开的规范化绝对路径 |
| `fileUrl` | packages/fs/fs/src/index.ts:135 | 规范化 `file:` URI（编码归后端，宿主平台可能异于执行平台） |
| `contains` | packages/fs/fs/src/index.ts:144 | 规范化包含判断，不暴露/解析目标键 |
| `stat` | packages/fs/fs/src/index.ts:152 | 元数据，只给信息不给内容；缺失返回 `undefined` |
| `lstat` | packages/fs/fs/src/index.ts:168 | 不跟随最终符号链接的路径形状元数据（供消费方在跟随前拒绝路径） |
| `readText` | packages/fs/fs/src/index.ts:176 | 整读 UTF-8 文本 |
| `streamText` | packages/fs/fs/src/index.ts:187 | 流式读文本（跨块解码与二进制拒绝归后端） |
| `readBytes` | packages/fs/fs/src/index.ts:199 | 有界读原始字节，超限抛 `FS_TOO_LARGE` 而非截断 |
| `listDir` | packages/fs/fs/src/index.ts:208 | 稳定名称序的目录列举，绝不读内容 |
| `writeText` | packages/fs/fs/src/index.ts:222 | 原子创建/替换文本，可选版本防护（`expected`） |
| `editText` | packages/fs/fs/src/index.ts:243 | 原子字面量编辑，可选版本防护 |

两个细节。其一，**版本防护是可选参数**：`writeText` 的 `expected` 省略即无条件覆盖（`packages/fs/fs/src/index.ts:211-212`："omission allows unconditional overwrite"）——"裸提供方"完全可用，防护是叠加层（呼应 12.2.6 观察策略）。其二，**`editText` 留在 seam 而非工具里**：模块注释给出理由——版本校验、字面量匹配、原子重写必须共享同一临界区（`packages/fs/fs/src/index.ts:4-7`）；远程后端可原生实现 compare-and-edit，拆到工具层就堵死这条路。

定义层还有一行关键代码——`super(ctx, 'fs')` 构造器（packages/fs/fs/src/index.ts:87-89），并预告声明合并（见 12.12）：

```ts
export abstract class FileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }
```

### 12.2.2 词汇层：品牌键、观察与防护意图

定义包的所有权不只属于方法，还属于**词汇**。三个核心类型（`packages/fs/fs/src/types.ts`）：

```ts
export type FsTargetKey = Branded<'FsTargetKey'>
export type FsVersion = Branded<'FsVersion'>
export type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }
```

**品牌类型（branded type）**：结构上仍是 `string`，但带唯一品牌标记。类比：普通号码与带防伪标记的证件号——打印出来一样，但编译器拒绝把 `FsTargetKey` 传给期望"文件路径字符串"的参数，反之亦然（`packages/fs/fs/src/index.ts:120-122` 注释强调"消费方必须把 target key 当作不透明值"）。`FsVersion` 同理：后端签发的不可解析防伪标记，只被拿来"比较相等"。

写入防护意图把"写"的两种前提显式化：

```ts
export type FsWriteIntent =
  | { kind: 'createIfAbsent' }   // 未见过或确认缺失 → 只允许新建
  | { kind: 'replaceIfVersion'; version: FsVersion }  // 见过 → 必须在同一版本上替换
```

错误码同属词汇：`FsErrorCode` 是 13 元素封闭联合（`packages/fs/fs/src/types.ts:175-188`），包括 `FS_NOT_FOUND`、`FS_STALE_VERSION`（版本过期）、`FS_NOT_OBSERVED`（未读先写）、`FS_SANDBOX_DENIED`、`FS_AMBIGUOUS_EDIT` 等。`FsError` 继承 `HarnessError` 携带稳定 code（:196-203），工具注册表把 `{ name, code }` 暴露在 `isError` 结果上，重试/权限/UI 层可不解消息文本直接分流（:171-174 注释）——模型所见的错误形态由定义包保证。

### 12.2.3 事件层：工具与策略的解耦点

fs 定义包还声明了三个事件（`packages/fs/fs/src/index.ts:49-77`）：

| 事件 | 模式 | 语义 |
|---|---|---|
| `fs/write-intent` | 单槽 waterfall | 为下一次 `writeText` 裁决防护意图；不调用 `next()` 即"我占住决策" |
| `fs/edit-intent` | 单槽 waterfall | 为下一次 `editText` 裁决版本护栏 |
| `fs/observed` | emit | 记录一次权威观测（存在+版本 / 确认缺失）；监听器必须同步、抛错会让工具调用失败 |

waterfall 语义（调 `next()` 继续链、最后回调即默认值）在第 4 章讲过；新概念是**单槽（single-slot）**：与"多个监听器依次叠加"不同，`fs/write-intent` 的第一个监听器若直接返回意图（不调 `next()`），决策就归它，后续监听器不再参与——"第一个返回意图者拥有决策，而不是与同伴合成"（packages/fs/fs/src/index.ts:51-53 注释）。两个策略插件都调 `next()` 会稀释语义——单槽让"策略互斥"成为类型级事实。

观测在写提交成功后才记录，emit 不等待 Promise，因此监听器"必须是同步记录者"（packages/fs/fs/src/index.ts:68-70 注释）——慢半拍可以，异步不行，否则下一次写防护可能读到旧状态。三个事件即"发出方与策略监听器共享词汇、发出方不依赖策略包"的全部机制（见 `packages/fs/fs/README.zh.md`"fs/* 政策事件"一节）。

### 12.2.4 提供方（本地）：身份、互斥锁与版本防护

`LocalFileSystem`（`packages/fs/fs-local/src/index.ts:64-263`）实现全部 12 个原语，三个设计点构成骨架。

**第一，目标身份 = realpath**。`resolve` 经 `resolveLocalTarget`（packages/fs/fs-local/src/index.ts:106-111）返回 `{ targetKey, displayPath }`——`targetKey` 即 realpath 后的规范化绝对路径，同一文件经符号链接、相对路径、`..` 到达都得到同一键；`contains` 用 `relative` 前缀判断（:121-124）。这是契约"目标必须跨别名保持身份"（`packages/fs/fs/src/index.ts:81-82`）的本地实现。

**第二，每 targetKey 一把互斥锁**。`withLock` 用"尾承诺"串行化同一文件的全部变更操作（packages/fs/fs/src/index.ts:91-104）：

```ts
private async withLock<T>(targetKey: string, op: () => Promise<T>): Promise<T> {
  const prior = this.locks.get(targetKey) ?? Promise.resolve()
  const run = prior.then(op, op)
  // Keep the chain alive but swallow this op's result/throw for the *next* waiter.
  const tail = run.then(() => undefined, () => undefined)
  this.locks.set(targetKey, tail)
  try {
    return await run
  } finally {
    if (this.locks.get(targetKey) === tail) {
      this.locks.delete(targetKey)
    }
  }
}
```

注释很直白（packages/fs/fs/src/index.ts:74-77）："串行化变更操作，使**读→防护→写**窗口无法交错，并发写被确定性地排序"。第 11 章讲过"读（记版本）→ 写（带版本防护）"是两步无锁操作，两个并发写可能都读到旧版本、双双通过防护检查、后写者覆盖先写者（丢失更新）。锁放在**提供方**而非工具层，因为只有提供方同时握有 probe 与写这两个事实。

**第三，版本防护在锁内执行**。`writeText` 的防护代码（packages/fs/fs/src/index.ts:178-187）：

```ts
if (expected?.kind === 'replaceIfVersion') {
  // Stale guard: the file must still exist at the version the owner observed.
  if (!existing) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
  if (existing.version !== expected.version) {
    throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
  }
} else if (expected?.kind === 'createIfAbsent' && existing) {
  // createIfAbsent onto an existing file: a blind overwrite — require a read first.
  throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
}
```

错误码语义分工：**版本过期**用 `FS_STALE_VERSION`（文件存在但版本不符 / 已消失），**未读先写**用 `FS_NOT_OBSERVED`（存在但请求方从未读过）——模型由此区分"信息过期，请重读"与"没读过，凭什么覆写"。写盘交给 `writeFileAtomic`（`packages/fs/fs-local/src/fsio.ts:533`）：同目录 0o700 临时目录 → `open('wx', 0o600)` → 写入 → fsync → 按意图 `link`/`rename` 原子发布；**提交后临时目录清理失败不算写失败**（:596-599），因为目标已提交，残留只属 owner（0o700 私有目录）。

### 12.2.5 提供方（沙箱）：继承 + 一次 contain 检查

`SandboxedFileSystem`（`packages/fs/fs-sandbox/src/index.ts:59-149`）类注释很干脆：加载它"**以取代 `dsh-fs-local`，连同 `ctx.sandboxPolicy` 一起，就是整个替换**——模型工具丝毫未动"（:52-54）。它继承 `LocalFileSystem`，只做三件事：注入 `sandboxPolicy`（:60）、暴露部署默认模式为能力事实（:69-71）、write/edit 前做 `checkedTarget` containment 检查（:84-113 → :126-148）：

```ts
private async checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget> {
  const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
  const { mode } = policy
  if (mode === 'danger-full-access') return target
  if (mode === 'read-only') {
    throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
  }
  // workspace-write: containment on the FRESH canonical path (catches a
  // symlink ancestor swapped since the tool resolved this target), and the
  // mutation delegates with THIS fresh target — never the stale one.
  const fresh = await this.resolve(target.displayPath)
  let contained = false
  for (const root of writableRoots(policy)) {
    if (await isPathUnder(fresh.targetKey, root)) {
      contained = true
      break
    }
  }
  if (!contained) {
    throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
  }
  return fresh
}
```

两个工程细节：一，workspace-write 模式**重新解析**目标（`fresh`）再检查而非检查旧目标——"检查这里、写那里"的 TOCTOU 窗口由此关闭（packages/fs/fs-sandbox/src/index.ts:117-118），返回的正是 `fresh`，检查与写入同身份；二，`read-only` 拒绝用 `FS_SANDBOX_DENIED`，工具层映射为模型可见的 `[sandbox: …]` 标记与升权提示（:122-124 注释），即第 11 章"错误码跨层转译"的实例。

### 12.2.6 策略：不注册任何服务的观察者

`fs-observation-policy` 是全书最值得玩味的插件。模块注释开门见山（`packages/fs/fs-observation-policy/src/index.ts:1-7`）："**仅事件的文件系统观察策略；它不注册任何服务**。弱引用 owner/target 映射记录每次权威观测，单槽意图监听器推导防护，提供方执行原子的过期/不覆写检查。没有它，工具保留裸提供方的无条件变更行为。"

`ObservedStateGate` 的状态只是 `WeakMap<object, Map<string, FsObservation>>`（packages/fs/fs-observation-policy/src/index.ts:28）：外键是"观测者"（从 `actor` 推导出 agent 会话，:36-41），内键是 targetKey，值是存在/缺失观测。决策逻辑只有两个函数：

```ts
writeIntent(target: FsTarget, actor: object | undefined): FsWriteIntent {
  const owner = this.owner(actor)
  const prior = owner ? this.get(owner, target.targetKey) : undefined
  return prior?.kind === 'present'
    ? { kind: 'replaceIfVersion', version: prior.version }
    : { kind: 'createIfAbsent' }
}
editIntent(target: FsTarget, actor: object | undefined): { version: FsVersion } {
  const owner = this.owner(actor)
  const prior = owner ? this.get(owner, target.targetKey) : undefined
  if (!owner || prior === undefined) {
    throw new FsError(`edit requires reading "${target.displayPath}" first`, 'FS_NOT_OBSERVED')
  }
  if (prior.kind === 'absent') {
    throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  return { version: prior.version }
}
```

规则浓缩成一句话：**"读后写"**——读过并确认存在的文件，写时带 `replaceIfVersion`；没见过或确认缺失的，只允许 `createIfAbsent`；编辑必须先读（否则 `FS_NOT_OBSERVED`）。插件注册（`apply`，packages/fs/fs-observation-policy/src/index.ts:106-129）是三个 `ctx.on` 监听器分别占住 `fs/write-intent`、`fs/edit-intent` 的单槽决策（**故意不调 `next()`**，:116-122），并在 `fs/observed` 上同步记录观测。

力量在**角色分离**：观测状态既不属于提供方、也不属于工具——`packages/fs/fs/README.zh.md` 的解释是"已观察状态、编辑前读取和版本防护的写入/编辑属于**插件**……并非提供方行为，因此沙箱化/远程后端不会继承任何面向模型的观察政策"。即 `fs-sandbox` 管"能不能写"，`fs-observation-policy` 管"该按什么写"，`tool-fs` 只管"让模型怎么写"；彼此零 import。"策略型观察者"由此得名：**没有服务可注入，只靠事件把意志织进流水线**。

### 12.2.7 消费方：只认识词汇的工具

`tool-fs`（`packages/fs/tool-fs/src/index.ts:54-79`）的模块注释（:1-5）确认角色："本包拥有 schema、校验、读取窗口、格式化与观测事件，**从不拥有具体提供方**。可选的事件策略提供变更防护；没有它，工具使用无条件提供方调用。"`inject = ['tools', 'fs', 'systemPrompt']`（:22）——注入的是 `ctx.fs`（任何提供方）而非具体类。它注册四个工具，`read` 的 schema（`packages/fs/tool-fs/src/read.ts:76-83`）：

```ts
ctx.tools.register(defineTool({
  name: 'read',
  description: 'Read a UTF-8 text file and return line-numbered content.',
  parameters: {
    file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
    offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
    limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
  },
```

工具体内的事件派发把三角色缝在一起——读成功后记录观测（`packages/fs/tool-fs/src/read.ts:162`），写前要意图（`packages/fs/tool-fs/src/write.ts:111`）、写后记新版本（`packages/fs/tool-fs/src/write.ts:122`），编辑同构（`packages/fs/tool-fs/src/edit.ts:126`、`packages/fs/tool-fs/src/edit.ts:141`）：

```ts
ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)          // read.ts:162
const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)        // write.ts:111
ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)        // write.ts:122
```

waterfall 默认实现 `() => undefined` 是关键：**没有策略插件时 `intent` 为 `undefined`，即裸提供方的无条件写**（`packages/fs/fs/src/index.ts:52-53`："calling `next()` yields the bare provider's unconditional write"）；有策略插件时，单槽监听器返回意图，写就带上版本防护。同一段工具代码，两种行为。

## 12.3 shell：request/spec 拆分与"能力事实"

shell 的服务定义只有三个抽象方法（`packages/shell/shell/src/index.ts:85-100`）：`resolve`、`run`、`start`。值得学的是**两段式 API**：调用方先给 `ShellExecRequest`（`command` 必填，`timeoutMs`/`workdir` 可选），提供方的 `resolve()` 把实现自有的默认值与上限（超时默认 120s、上限 600s、输出上限 64KB……）收敛成完全显式的 `ShellExecSpec`，`run`/`start` 只收规约、绝不重新默认化（`packages/shell/bash-local/src/index.ts:139-145`）。收益是**可测试性**（`resolve` 输出可直接断言）与**可替换性**（新提供方只换默认值来源，不换契约形状）。类注释（:46-51）称这是"model-facing shape"，subprocess seam 则注释本 seam 的 request/spec 拆分是"template"（`packages/subprocess/subprocess/src/types.ts:69-74`）。

第二个新奇点是**能力事实（capability fact）**：`ShellExecutor.sandboxMode` 返回该执行器默认施行的沙箱模式，`undefined` 表示根本不管束（packages/subprocess/subprocess/src/types.ts:75-77）。工具层读它决定 schema 是否**如实**宣传 `sandbox_permissions`/`justification` 升权参数（`packages/shell/tool-bash/src/index.ts:259-269`）——"诚实广告"：升权按钮只在存在"可升之权"时出现。本地执行器返回 `undefined`；`bash-sandbox` 覆写为部署默认（`packages/shell/bash-sandbox/src/index.ts:75`）。升权与单调守卫的完整机制见第 11 章。

本地执行器 `LocalBashExecutor`（`packages/shell/bash-local/src/index.ts:102-331`）自身不碰 `node:child_process`，而是经 `ctx.subprocess.spawn` 起 `['bash', '-c', command]`（:211-213）。每次把命令、超时、输出上限、环境、期限信号编码进完全显式的 `SubprocessSpawnSpec`（`spawnSpec`，:175-198），环境分层为 `{ ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }`——"可信的 dshEnv 快照同时压过调用方环境与终端覆盖"（:193-196）。运行时把"超时"与"取消"严格分类：只有执行器自身超时才报 `timedOut`，外层信号取消是 `aborted`（:229-231）——一个 deadline 融合两者（`timeout-library` 约定）。后台 `start` 返回 `ShellProcess` 句柄（`startArgv`，:255-318），实现偏移式增量读取（`readOutput`，:289-309）与 `kill` 树级终止。**job 语义不属于执行器**（`packages/shell/shell/src/index.ts:1-3`："Job ids, ownership, polling, and notices belong to `@deepseek-ai/dsh-jobs`"）——执行器只回答"怎么执行"，排队与轮询归第 13 章。

## 12.4 subprocess：无默认值规约与树级终止

subprocess 是 shell 的"底层朋友"：bash 每条命令、LSP 服务器、PTY 终端都经 `ctx.subprocess` 派生进程。服务定义只有三个原语（`packages/subprocess/subprocess/src/index.ts:118-139`）：`resolveExecutable`（解析可执行文件）、`spawn`（带完整规约的进程）、`spawnTerminal`（唯一非管道原语）。两个特征与 shell 对照。

**特征一：零默认值**。`SubprocessSpawnSpec` 的 `argv`/`cwd`/`stdio`/`graceMs` 全部必填（`packages/subprocess/subprocess/src/types.ts:75-104`；模块注释 :69-74："This seam applies no defaults: every disposition, limit, and directory is explicit"）；提供方 `subprocess-local` 因此"没有 config"（`packages/subprocess/subprocess-local/src/index.ts:1-7`："every disposition and limit arrives on the spec, so the deployment-varying choices stay with the caller's config (the bash executor's, the LSP host's, …)"）。设计推力是**职责下沉**：默认值与上限属"业务语义"（bash 该 120s、LSP 启动该 60s）。与 shell 的 request/spec 拆分是同一思想两面。

**特征二：终止只有一种动词，且树级生效**。`terminate()`（或 spec 的 abort signal）一律升级 SIGTERM → 等待 `graceMs` → 树级 SIGKILL，任何平台（`packages/subprocess/subprocess/src/index.ts:89-93` 注释）。本地实现的关键代码（`packages/subprocess/subprocess-local/src/spawn.ts:260-315`）：

```ts
export function killGroup(pid: number, sig: NodeJS.Signals): void {
  if (pid <= 0) return
  try {
    process.kill(-pid, sig)      // POSIX：负进程组 id = 整组
  } catch { /* Swallow: see contract above. */ }
}
export function taskkillProcessTree(pid: number): void {
  if (pid <= 0) return
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })  // Windows：整树强杀
}
```

spawn 用 `detached: platform !== 'win32'` 给 POSIX 进程组造"树根"（`packages/subprocess/subprocess-local/src/spawn.ts:358-361`）。为什么必须整树？`bash -c` 会派生子进程，只杀组长则孙进程继续跑（Term 陷阱也拦不住组信号）。另一处安全细节：`scrubbedParentEnv`（`packages/subprocess/subprocess/src/index.ts:60-66`）按 `SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i` 过滤母环境的凭据形状变量与全部 `DSH_*` 名——`DEEPSEEK_API_KEY` 绝不隐式泄漏；刻意转发的密钥走 spec 显式 `env` 层，在 scrub 之后合并（:38-42）。"隐式绝不、显式可以"。析构时 `disposeManagedProcesses` 先 `terminate()` 再 `waitForExit()` 等**整树**退出（`packages/subprocess/subprocess-local/src/index.ts:79-102`），宿主 `exit` 事件还有同步兜底（:49-59）。

## 12.5 terminal：注册表—后端分离与 owner 精确性

terminal seam 处理"有状态终端"：`terminal_open` 开真实 PTY 会话，`terminal_send`/`terminal_read`/`terminal_signal`/`terminal_close`/`terminal_list` 六个工具围绕它工作（`packages/terminal/tool-terminal/src/index.ts:163`、:198、:297、:330、:355、:386）。服务 `TerminalSessionService`（`packages/terminal/terminal/src/index.ts:105-474`）只拥有"id、发布、授权、等待清理"（:1-3），PTY 机制（分配、文本传输、前台进程组、信号、整会话静默）全部委托给可替换的 `TerminalBackend`——`registerBackend`（:125-137）拒绝重名（`DUPLICATE_BACKEND`），`spawn`（:154）按类型找后端。**注册表与后端分离**：换"远程 PTY"或"容器终端"，服务代码一行不动。

安全模型按"精确归属"设计：每个会话绑定精确注册的 Agent，`isLiveOwner` 检查"该 agent 仍在注册表且就是同一个对象"（packages/terminal/terminal/src/index.ts:318-320 附近）；跨 agent 访问抛 `FOREIGN_SESSION`（:390），owner 已死抛 `OWNER_NOT_LIVE`，错误码封闭联合共 8 个（:55-64）。另一道栅栏：`terminal-bash` 在会话存续期间**禁止切换沙箱模式**——它监听 `internal/dispatch` 钩子，看到自己的 owner 会话发生 `sandbox/mode` 事件且会话有活动时直接抛错（`packages/terminal/terminal-bash/src/index.ts:34-53`）：已开着的终端按旧模式约束，切到更宽模式等于绕过沙箱。

后端 `BashTerminalBackend` 经 `ctx.subprocess.spawnTerminal` 起 node-pty（packages/terminal/terminal-bash/src/index.ts:102-148），环境打上受控标记：`TERM=dumb`、`PS1=CONTROLLED_PROMPT`、`PROMPT_COMMAND` 输出 OSC 133 标记（便于宿主解析命令状态）、`DSH_SHELL=1`、`DSH_PTY_SESSION_ID`（:55-69）；非 `danger-full-access` 时用 `ctx.sandbox.confine` 包 argv（:71-80）。pty 组合也是"替换"示例，且是 opt-in：`examples/acp-agent/pty.cordis.yml:6-21` 在既有组合上 `insert` 三个条目即可启用。

## 12.6 sandbox：文件效果约束、平台链与失败关闭

sandbox seam 的契约极小：一个方法 `confine(argv, policy): ConfinedArgv`（`packages/sandbox/sandbox/src/index.ts:158-176`）——传入精确 argv 与文件效果策略，返回"替换后的 argv + 强制执行度 + 拒绝方言 + 运行失败规则"。模块注释（:1-4）先划边界："**容器、微 VM 与远程执行替换的是周边的能力 seam，而不是这个服务**；本服务与宿主共享内核与文件系统。"它不是隔离容器，只约束**文件效果**：`SandboxMode` 三档（:29）——`read-only`（只放行 `/dev/null` 等必要落点）、`workspace-write`（再加工作区与后端定义的临时区）、`danger-full-access`（跳过约束）；网络与进程可见性**不在词表内**（:23-27）。策略按调用携带（`SandboxPolicy`，:69-72），不固定在提供方上——两个消费方可同时处于不同模式（bash 只读、子代理可写），升权重试即更宽政策的新调用。`sandbox-policy` 每次调用解析完整策略：`defaultMode`/`workspaceRoot` 来自配置，会话可经 `sandbox/mode` 事件覆盖（`packages/sandbox/sandbox-policy/src/index.ts:101-110`、:135-139；事件定义在 `packages/sandbox/sandbox-policy/src/session-mode.ts:33`）；终端会话存在时切换被 12.5 的栅栏拦下。

本地提供方 `LocalSandboxProvider`（`packages/sandbox/sandbox-local/src/index.ts:250-…`）的**平台链**选择如下（:159-166）：

```ts
const PLATFORM_CHAINS: Record<string, readonly SelectedRunner['runner'][]> = {
  linux: ['bwrap', 'landlock'],
  darwin: ['seatbelt'],
  win32: ['windows-acl'],
}
```

选择规则是"先按平台，再按探测"：Linux 优先 bwrap（挂载 profile 最贴近三档词表——整根只读绑定 `--ro-bind / /` 加工作区可写绑定，`packages/sandbox/sandbox-local/src/profiles.ts:16-23`），Landlock 兜底；darwin 只有 Seatbelt（SBPL `(deny file-write*)` + 白名单，`packages/sandbox/sandbox-local/src/profiles.ts:51-58`）；win32 只有 ACL 受限令牌 runner。每个 rung 先做**功能性探测**（真的跑一次 `true`，:68-74），而非检查二进制是否在；探测失败 ⇒ 抛 `SandboxUnavailableError`（`SANDBOX_UNAVAILABLE`，`packages/sandbox/sandbox/src/index.ts:124-144`），**绝不静默无约束放行**——失败关闭（fail-closed）：没有沙箱就拒绝执行。`enforcement` 区分 `full`/`partial`（:59）：bwrap/Seatbelt 声明 full，Windows ACL 因 Everyone 写权限与硬链接的固有局限声明 **partial**（:177-187），"要求绝对边界的调用方不得把它当 full 对待"（:55-58）。

`confine` 主路径（`packages/sandbox/sandbox-local/src/index.ts:316-332`）返回时携带**拒绝方言**（`denialSignatures`，:205-213：bwrap 说 "read-only file system"、Landlock 说 "permission denied"、Seatbelt 说 "operation not permitted"、Windows 说 "access is denied"……）。消费方（`bash-sandbox`/`tool-bash`）据此**精确匹配当前后端**的拒绝文本，而非跨后端并集——"并集会宣称某些后端从不产生的拒绝"（`packages/sandbox/sandbox/src/index.ts:100-107`）。每个后端还带结构化失败规则（`runnerFailureRules`，:231-240），区分"runner 根本没跑起来"（exit-gated 致命签名）与"约束生效并拒绝了"——三段论（探测→包装→判定）完整。

## 12.7 审批：事件型策略的第二次亮相

"要不要允许这次操作"不能靠提供方自己决定——那是产品策略。dsh 把审批做成独立 seam（`packages/interaction/user-approval`），与 fs 观察策略一样，**核心是一段 waterfall**。

**词汇**：`ApprovalOutcome` 封闭四值（`packages/interaction/user-approval/src/types.ts:29`）——`'allowed-once'`（一次性放行、唯一授权）、`'rejected'`、`'cancelled'`（请求方撤销）、`'unavailable'`（无可用应答方，失败关闭）。`ApprovalPolicy` 两值（`packages/interaction/user-approval/src/index.ts:94`）：`'ask'`（默认，委托应答方链；无应答方落到 `'unavailable'`）与 `'never'`（谁也不问，每个请求确定性 `'rejected'`——CI/无人值守的严格立场）。事件声明（:30）：

```ts
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

`ApprovalService.request`（packages/interaction/user-approval/src/index.ts:257-276）走"先审计、后裁决、再审计"：要求**轮次内**询问（`hasOpenTurn`，:127-134——审计对须被 `turn/start`/`turn/end` 包围，裸事件在重载时被当作崩溃尾丢弃），先追加 `approval/asked`，再经 `decide`（:304-344）裁决，最后追加 `approval/decided`（同 id 配对）。`decide` 两处工程细节：其一，`'never'` 在**派发之前**就地裁决（:307-312）——即使监听器 `prepend: true` 抢在门禁之前，'never' 的确定性也不受注册顺序影响；其二，`Promise.resolve().then(...)` 包裹派发（:313-329），让同步与异步抛错的监听器走同一条拒绝路径，并把"越界返回值"归一化为 `'unavailable'`——**seam 必须包含自己的回调**，而不是把异常漏给调用方。信号取消在竞争后返回 `'cancelled'`，迟到的应答被构造性丢弃（:330-343）。

但注意**三预设**的归属：`PermissionPresetService`（`packages/interaction/permission-presets/src/index.ts:159-…`）的默认表只有两项（`workspace-write` + `ask`、`danger-full-access` + `never`，:167-176），base 组合包把表扩为三项（`packages/bundle/base/cordis.patch.yml:196-205`）：`read-only`（只读 + ask）、`workspace-write`、`danger-full-access`——第三项来自 base 补丁。切换预设经各自规范 setter——`setSandboxMode`（`packages/sandbox/sandbox-policy/src/session-mode.ts:69-70`）与 `setApprovalPolicy`（`packages/interaction/user-approval/src/index.ts:142-147`）——落成 `permission/preset`、`sandbox/mode`、`approval/policy` 三个日志事件；读路径折叠日志（`effectivePermissionPreset`/`effectiveSandboxMode`/`effectiveApprovalPolicy`），"重放日志即是状态"（:76-79）。审批结果经 `approval/asked`/`approval/decided` 以**仅审计**方式进日志（不进模型转录，:36-43）；模型如何得知策略？经运行时上下文的快照（`ApprovalService` 注册的 systemPrompt 段，:204-216）与切换时的用户消息通知（`setPolicy`，:226-237）——第 8 章"模型可见即已记录"边界的具体应用。接线实例在 `tool-bash` 的升级协商路径（`packages/shell/tool-bash/src/index.ts:203-226`，`approver: ctx.get('approval')`）。

## 12.8 lsp：四个操作，没有逃生舱

lsp seam 有意把协议收窄到极限：`LspOperation` 是四元素封闭联合（`packages/lsp/lsp/src/types.ts:17`）——`goToDefinition`、`findReferences`、`goToImplementation`、`hover`。模块注释（:5-7）声明："seam 不暴露任何协议类型、进程或文档控制，也没有通用 JSON-RPC 逃生舱——只有这四个语义操作。"新增操作是编译期全链改动（:13-16）。为什么这么小？模型要语义答案，不是协议通道；给 JSON-RPC 等于把不确定性导进边界。

服务 `Lsp`（`packages/lsp/lsp/src/index.ts:82-150`）维护两张表：provider id 预留集与"扩展名 → 路由"表；注册**全有或全无**：先完整校验（id 非空、扩展名合法、无重复无冲突），全过才一次性预留（:90-141）。查询按**文件最终扩展名**路由（`Foo.TS` 归一化为 `.ts`，`finalExtension`，:60-67），与注册顺序无关；无路由抛 `LSP_UNAVAILABLE`（:143-149）。坐标约定：seam 层零基 UTF-16（与 LSP 线上协议一致），**工具层翻成一基光标**呈现给模型（`tool-lsp` 的 schema 注释）。提供方 `lsp-stdio` 是 stdio 子进程语言服务器：`inject = ['fs', 'lsp', 'subprocess']`（`packages/lsp/lsp-stdio/src/index.ts:47`）——subprocess seam 的消费方之一；服务器懒启动（首个匹配查询时才拉起），可执行文件在加载时解析。`examples/headless-agent/e2b.cordis.yml:42-55` 能看到服务器配置形态（`servers.typescript.command/args/extensionToLanguage`）。

## 12.9 code-runtime：错误是结果字段

code-runtime seam 让模型"写程序执行"而非"敲命令"：`CodeRuntime`（`packages/code-runtime/code-runtime/src/index.ts:102-135`）只描述三件事——`language`（`'typescript'`/`'python'`，信息性）、`isolation`（`'worker-thread'`/`'process'`/`'container'`，信息性）、`run(request)`。契约**头号纪律**是"错误是结果字段，不是异常"（`packages/code-runtime/code-runtime/src/types.ts:73-108`："An error is a FIELD on a resolved result, never a rejection of run()"）；`run()` 只对契约误用（已 dispose、命名空间非法）拒绝。`CodeRunFailure.kind` 六种：`exception`/`timeout`/`abort`/`worker-exit`/`invalid-output`/`output-limit`——程序失败与引擎失败同合流分类。

Worker 提供方的隔离模型（`packages/code-runtime/code-runtime-worker-thread/src/index.ts:378-393`）：

```ts
const worker = new Worker(WORKER_PATH, {
  workerData: bootData,
  // Model code gets NO ambient environment — stronger than the scrubbed
  // env the defensive-patterns rule requires for spawned commands.
  env: {},
  execArgv: [],
  resourceLimits: { maxOldGenerationSizeMb: this.config.maxOldGenerationSizeMb },
  stdout: true, stderr: true,
})
```

空环境 + 空 `execArgv`（防继承宿主加载器钩子）+ 堆上限 + 管道兜底——"比凭据清除的环境更强"（packages/code-runtime/code-runtime-worker-thread/src/index.ts:380-382）。每个 `run` 一个全新 Worker（:293-312），配 `computeMs`/`maxWallMs`/`maxOutputBytes`/`maxOldGenerationSizeMb` 四个预算（Config，:239-244）。

消费方是 Code Mode 的 `run_code` 工具（`packages/core/tools/src/code-mode.ts:294-654`）：模型提交 `code` 与一句 `description`，运行时把调用者 agent 可见的**全部工具**编译成绑定命名空间（`registry.schemas(exec.agent)` 枚举，:606-609——受限工具消失、作用域工具加入，与提示词 SDK 段一致），程序内 `await tools.bash(...)` 即一次子分派。调度器复用原生循环的并发规则（并行分类、exclusive 屏障、提交序），带 run 级 `AbortController`——run 结束即中止所有在途子分派（:334-340、:623-629）。mode 强制检查见 `packages/core/tools/src/index.ts:1020-1022`（"mode requires a code runtime … or set tools mode to native"）。挂载点：`packages/bundle/headless/cordis.patch.yml:24-25` 与 `packages/bundle/web-app/cordis.patch.yml:48-49`。

## 12.10 web：双注册表与执行期选择

web seam 管理模型的两类网络能力：搜索（`ctx.web.search`）与抓取（`ctx.web.fetch`）。`WebRuntime`（`packages/web/web/src/index.ts:74-164`）持**双注册表**（`searchProviders`/`fetchProviders`，:85-86），提供方是实现 `WebSearchProvider`/`WebFetchProvider` 接口的插件（各带 `id` 与 `available()`，`packages/web/web/src/types.ts:101-113` 附近）。默认只挂一家搜索（`web-search-deepseek`，id `deepseek-official`，`packages/web/web-search-deepseek/src/provider.ts:178`；可用性 = 能否从 `apiKeyEnv` 解析出 key，:189-191 附近），另两家搜索（exa、perplexity）与一家抓取（http）可选；**抓取默认不挂载**——base 注释给出理由（`packages/bundle/base/cordis.patch.yml:400-403`）："该提供方把 SSRF 防护推迟了，而模型会自己选择请求目标"。

选择规则是执行期解析、与注册顺序无关（`packages/web/web/src/index.ts:62-73` 注释列六种情形）：显式配置 id 且可用 → 用它；显式但未注册/不可用 → 结构化错误；未配置且恰好一个可用 → 自动选中；多个可用 → **显式报歧义**而非随机取第一个（`resolveProvider`，:172-194）。`available()` 是运行事实而非注册事实：工具在提供方不可用时**仍然可见**，执行时抛结构化错误（`tool-web` 模块注释，:1-5 附近）——模型多一个出错分支，而非少一个工具。工具层默认 30s 超时（`packages/web/tool-web/src/index.ts:27`，`DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000`），base 把搜索路由行覆盖为 60s（`packages/bundle/base/cordis.patch.yml:414-418`：DeepSeek 搜索含服务端检索）。

## 12.11 高潮：换一个提供方，整个产品搬家

base 组合包把本机世界组装成（`packages/bundle/base/cordis.patch.yml`）`subprocess-local`（:163-164）+ `sandbox-local` + `sandbox-policy`（默认 `workspace-write`，:169-176）+ `bash-sandbox`（win32 上 disabled，改由 `pwsh-sandbox` 顶上，:178-186）+ `fs-sandbox`（:443-444）+ `tool-fs` + `fs-observation-policy`（:221-226）+ 审批与三预设（:188-205）——"**本地世界**"：文件、进程、沙箱、bash 全在宿主上。

现在看 `examples/headless-agent/e2b.cordis.yml`（:10-35）——它把整个世界搬到远程 E2B 沙箱：

```yaml
- id: base
  name: '@deepseek-ai/cordis-plugin-include'
  config:
    path: ./advanced.cordis.yml
    patches:
      - id: subprocess
        name: '@deepseek-ai/dsh-subprocess-local'
        disabled: true
      - id: fs-local
        name: '@deepseek-ai/dsh-fs-local'
        disabled: true
      - insert:
          - id: e2b
            name: '@deepseek-ai/dsh-e2b'
            config:
              cwd: !!js process.cwd()
              timeoutMs: 300000
          - id: subprocess-e2b
            name: '@deepseek-ai/dsh-subprocess-e2b'
          - id: fs-e2b
            name: '@deepseek-ai/dsh-fs-e2b'
```

动作只有两个：**禁用旧的（subprocess/fs）两行；插入新的（e2b/subprocess-e2b/fs-e2b）三行**。`tool-bash`、`tool-fs`、`tool-terminal`、`tool-lsp` 一行未动——`bash` 工具仍在、`read/write/edit` 仍在，只是"写到哪里"变了（文件经 fs-e2b 进远程沙箱，命令经 subprocess-e2b 在远程执行）。文件顶部注释讲透约束（examples/headless-agent/e2b.cordis.yml:1-9）：

> One-world invariant: e2b.cwd, sandbox-policy.workspaceRoot, and bash-local's default workdir (implicit host process.cwd()) must all name the same remote directory. Only e2b.cwd is created at sandbox open; dropping its !!js line falls back to /home/user/workspace while Bash and PTY keep targeting the host path, so every tool call fails with a remote spawn error.

**执行世界（execution world）**：fs 与 subprocess 提供方共享的一组"事实命名空间"——本地世界里，`ctx.fs` 的路径与 `ctx.subprocess` 的 cwd 都指宿主机；E2B 世界里两者都必须指远程沙箱。任何"文件与进程分离"的替换（只换 fs 不换 subprocess）都会破坏这个不变式——替换因此是**成组**的，`fs-e2b` 的注入要求与 `bash-local` 的默认 workdir 必须显式对齐。`examples/acp-agent/cordis.yml:160-164` 总结（"dsh-fs-sandbox replaces dsh-fs-local behind ctx.fs"），`packages/bundle/base/cordis.patch.yml:441-444` 则指出"`cwd` 默认为 `process.cwd()`；overlay 可以钉另一个工作区"。

对比总结：从 base 的三项替换（bash 本地→沙箱、fs 本地→沙箱、web 搜索→deepseek），到 acp 的单项覆盖，再到 e2b 的整体搬家——**同一 yml 语法、同一种"禁用+插入"动作，变化的只有被替换的行**。工具集（模型所见）不变，能力落点（工具背后的世界）全变。

## 12.12 收束：`declare module` 在织什么

回到 12.1 中"注册键声明"的实现。每次看到定义包里这样一段（以 fs 为例，`packages/fs/fs/src/index.ts:44-47`）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    fs: FileSystem
  }
}
```

这是 TypeScript 的**声明合并（declaration merging）**：`Context` 是 cordis 基座的公开接口（`vendor/cordis/src/context.ts:16`，注释"由核心服务与插件扩充，以描述可从 `ctx` 读取的属性"），任何包都可 `declare module` 向同一 `Context` 接口增补属性。**联邦类型声明（federated type declarations）**由此形成：`Context` 的完整形状是"cordis 基底 + 所有加载包声明的总和"——装了什么插件包，`ctx` 上就有什么类型。运行时由 `super(ctx, 'fs')` 的字符串键与 cordis 的 Proxy 机制（第 2 章）把属性读取解析到实际实现；编译期由声明合并保证 `ctx.fs` 的类型精确为 `FileSystem`。两者合起来才是"seam 的类型级广告"：类型系统告诉编译器"这里有插座"，运行时告诉对象"这里有电"。

还有**跨界合并**：`user-approval` 同时向 `@deepseek-ai/cordis`（`ctx.approval`）与 `@deepseek-ai/dsh-session/types`（`approval/asked` 等会话事件）两个模块声明合并（`packages/interaction/user-approval/src/index.ts:17-73`）；`permission-presets` 只做**纯类型**导入 `dsh-shell`/`dsh-session-projection`/`dsh-commands` 来合并需要的 `Context` 键（`packages/interaction/permission-presets/src/index.ts:19-27`："type-only……声明合并 `ctx.shell`，而无值依赖"）。类型扩充可以**只取类型、不引实现**——"消费方不得依赖具体提供方"在类型层面的镜像。

## 本章小结

1. **三角色蓝图**：能力 seam = 服务定义（契约+词汇+错误码+事件）→ 提供方（实现并注册 `ctx.<key>`，仅一个）→ 消费方（`tool-*`，只识 `ctx.<key>` 与词汇）；`super(ctx, key)` 带出唯一性检查。
2. **词汇归定义包**：错误码（`FsErrorCode` 13 码、`TerminalErrorCode` 8 码）、事件名（`fs/*`、`approval/request`）、不透明键（`FsTargetKey`/`FsVersion`）跨实现稳定：提供方换人、模型所见不变。
3. **三种策略形态互不耦合**：执行流水线瀑布（`tools/pre-execute`，第 11 章）、argv 包装（`sandbox.confine`）、事件监听器（`fs-observation-policy` 读后写、`approval/request` 审批）——后者是"无服务注入"的纯事件型策略。
4. **提供方分层有向**：shell 依赖 subprocess，terminal 依赖 subprocess + sandboxPolicy，bash/fs/terminal 共用 sandbox；"无默认值"（subprocess）与"默认收敛进 resolve"（shell）是同一思想两面。
5. **两条安全底线**：沙箱失败关闭（`SANDBOX_UNAVAILABLE`，绝不无约束放行；`enforcement: partial` 不冒充 full）与审批失败关闭（无应答方 ⇒ `unavailable`）。
6. **替换是成组的**：one-world 不变式要求文件、进程与工作目录同属一个执行世界——e2b 搬家是"禁用两行、插入三行"，而单 seam 替换（fs-local→fs-sandbox）只需一行。

## 分层练习

**理解**：
1. 用自己的话向同学解释"为什么 `ctx.fs` 一个上下文只允许一个实现是特性而非缺陷"，并引用源码依据。
2. 在 12.1 的八 seam 表中挑选三行，找出它们各自的"错误码封闭联合"定义位置，并说明错误码为什么必须归定义包。

**应用**：
3. 写出把 `fs-sandbox` 换回 `fs-local` 的最小 patch（参考 `examples/headless-agent/cordis.yml:156-158` 的形态），并说明 `read`/`write`/`edit` 三个工具的行为哪些会变、哪些不会。
4. 设计一个"shell 只允许白名单命令"的策略插件（提示：可以占住 `tools/pre-execute` 瀑布检查 `exec.tool`/`args.command`，也可以换一个继承 `LocalBashExecutor` 的提供方；比较两种方案各需要哪种注入）。参考"策略三形态"（本章小结 3）自检方案是否符合其中一种。

**综合**：
5. 解释 `examples/headless-agent/e2b.cordis.yml` 的 one-world 不变式；若只把 `subprocess` 换成 `subprocess-e2b` 而保留 `fs-local`，预测 `bash` 工具与 `read` 工具各自的行为，并指出哪类错误先出现（提示：路径与远程 cwd 不同源）。
6. 结合 12.7 与 `packages/bundle/base/cordis.patch.yml:196-205`，说明"read-only"预设为什么必须绑定 `approval: ask` 而不是 `never`（提示：只读模式下模型仍可能请求写）。

**挑战**：
7. 通读 `packages/fs/fs-observation-policy/src/index.ts` 的 `apply`（:106-129）并回答：为什么 `fs/observed` 监听器"必须同步且非抛出"？如果把 `gate.observe` 改成 `await` 一个异步函数，写防护的正确性会以何种方式被破坏？

## 延伸阅读

- `docs/capability-seams.zh.md` —— 全库能力 seam 的三角色关系图。
- `docs/tool-execution-pipeline.zh.md` —— 工具执行流水线全图（第 11 章配套）。
- `packages/fs/fs/README.zh.md` —— fs 四层栈（工具/执行器 → 政策 → 提供方约定 → 提供方）与 `fs/*` 事件词汇。
- `packages/shell/bash-sandbox/README.zh.md` 与 `packages/sandbox/sandbox-local/README.zh.md` —— 沙箱执行器与平台链的部署口径（探测、拒绝方言、win32 现状）。
- `examples/headless-agent/e2b.cordis.yml`、`examples/acp-agent/pty.cordis.yml` —— 本机→远程、opt-in 终端两个替换实例。
