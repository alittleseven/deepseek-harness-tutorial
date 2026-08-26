# 《从一条命令到一棵插件树——dsh 源码教程》分层练习参考答案

> 配套正文：`tutorial/chapters/01`–`/17` 十七章（见 `README.md` 学习路线）。
>
> **引用规范**：所有"文件:行号"均以仓库 `C:/Users/yq/Desktop/develop/deepseek-harness`（v0.1.0-rc.5，提交 `47f943859bef60e4160492346772ded9b24f765a`）实读核实为准；同一段落内**首个**引用给出仓库相对完整路径，其后用 `文件名:行号` 或 `:行号` 简写。个别与正文标注相差 1–2 行的，以本文件的实核行号为准。术语与正文一致（phase=相位、inbox=收件箱、wake=唤醒、latch=锁存、barrier=屏障、provider=提供方、consumer=消费方、seam=接缝、projection=投影、compaction=压缩、guard=守护、preset=预设、patch=补丁、driver=驱动器、surface=表面、profile=配置档案、overlay=叠层；realm、screen 保留英文）。
>
> **标注约定**：凡需运行构建后的 `dsh` 二进制才能实录的结论标 **（未验证）** 并附源码推演链；凡由源码推断、未见直接证据的结论标 **（推断）**。
>
> **勘误与实核说明**（题面或正文标注有误处，答案一律按实核位置给出）：
> ① 第 1 章正文与答案行号偏差两处：`apps/cli/src/bin.ts:36`（正文引 bin.ts:34 处为 `invocation.args` 的实际行号）、`apps/cli/src/dump-config.ts:1-7`（正文引 1-6，`@module` 在 6）。
> ② 第 6 章正文第 3 步引用 `vendor/include/src/index.ts:298-306` 讲 `loadOverlayPatches`，该函数实际位于 `packages/boot/app-boot/src/index.ts:298-306`。
> ③ 第 10 章第 2 题题面所引 `packages/llm/token-meter/README.zh.md:24-26` 与该题讨论的 `complete` 段语义无关（该区间实测为"## 会话投影"节标题）；正确对照为 `packages/core/system-prompt/src/index.ts:24-26`（assemble 事件注释："A registered complete section is restored after this waterfall, so listeners cannot add to or replace that scope's system prompt."）。
> ④ 第 15 章第 3 题 `SCHEMA_VERSION=15` 的出处，正文 §15.4.1 标注为 `packages/session/session-persistence-jsonl/src/index.ts:20`，实核正确出处为 `packages/session/session-persistence-sqlite/src/schema.ts:20`（sqlite 的 `src/index.ts:28` 仅 re-export）。
> ⑤ 第 16 章第 7 题题面指向 `packages/api/gateway/src/index.ts:251-275` 的 `newSession`，实核该函数位于 `packages/acp/acp/src/index.ts:251-277`（gateway 该区间是 `resolveSrcDescriptor` 等相关代码）。
>
> **（未验证）分布**（共 9 题 13 处标记，均附源码推演链，待构建 dsh 后真机复核）：第 1 章应用层 3、4；第 6 章第 3、6 题；第 7 章第 5 题（验证要点）；第 10 章第 4 题；第 11 章第 3 题；第 17 章第 5、6 题。**（推断）** 共 8 处：第 15 章第 8 题（fs.link 平台相关、renameat2 无 Node 绑定）；第 16 章第 6 题（profile 层 patch 绕过 CLI 守卫）；第 17 章第 1 题（mintPackageId 无需查重）；第 17 章第 5 题（--patch 不在热重载监视清单、插件源码不在监视清单）；第 17 章第 8 题（静态扫描可被绕过、守卫不防运行期注入）。

---


## 第 1 章 从一条命令到一棵插件树

### 理解层

**1. 为什么 `dsh web --help` 打印的不是启动器自己的帮助？**

一句话回答：**`--help` 根本没有被启动器解析，而是作为"启动器旗标之后的一切"原样交给了被启动的 web 应用树**。

拆开看有四层证据：

1. **启动器只解析自己的东西**。`apps/cli/src/args.ts:4-7` 的模块注释写得很直白："The launcher parses only what it owns — which profile to boot, which extra patch overlays to apply, and the config dumps — and hands **everything after its own flags** to the booted tree verbatim, where injected app plugins parse their own flag families and print their own `--help`."（启动器只解析属于它自己的东西：启动哪个 profile、追加哪些补丁 overlay、以及配置转储；它把**自己旗标之后的一切**原样交给被启动的树，由树里注入的应用插件解析各自的旗标族并打印各自的 `--help`。）
2. **官方示例文本**。`args.ts:10-11` 明确写道："`dsh --profile web -h` prints the web app's help, not this one's."。`args.ts:66-70` 的 `HELP_EXAMPLES` 里也有一条：`dsh --profile web --help` → "the web app's own flags and help"。
3. **`web` 只是别名**。`args.ts:13`："`web` is a hardcoded alias for `--profile web`"。`args.ts:150-168` 把 `web` 注册为子命令，其 `action` 最终仍走 `resolveBoot`（`args.ts:166-168`），即"启动 web profile"。
4. **解析停靠机制**。`args.ts:123-129` 注释解释了停靠规则：启动器旗标在前，遇到第一个不认识的 token 就结束，其后的一切（包括应用的 `-h`/`--help`）都归属应用；`web` 子命令本身也声明了 `.allowUnknownOption()`、`.passThroughOptions()`、`.enablePositionalOptions()`（`args.ts:159-161`）并把 `helpOption(false)` 关掉（`args.ts:158`），正是为了把 `--help` 放行给应用。

所以 `dsh web --help` 的执行链是：启动器认出 `web` → 决定启动 web profile → 把 `--help` 当作"启动器旗标之后的一切"传给应用树 → web 应用自己的命令行插件（见正文 1.2.2 提到的 `@deepseek-ai/dsh-cmdline`）打印它自己的帮助。反过来，**不带 profile 的 `dsh -h` 才打印启动器自己的帮助**（`args.ts:123-125` 注释）。

**2. 为什么 `dsh --profile headless "fix the test"` 成功时 stdout 只有一行文本、stderr 为空？**

因为 headless 是一个**非交互、一次性、成功即静默退出的任务型入口**：

- `apps/cli/reference/README.md:30` 定义了 headless 的整体行为：回答一个任务（one-shot task）、静默等待完成（不进入交互循环）、把**最后一个非空 assistant 文本**写到 stdout、任务 completed 则退出码 0、否则退出码 1；它**不挂载任何 Host/HTTP/Web** 面。
- `packages/bundle/headless/README.zh.md:5-7` 给出了更细的输出通道约定（正文引 5-7）："它不挂载任何 Host……"（第 5 行）；运行器把结果写到 stdout，只有**出错**时才把错误（错误码 + 消息）写 stderr；第 7 行明确："**成功运行时 stderr 保持为空。进程不会打开监听端口。**"

把两条合起来就是答案：stdout 恰好一行 = 任务结果（最后一个非空 assistant 消息）是唯一"有意输出"；stderr 为空 = stderr 只承担失败诊断通道，成功路径上没有任何东西写它；没有监听端口 = 没有 webserver/HTTP 等其他输出源。作为对照，`apps/cli/tests/built-bin.e2e.ts:719-721` 断言 headless 的转储不含 `dsh-host-`、`dsh-web-app`、`dsh-client-` 任何一行——"无面"是机制保证的，不是靠打印纪律自觉。

### 应用层

**3. （未验证）在 `dsh --profile web --dump-config` 输出中找 3 个插件 id 并对照 `packages/`**

**（未验证）**：本机仓库无 `node_modules`、无可执行构建产物，无法真机运行 `dsh --profile web --dump-config`；以下改按题面允许的方式"读源码代替"，给出**真实存在、可直接对照**的 3 个 id、它们各在什么文件里被声明、以及 `packages/` 里对应的实现目录。等你在已构建的机器上运行后，可以逐行核对下面的清单。

转储输出是"层叠补丁"的结果（正文 1.4.3）：bundle 层（dsh-base）→ web 层（dsh-web-app）→ 用户层 → overlay。下面 3 个 id 分别取自两个 bundle 补丁，都是输出中稳定出现的行：

| 插件 id | 声明位置 | `name` 包名 | `packages/` 实现目录 |
|---|---|---|---|
| `timer` | `packages/bundle/base/cordis.patch.yml:16-17` | `@deepseek-ai/cordis-plugin-timer` | `vendor/timer/`（vendored 基础定时器插件，正文 1.4.3 亦引用） |
| `llm` | `packages/bundle/base/cordis.patch.yml:24-25` | `@deepseek-ai/dsh-llm` | `packages/llm/llm/`（模型 API 适配层：请求、流式、重试） |
| `webserver` | `packages/bundle/web-app/cordis.patch.yml:115-120` | `@deepseek-ai/dsh-host-webserver` | `packages/host/webserver/`（web 会话的 HTTP/WebSocket 宿主） |

更完整的备选（同出处）：`hmr`（base 19-22）、`session`（base 27-28）、`agent-loop`（base 436-439，`packages/core/agent-loop/`）、`modules`（web-app 151-152，`packages/client/modules/`）、`storage-json`（web-app 54-56，`packages/storage/storage-json/`）、`system-prompt`（web-app 16-20）。

**验证方法**（正文 1.4.3 的规律 1-4）：转储中每个插件行上方有 `# == <来源>` 注释（`packages/boot/app-boot/src/index.ts:454`）；被 web 层改写的行显示 `# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app`（`index.ts:462-464`）。你可以在输出里看到：`system-prompt` 行来自 web-app 16-20 的覆盖，`hmr` 行带着 `disabled: true`（web-app 22-23 覆盖）；而 `webserver`、`modules` 行的分组注释就是 `# == @deepseek-ai/dsh-web-app`（web-app 层新增）。

**4. （未验证）针对 `agent-loop` 写一条 `--patch` overlay，观察 `patched by` 与 stderr**

**（未验证）**：本机无构建产物；以下按 `apps/cli/tests/built-bin.e2e.ts:724-761` 的测试用例推演预期结果（该用例正是"composes the profile user layer and a `--patch` overlay in order"的端到端断言）。

(a) 先确认要覆盖的目标行。`packages/bundle/base/cordis.patch.yml:436-439`：

```yaml
    - id: agent-loop
      name: '@deepseek-ai/dsh-agent-loop'
      config:
        agents: []
```

(b) 写 overlay（例如 `extra.yml`），注意 **`id` 必须与目标行完全一致**：

```yaml
- id: agent-loop
  config:
    agents:
      - name: 'my-agent'
```

(c) 运行 `dsh --profile web --dump-config --patch ./extra.yml`。按 e2e 用例（`built-bin.e2e.ts:724-761`，其中 756 断言输出含覆盖后的内容、757 断言不含用户层旧值、759 断言 `patched by <profilePatch>, <overlay>`、760 断言 stderr 出现 `patch: entry "absent-row" not found`）推演，你会看到：

- `agent-loop` 行的分组注释变成 `# == @deepseek-ai/dsh-base, patched by <extra.yml 的绝对路径>`——因为 overlay 以**绝对路径**入层（`apps/cli/src/dump-config.ts:45-48`），`patched by` 标签由"该行被哪些层改写"推出（`packages/boot/app-boot/src/index.ts:462-464`、`index.ts:422-441` 的 provenance 比较）。
- 行内容被整行替换：`config.agents` 变成你写的 `my-agent`（补丁语义是"整行替换 config"，见 base/cordis.patch.yml 顶层注释与正文 1.4.3 规律 2）。
- **stderr 为空**（id 命中时无未命中警告；警告只在未命中时递延写出，见下）。
- 若你故意把 id 写成 `agent-loops`（或写一条针对性不存在的行），stderr 会出现 `patch: entry "agent-loops" not found`——这是 `renderConfigDump` 的"递延警告"机制：每层快照先算、警告按层拼接、最后统一 `warn` 到 stderr（`packages/boot/app-boot/src/index.ts:429-432`；`warn` 默认走 stderr，`index.ts:383`；e2e 断言见 `built-bin.e2e.ts:760`）。

**顺带说明层序**：`--patch` overlay 是**最晚**的一层，排在 bundle 层、profile 层、home 层之后（`apps/cli/src/profile-boot.ts:121-129` 的 `allPatches` 顺序：bundle → profile → home → overlay），所以即使 `agent-loop` 行被用户层或 web 层改过，overlay 依然能覆盖它。

### 综合层

**5. `--dump-config` 与 `--dump-config --patch x.yml` 在 `agent-loop` 行不一致、但补丁"没生效"——至少两个诊断方向**

四个提示恰好对应四个方向（下面按"先易后难"排）：

- **方向一：确认你跑的是 `--dump-config` 而不是 `--dump-default-config`**。两者互斥（`apps/cli/src/args.ts:89-91`），且 `--dump-default-config` **不接受 `--patch`**——`args.ts:99-101` 的报错文本直接说明："`--dump-default-config` prints the bundle layers and takes no `--patch`"。`--dump-default-config` 的输出**只含 bundle 层**、不含用户层与 overlay（`apps/cli/src/dump-config.ts:30-52`：:31 的 `prepareProfile(profile, !defaultOnly)` 把 defaultOnly 直接传下去、:32-35 只铺 bundle 层、:45-48 的 overlay 分支被 `!defaultOnly` 挡住）。所以两个命令的层集本身不同，`agent-loop` 行的差异可能**完全是预期差异**，而不是补丁失效。
- **方向二：看 stderr 的未命中报告**。补丁未命中任何行时不会静默消失：`renderConfigDump` 把警告递延到快照之后统一写出（`packages/boot/app-boot/src/index.ts:429-432`，`warn` 默认 stderr，`:383`），测试断言里就是 `patch: entry "absent-row" not found`（`apps/cli/tests/built-bin.e2e.ts:760`）。如果 stderr 有这行，说明 **id 打错了**（例如写成 `agent-loops`），或者目标行根本不在被应用的那几层里。
- **方向三：用 `--dump-default-config` 做"恢复诊断"**。`apps/cli/src/dump-config.ts:24-27` 的注释把它定义为"`cordis.patch.yml` 损坏时的恢复诊断"：用户层（或 home 层）YAML 解析失败时，这个旗标可以跳过它们、直接看到 bundle 层的真实内容。如果用户层文件损坏，`--dump-config` 可能整个输出都不是你预期的树——"不一致"就与 `--patch` 无关。
- **方向四（观察角度）**：转储是 boot-free 的——它**不运行应用命令行提供方**（`apps/cli/src/args.ts:92-94` 注释），命令行决定的配置在转储里一律不出现；且 `args.ts:95-97` 直接拒绝"转储 + 应用参数"的组合。如果你的补丁想改的是命令行相关的配置，或你期待 `--patch` 之后的输出与启动树一致，这个差异就是设计使然的。另外要分清"行被覆盖"的两种显示：被覆盖行会带 `patched by` 标签（`index.ts:462-464`），而**新增行**只显示 `# == <来源>`——检查你观察到的差异到底是"值变了"还是"行没了/行了"。

**建议排障顺序**：先 stderr（未命中立刻现形）→ 再确认旗标是 `--dump-config` 而非 `--dump-default-config` → 再核对 `id` 与目标层 → 最后用 `--dump-default-config` 排除用户层损坏。

### 挑战层

**6. 一条补丁从命令行到 `agent-loop` 行的完整旅程**

按执行顺序列出各站（文件:行号为实核值）：

| 站 | 位置 | 发生的事情 |
|---|---|---|
| ① 命令行 | `apps/cli/src/args.ts:56-61`（`collect`） | `--patch a.yml --patch b.yml` 被 `collect` 逐次累积为 `string[]`，**绝不变参**（注释：变参会吞掉内部参数）；`parseDshArgs`（`args.ts:112`）把它放进 `invocation.patches` |
| ② 分发 | `apps/cli/src/bin.ts:36`（`invocation.args`）、`bin.ts:45-48` | switch 命中 `dump-config` 分支，调用 `runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)` |
| ③ 层栈成形 | `apps/cli/src/dump-config.ts:30-52` | `runDumpConfig`：`:31` `prepareProfile(profile, !defaultOnly)`；`:32-35` 铺 bundle 层；`:37-39` 用户层；`:41-44` home 层；`:45-48` overlay 层（label=**绝对路径**，且仅当 `!defaultOnly`）；`:51` 调 `renderConfigDump` |
| ④ 快照与补丁应用 | `packages/boot/app-boot/src/index.ts:411-419` | `snapshot`：`:412` `structuredClone(flattened)`；`:413` `applyEntryPatches(base, flattened, cb)`——补丁真正作用在**这一行**（算法定义在 `vendor/include/src/index.ts:58`，第 5 章详述） |
| ⑤ 出处比较 | `app-boot/src/index.ts:422-441` | 对"应用补丁前/后"的两份快照做 diff，推出**每一行被哪些文件补丁改写**（`patched by` 的数据来源） |
| ⑥ 渲染与警告 | `app-boot/src/index.ts:445-473`、`:428-432` | `groupedDump`：`:454` 打印 `# == <origin>` 分组注释；`:462-464` 打印 `<origin>, patched by <layers>`；未命中警告 `:429-432` 递延、`:431` warn 到 stderr |
| ⑦ 目标行 | `packages/bundle/base/cordis.patch.yml:436-439` | base 层插入的 `agent-loop` 行（`:436` `id: agent-loop`、`:437` name、`:438` config、`:439` `agents: []`），是补丁 id 要命中的行 |

**在哪一站后补丁才可能改变转储输出？**

答案是**第 ③ 站之后**：只有 `runDumpConfig` 把 overlay 放进 layers（`dump-config.ts:45-48`），第 ④ 站的 `snapshot`/`applyEntryPatches` 才可能拿到它；在此之前（①②）补丁只是"字符串在搬运"，不会对输出有任何影响。更精确地说，一个补丁要改变输出需要同时满足三个条件：

1. 它进入层栈：`dump-config.ts:45-48`（`defaultOnly === true` 时永远不满足，`args.ts:99-101` 也会直接报错）；
2. 该层被快照覆盖：`app-boot/src/index.ts:411-419` 对每一层依次计算；
3. 行 id 命中：`:413` 的 `applyEntryPatches` 按 id 定位并整行替换。

所以"补丁生效"的充分条件是"**从第 ③ 站起它作为 overlay 层参与快照序列，且在第 ④ 站命中目标 id**"；两个条件缺一，输出就不会变，且 ⑥ 的未命中警告会替你说出原因。

---

## 第 2 章 Context 与 Service

### 理解层

**1. 酒店类比：为什么"消费方只报名字"比"import 提供方"更合适"配置换实现"**

先给出两个概念：服务（service）是"由某个提供方（provider）定义并对外提供、可供其他插件使用的一段功能"（`docs/cordis-tutorial/03-services.zh.md:5`）；插件的消费方（consumer）**只声明服务名**（如 `inject: ['counter']` 或在 `apply` 里直接写 `ctx.counter`），并不 import 提供方的类。

对照酒店：前台是 context，住店客人是消费方，房间是服务实现。客人的正确请求方式是**报需求**——"我要一间可上网的房间"（服务名 `counter`/`logger`），而不是报**房间号**——"我要 302 房"（import 具体的 `CounterServiceImpl`）。前者由前台（context/运行时沿 fiber 链查找，`vendor/cordis/src/reflect.ts:153-167`）按当天房态分配房间；后者把"哪一间"写死在了客人的话里。

为什么这适合"配置换实现"：

- **契约与实现分离**。报名字时，客人只依赖"可上网"这个契约；酒店把 302 换成 401（配置里换 provider），客人不用换房、不用改口。若客人报房号，房型一变，所有客人（消费方插件）都得改——这正是 import 提供方类的下场：类型与实现耦合进消费方源码。
- **换实现由机制驱动**。`03-services.zh.md:76` 指出：当服务提供方被卸载时，依赖它的插件会被**自动卸载/重载**。也就是说，配置换实现不是"消费方代码不变量地换一个对象"，而是机制直接替消费方完成"拆掉重建"——客人甚至不需要知道前台换了房（见第 3 章 3.6 的"提供方实例即身份"推论：epoch 变更 ⇒ 消费方连带重载）。
- **名字是查找键，不是身份**。同名服务可以由不同插件提供，消费方每次解析都沿 fiber 链重新查找（`reflect.ts:153-167`）；而 import 是编译期的、单向的、不可替换的。

一句话总结：**报名字把"选择实现"的决策权交给运行时（context 与配置），import 把决策权焊死在源码里**；前者让"配置换实现"成为一条数据通路，后者让它变成一次源码改动。

**2. `new Context()` 中 `:74` 与 `:83` 两行配合的意图**

`vendor/cordis/src/context.ts:71-84` 的构造器（root context）核心两行：

```ts
const self = new Proxy<this>(this, ReflectService.handler)   // :74
...
return self                                                  // :83
```

配合的意图：**`Context` 实例必须是"可拦截属性读取"的代理对象，"读取即解析服务"才能成立**。

- `:74` 把构造中的 `this` 包成 `Proxy`，拦截器是 `ReflectService.handler`——之后对 `ctx.xxx` 的任何属性访问都先经过 get 陷阱，进入 `vendor/cordis/src/reflect.ts:135-171` 的六分支（特殊属性直通 → 自有属性直通 → accessor → 根退化 → 沿 fiber 链爬 store → ……），服务在此被"按需解析"。
- `:83` `return self`：构造器**返回代理而不是 `this`**。如果省略它（或返回普通对象），外面拿到的是裸 `Context`，`ctx.counter` 就是一次普通属性读取——`counter` 会被当"未定义属性"处理或根本无从触发解析；`return self` 保证**从构造那一刻起，外部拿到的永远是代理**。
- 两行配合的完整闭环：先造代理（这样构造器体内部的初始化，如 `this.registry`、`this.events`、`this.logger` 等内建服务的挂载（`:77-81`），以及 `this.fiber._disposables.clear()`（`:82`），都发生在"可被代理观察"的同一个对象上），再把代理交出去——**内部是普通对象，外部是解析入口**。这也是所有 `extend()`/`isolate()`/`intercept()` 返回"子 context"仍然能解析服务的原因：子 context 通过原型链继承父代理的 get 行为（`context.ts:101` `Object.create(getTraceable(this, this))`）。

### 应用层

**3. 计数器服务 `CounterService` + 消费插件**

```ts
import { type Context, Service, type Plugin } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    counter: CounterService
  }
}

export class CounterService extends Service {
  private count = 0
  constructor(ctx: Context) {
    super(ctx, 'counter')        // 服务名：'counter'
  }
  inc(): number {
    return ++this.count
  }
  value(): number {
    return this.count
  }
}

// 消费插件：apply 里两次 inc 后打印
export const counterConsumer: Plugin = (ctx) => {
  ctx.counter.inc()
  ctx.counter.inc()
  console.log('counter value:', ctx.counter.value())
}
```

要点说明：

- `super(ctx, 'counter')` 走 `Service` 构造器（`vendor/cordis/src/service.ts:42-58`）：`name ??= this.constructor['provide']`（`:43`，也可写在静态 `provide` 字段上）→ `self.ctx = ctx; self.name = name`（`:52-53`）→ `self.ctx.reflect.provide(name, self, this[symbols.check])`（`:56`）——真正的"注册"在 `reflect.provide` 里完成（`vendor/cordis/src/reflect.ts:277-305` 五步：声明 props → 取 isolate 符号 → 查重 → 入册 store → 通知）。
- `declare module`（`:146` 同款写法见 `packages/core/agent/src/runtime-types.ts:146`）只是**编译期**增强：让 `ctx.counter` 有类型；运行时行为完全由 Proxy 分支决定（`docs/cordis-tutorial/03-services.zh.md:40`）。
- **`ctx.counter` 第一次读取发生在哪个分支**：**分支 6——"沿 fiber 链爬 store"**（`vendor/cordis/src/reflect.ts:153-167`）。推演：它不是特殊属性、不是自有属性、没有 accessor（前四分支都不命中，`:137`/`:140`/`:148`）；消费插件所在的 context 不是根 context（`ctx.counter` 命中"根退化"分支 `:152` 的前提是 `prop === 'root'` 之类特殊键，且根退化只对根生效）；于是 `:153` 进入 `waterfall('internal/get', ...)`，`:155` 取当前纤维，`:156` 沿父链 while 循环，`:157` 检查 `fiber.store?.[prop]` ——到提供方 fiber 时命中 `store['counter']`，返回 `CounterService` 实例。若把 `CounterService` 换成 `inject: ['counter']` 的声明式写法（`vendor/cordis/src/registry.ts:300-302` 的语法糖），只是**多了"等房"环节**（依赖未满足时消费方先停在 PENDING，见第 3 章 3.5），读取本身仍走爬链分支。

**4. `extend` 与 `isolate`：父子共享/不共享同一计数器 + 爬链示意图**

先交代机制差异（这是"共享与否"的全部秘密）：

- `extend(meta)`（`context.ts:99-107`）只**叠加元数据**：子 context 通过原型链继承父的一切（`:101`），不改父、也不改任何隔离表——**注释 `:94`：The parent is not mutated.**
- `isolate(name, label)`（`context.ts:110-126`）在子 context 上创建**新的作用域符号**：`:123` `const shadow = Object.create(this[symbols.isolate])`（继承父的隔离表）、`:124` `shadow[name] = label ?? Symbol(name)`——同一个服务名在子作用域拿到**另一把钥匙**；相同 label 的两次 `isolate()` **合并作用域**（`:115`）。

**（a）`extend`：父子共享同一计数器**

```ts
const parent = new Context()
parent.plugin(CounterService)                 // 提供方，挂在 parent 根纤维
const child = parent.extend({ label: 'child' })

child.plugin(counterConsumer)                 // 消费方：ctx.counter.inc() 两次
console.log(parent.counter.value())           // 2 —— 与 child 是同一个实例
```

解析过程：child 的 context 在原型链上继承 parent（`extend` 不改 isolate 表），`ctx.counter` 的爬链从 child 纤维出发：`fiber.store['counter']` 无 → 沿 `fiber.parent` 爬到 parent 纤维 → 命中 `store['counter']`（`reflect.ts:157`、`:159`）→ 返回同一个 `CounterService` 实例。两个 context 的 `counter` 指向同一计数器。

**（b）`isolate`：父子不共享（同名双实现）**

```ts
const parent = new Context()
parent.plugin(CounterService)                 // 默认符号下的 'counter'（计数 A）

const child = parent.isolate('counter')       // 子作用域新符号 key2
child.plugin(CounterService)                  // 同名字、不同符号（计数 B），不报 "has been registered"

console.log(parent.counter.value())           // 0（A 的）
console.log(child.counter.value())            // 0（B 的）—— 两者互不可见
child.plugin(counterConsumer)                 // 消费方在 child 下解析到 B
```

解析过程：child 的 `ctx[symbols.isolate]['counter']` 是**新符号**（`:124`），所以 `_getImpl`/爬链用的 `key` 与 parent 的 `store` 键不同——`reflect.ts:164` 的守卫"隔离符号不等 → 抛/停止"保证 child 的读取**不会命中 parent 的 store**；同理 parent 也读不到 child 的实现。同名双实现由此成立（这正是 Q5 报错的正解之一）。

**（c）沿 fiber 链搜索示意图（对应 `reflect.ts:153-167` 的爬链循环）**

```
                        child context ──isolate('counter')──> 符号 key2（新锁）
                              │
                              │  ctx.counter
                              ▼
        ┌────────────────────────────────────────────────┐
        │  :155  let fiber = (ctx[symbols.shadow] ?? ctx).fiber
        │        —— 从"当前 context 所在纤维"出发          │
        └────────────────────────────────────────────────┘
                              │
        :156 while (fiber)  ┌─┴──────────────────────────────┐
        ┌────────────┬──────▼─────────┬─────────────────────┐
        │ fiber: child│ fiber: parent  │ fiber: root         │
        │ store: {}   │ store: {K:impl}│ store: {…}          │
        │   :157 查 store[key2] ✗      │  :157 查 store[key2] │
        │  → 向父爬 :165               │  → 命中?            │
        └────────────┴─────────────────┴─────────────────────┘
```

- **extend 版**：child 与 parent 的 `ctx[symbols.isolate]['counter']` 是**同一个符号** K——爬到 parent 纤维时 `store[K]` 命中，返回同一实例（**共享**）。
- **isolate 版**：child 拿到新符号 key2，`store[key2]` 在 child、parent 各纤维里都查不到（parent 只有 K），按 `:164` 的"隔离符号不等"逻辑，child 的查找**被隔离守卫截停**（要么抛、要么视为不可见），不会误吞 parent 的实现（**不共享**）；隔离后 child 有自己的提供方时，`store[key2]` 在 child 纤维上命中。

### 综合层

**5. `service "tools" has been registered at <sometools>` 的触发条件与两种合法修复**

**触发条件**：`vendor/cordis/src/reflect.ts:286-291` 的 `provide` 查重——`provide(name, impl)` 先取当前 context 的作用域符号键 `key = ctx[symbols.isolate][name]`（`:286-287`），随后 `:289 if (this.store[key])` 发现**同一个作用域符号键上已经有实现**，`:290` 抛错 `service "tools" has been registered at <${this.store[key].fiber.name}>`——`<sometools>` 正是**先占者**（第一个提供 `tools` 的插件）的纤维名。

翻译成人话：**两个提供方在同一个逻辑作用域里注册了同一个服务名**。注意"同一个逻辑作用域"不等于"同一个 context"——只要两个插件共享同一把符号钥匙（都在根 context、或都从同一个父 `extend`/`isolate` 同 label，`context.ts:115` 合并作用域），它们的 `key` 就相同，就会撞车。

**两种合法修复**：

- **修复一：作用域符号（isolate）**——给其中一个提供方一个独立的隔离作用域：`ctx.isolate('tools')`（`context.ts:110-126`）；它获得新符号（`:124`），与先占者不再同键。注意：两次 `isolate('tools')` **不加 label 各自拿新符号**（默认 `Symbol(name)`）；若你想要"同作用域合并"，必须传**同一个 label**（`:115`）。这样两个 `tools` 实现可以并存，各自服务于自己的子树。
- **修复二：命名空间（改名）**——服务名是**扁平命名空间**（`docs/cordis-tutorial/03-services.zh.md:92-94`：不存在 `a.b.c` 这种层级，`a` 与 `a.b` 是不同名字），所以把后到的提供方改名为 `tools-extra`、`dsh.tools` 之类，消费方相应改成 `inject: ['dsh.tools']` 即可。这条不改变作用域结构，只消除同名。

**判别原则**：如果两个 `tools` 服务**应该互不干扰**（服务于不同子树），用修复一；如果它们**语义上就不该同名**（一个是 dsh 的工具服务、一个是别的东西），用修复二。

**6. 子 Context `intercept('logger', {level:'debug'})`、父 `intercept('logger', {level:'info'})`，子 Context 下解析的最终 `level`**

**最终 `level` = `'debug'`（子/叶子的拦截胜出）。**

推导依据：`vendor/cordis/src/service.ts:86-102` 的 `Service[symbols.resolveConfig]`（`logger` 服务的配置解析函数）：

```ts
let intercept = this.ctx[Context.intercept]        // :87  从"解析点"的代开始
const configs: any[] = []
while (this.name in intercept) {                   // :89  沿原型链向上
  if (Object.hasOwn(intercept, this.name)) {       // :90  只有"这代自己注册的"才算
    configs.unshift(intercept[this.name])          // :91  头插！
  }
  intercept = Object.getPrototypeOf(intercept)     // :93  向父代走
}
if (base) configs.unshift(base)                    // :95  最低优先级垫底
if (head) configs.push(head)                       // :96  最高优先级封顶
if (this['Config']?.merge) { ... }                 // :97-98 有声明 merge 则深合并
else return Object.assign({}, ...configs)          // :99-101 否则浅合并、后者胜
```

逐步推演（子 Context 下解析 `logger`）：

1. **收集**：从子 context 的拦截表出发（`:87`），先读到子代注册的 `{level:'debug'}`，`unshift` 进 `configs`（`:91`）→ `configs = [{debug}]`；沿原型链到父代（`:93`），读到父代注册的 `{level:'info'}`，再 `unshift` → `configs = [{info}, {debug}]`——**根先叶后**（数组头部是父、尾部是子），这正是注释 "Entries added closer to the root apply first" 的体现。
2. **合并**：两个对象先 `Object.assign({}, {info}, {debug})`——**后面覆盖前面**（`:99-101` 的浅合并；`:97-98` 的 `Config.merge` 只在服务声明自定义合并时使用）。`level` 先被 `'info'` 赋值、再被 `'debug'` 覆盖。
3. **结论**：`level === 'debug'`。

**直观记忆**：intercept 的合并规则与 CSS 类似——"离解析点越近（越叶子）优先级越高"；`intercept` 不改父级（`context.ts:133`：The parent context is not affected），父的 `info` 只在父作用域下解析时胜出。

### 挑战层

**7. 可调用的 `EchoService`（实现 `[symbols.invoke]`，`createCallable` 角色）**

参照 `LoggerService`（`vendor/cordis/src/logger.ts:251-261`）的模式：`LoggerService` 定义了 `[symbols.invoke](name?)`，调用 `ctx.logger()`（可调用服务）时返回一个 `Logger` 实例；`EchoService` 照此实现：

```ts
import { type Context, Service, symbols } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    echo: EchoService      // 服务本身可调用；description 挂原型
  }
}

export class EchoService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'echo')
  }

  // 需要实现的符号方法：调用的入口
  [symbols.invoke](message: string): string {
    return `[echo] ${message}`
  }

  // 必须放在"原型"上（而非构造器里给实例赋值的自有字段）：
  // createCallable 只改原型链，不会把实例的自有字段拷到 callable 上
  get description(): string {
    return 'echo the message back wrapped in [echo]'
  }
}

// 使用
ctx.echo('hi')           // => '[echo] hi'（调用 invoke）
ctx.echo.description     // => 'echo the message back wrapped in [echo]'（原型 getter 可达）
```

**两个关键知识点**：

- **你要实现的符号方法**：`[symbols.invoke]`。`Service` 构造器在 `vendor/cordis/src/service.ts:49-51` 检测 `if (self[symbols.invoke])`，只要实例上存在这个符号方法，就把 `self` 换成 `createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker)`——于是 `ctx.echo` 从"对象"变成"函数对象"（可调用），而 `Service` 自身的 `ctx`/`name`/`tracker` 照常挂上去（`:52-54`），最后 `reflect.provide(name, self, ...)`（`:56`）注册的也是这个函数对象。
- **`createCallable` 的角色**（`vendor/cordis/src/utils.ts:226-233`）：它造一个真函数 `function (...args) { ... }`（`:227-230`），函数体拿 `self['ctx']` 造 traceable proxy 后把调用转发给 `[symbols.invoke]`（`applyTraceable`，`utils.ts:220-222`）；`:231` `defineProperty(self, 'name', name)` 让函数名就是服务名；`:232` `Object.setPrototypeOf(self, proto)` 把函数对象的原型链接到"实例原型 ∪ Function.prototype"——**这一步是 `ctx.echo.description` 可读的原因**：`proto` 是 `joinPrototype(实例原型, Function.prototype)`，所以原型上的 getters/方法在 callable 上依然可见；而**实例自有字段不会被复制**，所以 `description` 必须写成原型 getter（或服务内通过 `Object.defineProperty` 显式放置），否则会得到 `undefined`。这是"可调用服务 + 属性共存"最容易踩的坑。

---

## 第 3 章 插件与可逆副作用——Fiber 与 effect

### 理解层

**1. `FiberState` 六态的枚举顺序与各态真实场景**

`vendor/cordis/src/fiber.ts:147-153` 的枚举顺序（`export const enum FiberState`）：

```ts
PENDING,      // 148
LOADING,      // 149
ACTIVE,       // 150
FAILED,       // 151
DISPOSED,     // 152
UNLOADING,    // 153
```

即 **PENDING → LOADING → ACTIVE → FAILED → DISPOSED → UNLOADING**（与 3.8 节 `stateName` 数组的映射一致：`['PENDING','LOADING','ACTIVE','FAILED','DISPOSED','UNLOADING']`）。每个状态的"进入场景"：

| 状态 | 真实场景 |
|---|---|
| `PENDING` | 消费方插件挂载时其依赖（如 `inject: ['counter']`）还没提供：`_checkImpl` 失败（`fiber.ts:611-623`），停在"等房"状态；3.8 示例的 `consumer` 初态就是它 |
| `LOADING` | 依赖齐备、`_reload` 开始执行插件体（`fiber.ts:646-673`）但尚未完成：函数插件正在跑 `apply(ctx)`，或类插件构造器正在执行（`fiber.ts:250-261` 的 `execute`） |
| `ACTIVE` | 加载完成、依赖稳定：`_getState` 推导——`uid` 非空、无 `_error`、`epoch !== INACTIVE`（`fiber.ts:575-578`）；此时服务可被他人读取（strict 解析仅放行 ACTIVE，`reflect.ts:241`） |
| `FAILED` | 插件体或配置校验抛错：`_reload` 捕获后 `_error` + epoch 置 `INACTIVE`（`fiber.ts:662-663`），`_getState` 据此返回 FAILED（`:576`）；例如 `apply` 中访问不存在的服务抛 TypeError |
| `DISPOSED` | 被真正销毁、`uid = null`（`fiber.ts:268`）：父纤维卸载、disposer 执行完毕，此纤维**不可再复活**（重启被拒绝） |
| `UNLOADING` | 依赖被移除、正在清理：`_unload` 运行期（`fiber.ts:675-686`，`Promise.all(clear...)` 逆序执行 disposer）；这是**过渡态**——清理完回落到 PENDING（若依赖可能恢复），父纤维销毁则终态 DISPOSED |

**记忆锚点**：PENDING/LOADING/ACTIVE 是"向上的楼梯"（依赖逐步齐备）；FAILED/DISPOSED 是"不可用"的两个终态；UNLOADING 是"正在退场"的过渡态（`fiber.ts:142-144` 的注释顺序：PENDING waiting、LOADING running、ACTIVE loaded、FAILED threw、UNLOADING disposers running、DISPOSED uid cleared）。

**2. `await a.dispose()` 期间，消费方纤维什么字段最先变化、由谁触发？**

**最先变化的是消费方纤维的 `_runner.epoch`**（不是 `state`，也不是 `store`）。完整时序（按源码逐段推演）：

1. 你（主插件）显式 `await a.dispose()`（3.8 示例的 `setTimeout` 里）。dispose 本体是 `parent.fiber.effect(...)` 登记的 disposer（`fiber.ts:265-297`）：先 `this.uid = null`（`:268`——**发起方** A 的 uid 置空），再 `_setEpoch(INACTIVE)`（`:276`）、`_unload`（`:281-284` 触发，状态置 UNLOADING）。
2. A 的纤维 effect 栈**逆序**清空（`fiber.ts:431` `disposables.splice(0).reverse()`）：写到 `cleanup B → provide 的 disposer → cleanup A` 的顺序（3.8 节"卸载顺序是 B → 消费方 → A"）。
3. `provide` 的 disposer 运行（`vendor/cordis/src/reflect.ts:297-303`）：`:298` `delete this.store[key]`（A 的 store 里删除 counter），`:299` `notify(['counter'])`——**触发者就是 A 的 provide disposer**，而它是由 `a.dispose()` 引发的 effect 逆序清理执行的。
4. `notify`（`reflect.ts:314-336`）遍历 `runtime.fibers` 里所有依赖该名字的纤维（`:317`）：对消费方 B 调用 `fiber._checkImpl('counter')`（`reflect.ts:323` → `fiber.ts:597-609`：strict 模式经 `_getImpl` 发现提供方已非 ACTIVE/不存在，`reflect.ts:241`，检查失败）。
5. `_refresh`（`reflect.ts:326` → `fiber.ts:611-623`）：**`:617` 把 `this._runner.epoch` 置为 `INACTIVE`——这就是消费方字段的"最先变化"**；随后 `_setEpoch(INACTIVE)`（`fiber.ts:625-639`）驱动状态迁移：进入 `_unload`（`:675-686`，`:676` `Promise.all(clear...)` 逆序清自己的 disposer）、`_updateState` 把 `state` 置 `UNLOADING`（`fiber.ts:581-595`），卸载完成后回落 PENDING（3.8 的实测：`consumer fiber state: 0 = PENDING`）。

**一句话回答**：最先变的是消费方 `_runner.epoch`（变 `INACTIVE`）；**触发者**不是消费方自己，而是"A 的 `dispose()` 逆序清理时执行的 provide disposer 里的 `notify`"——消费方只是被 notify 叫醒的观察者（`reflect.ts:299`）。`store` 的清理发生在消费方自己的 `_unload` 阶段（`fiber.ts:686`），比 epoch 更晚。

### 应用层

**3. A 提供 x、B 注入 x 与 y、C 注入 y：初态 → 卸载 A 的 epoch 变化与终态**

假设挂载顺序 A、B、C，且按 `registry.counter`（`vendor/cordis/src/registry.ts:207-209`）分配的 uid 为 **A=1、B=2、C=3**（每个新纤维 uid 递增）；epoch 用 `:uid` 记号表示"当前可见的依赖提供方"，缺依赖时为 `INACTIVE`（`fiber.ts:176`、`:617`；epoch 在 `fiber.ts:620` 按 `':' + impl.fiber.uid` 逐个拼接）。

**初态**（挂载 A、B、C 后）：

| 纤维 | 注入 | epoch | 状态 | 说明 |
|---|---|---|---|---|
| A(1) | 无 | `''` | ACTIVE | 无依赖，`_getState`: `epoch= '' ≠ INACTIVE` → ACTIVE（`fiber.ts:577`） |
| B(2) | x, y | `INACTIVE` | PENDING | `_checkImpl(x)` 命中 `:1`，但 `_checkImpl(y)` 无提供方 → 失败 → `_refresh` 置 INACTIVE（`:617`） |
| C(3) | y | `INACTIVE` | PENDING | `_checkImpl(y)` 失败 → PENDING |

**卸载 A（`await a.dispose()`）之后**：

| 纤维 | epoch 变化过程 | 终态 |
|---|---|---|
| A(1) | `uid = null`（`fiber.ts:268`）→ 不再可重启 | **DISPOSED** |
| B(2) | A 的 provide disposer 触发 `notify(['x','y'])`（`reflect.ts:299`）→ `_checkImpl('x')` 发现 store 已无 x（`reflect.ts:298` 已 delete），`_checkImpl` 再次失败 → `_refresh` 仍置 `INACTIVE`（`:617`）；y 本来就缺，无变化 | **PENDING**（和初态"同为 PENDING"，但驱动原因是 x 也没了；若在 `_unload` 途中可观察到瞬态 UNLOADING，`fiber.ts:675-686`） |
| C(3) | 不受影响：A 不提供 y，notify 不含 y 的依赖者；C 的 epoch 本来就是 `INACTIVE` | **PENDING** |

**补充情形（若还有 D(uid 4) 提供 y）**：初态 B = `:1:4`、ACTIVE；C = `:4`、ACTIVE。卸载 A 后：B 被 notify 重算，`:1` 消失 → epoch 变 `INACTIVE` → `_setEpoch` 驱动 `_unload`（`:675-686`；卸载中若依赖恢复会再 `_reload`，`:688-694`）→ 瞬态 `UNLOADING` → 因 y 仍在（D 活着）而 B 的 x 缺失，回落 **PENDING**；C 的 epoch 保持 `:4`、**ACTIVE** 不变。这一情形更完整地展示了"epoch = 可见提供方 uid 集合"的语义。

**要点**：卸载 A 并不会"立刻"把 B 置 DISPOSED——只有**父纤维销毁**（uid 置 null，`fiber.ts:268`）才是终态；依赖被卸载只是让消费方"回到 PENDING 等房"（3.8 节第 4 点：卸载后是 PENDING 而不是 DISPOSED）。

**4. 3.8 示例交换 `ctx.on` 与 `ctx.effect` 登记顺序后的输出差异**

3.8 示例的 consumer（原顺序）：

```ts
apply(ctx: Context) {
  console.log('[consumer] apply begin, counter.value =', ctx.counter.value)
  ctx.on('demo/tick', () => console.log('[consumer] demo/tick received'))   // 先 on
  ctx.effect(() => () => console.log('[consumer] cleanup effect'))          // 后 effect
}
```

**交换后**（先 effect 后 on）：

**结论先行：`--- 2. consumer after provider gone ---` 之后的所有输出与交换前完全相同**——`ctx.emit('demo/tick')` 依然**没有输出**，`consumer fiber state` 依然是 `0 = PENDING`。

为什么"看起来没变"：

- 交换只改变消费方纤维 `_disposables` 的登记顺序：原序 `[on, effect]`，交换后 `[effect, on]`。卸载时 `DisposableList.clear()` **逆序**执行（`fiber.ts:431` `splice(0).reverse()`；`utils.ts:27-31`），所以原序清理为 `[effect, on]`（先运行 cleanup effect，再卸载 on），交换后清理为 `[on, effect]`（先卸载 on，再运行 cleanup）。
- `ctx.on` 的卸载是 **unregister**：从钩子表删除监听器（`events.ts:254-260` register 返回 `() => this.unregister(...)`；`unregister` 在 `events.ts:269-275`），**没有任何打印**。所以两种顺序下，`--- 2. ---` 后 `demo/tick` 的监听器都已被移除（监听器随着 fiber 卸载自动注销，`events.ts:254-260`——这正是否定"幽灵监听器"的机制），emit 均无输出；state 均由 epoch 决定，与登记顺序无关，都是 PENDING。
- 唯一真正改变的是**内部执行次序**：原序下 `[consumer] cleanup effect` 打印**先于** on 的注销；交换后 on 的注销**先于** `[consumer] cleanup effect` 打印。因为 unregister 静默、cleanup 只有一行，输出文本恰好不变。

**一个能区分差异的反事实场景**：若 consumer 的 cleanup effect 自己再 `ctx.emit('demo/tick')`：

- 原序（cleanup 先跑、on 还挂着）→ 监听器**仍在**，输出 `[consumer] demo/tick received`；
- 交换后（on 先被注销、cleanup 后跑）→ 监听器**已不在**，无输出。

这条差异源于教材 3.8 强调的"**卸载是逆序的，且顺序由登记顺序决定**"：多个 disposer 的清理是**并发**推进的（`fiber.ts:676` `Promise.all(clear().map(...))`），若要保证"A 必须在 B 之后清理"这种严格次序，必须把它们**合并进同一个 disposer**（`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:94` 附近的建议）。

### 综合层

**5. 论证"不卸载 B 时 A 的悬空行为"**

前提：A 提供 `counter` 服务、B 在 `apply` 里 `const counter = ctx.counter` **持有引用**；A 的 fiber 被 dispose 但**它的 provide disposer 未运行**（例如绕过了 `fiber.dispose()` 的正常路径，或 provide disposer 中途抛错）。

**B 的 `ctx.counter.bump()` 会发生什么**：**调用照样"成功"，但操作的是一个死物**。逐条对照源码：

- `ctx.counter.bump()` 先走 `ctx.counter` 的属性读取：Proxy 六分支的爬链（`vendor/cordis/src/reflect.ts:153-167`），从 B 纤维出发沿父链 `:157 impl = fiber.store?.[prop]`——A 的 `store['counter']` **还在**（provide disposer 没跑，`:298` 的 `delete this.store[key]` 没执行），所以**命中残留的 impl**，返回的是已经 DISPOSED 的 A 的实例。
- 因此 `bump()` 执行成功、计数增加——但这是"幽灵数据"：A 已经死亡，没有任何机制知道这个计数。同时带来第二个恶果：**新的 counter 提供方无法注册**（`reflect.ts:289-290` 查重：`this.store[key]` 仍被残留 impl 占据 → `service "counter" has been registered at <A>`），服务被"僵尸"占位，无法顶替。
- 对照两个"防线"为什么失效：
  - **strict 过滤**（`reflect.ts:241`：`if (strict && impl.fiber.state !== FiberState.ACTIVE) return`）只作用于 `_getImpl`——即 `ctx.get('counter')` 与 `_checkImpl` 的解析路径（`reflect.ts:237-243`）；**`ctx.counter` 的爬链分支不经过 `_getImpl`**，所以 strict 管不到这条路径。注意 B 一开始就把引用存进局部变量，即使 strict 也难以追溯。
  - **uid 置空**（`fiber.ts:268` `this.uid = null`）只影响 A 自身的状态推导（`uid === null → DISPOSED`，`fiber.ts:575`）与"不可重启"，它**不会清理 A 的 store**。也就是说 uid 置空是"宣告死亡"，真清理靠的是 disposer。

**两种修复方案**：

- **框架级**：保证"dispose 必然运行 disposer"这一闭环不可绕过——所有清理必须经 `fiber.dispose()`（`fiber.ts:265-297` 的 effect disposer 链），禁止绕过 effect 栈直接操作 store；本仓库的本地修改 #6 已加固了"UNLOADING 状态拒绝新增 effect"（`fiber.ts:420-422` 抛 `INACTIVE_EFFECT`），可再进一步：provide 的 disposer 本身要"先置状态再清 store、绝不让异常中断 notify"（对照 `reflect.ts:297-303` 的顺序）。框架职责是让**"卸载即注销"成为不变量**。
- **插件级**（消费方自救）：B **不要缓存服务实例**，改为每次 `ctx.get('counter')`（走 `_getImpl`，**strict 会过滤非 ACTIVE 的提供方**，`reflect.ts:241`，死实现不可见）或声明式 `inject: ['counter']`（`registry.ts:300-302` 的语法糖，依赖变化时 B 被自动卸载/重载，`fiber.ts:611-639`）。如果实在要缓存，也要接受"缓存可能过期"并配合 `ctx.get` 的 strict 语义做二次校验。

**一句话**：悬空的根源是"读到了不该读的残留 store 项"；strict 只挡 `_getImpl` 路径，uid 置空只宣告死亡，两者都不清理 store——修复必须落在"让 disposer 必然运行"（框架）或"走 strict 解析"（插件）上。

**6. 为什么 `runtime.fibers` 用 `DisposableList` 而不是数组**

`DisposableList` 的实现（`vendor/cordis/src/utils.ts:14-31`）本质是 **Map + WeakMap** 的双表结构，三个关键操作与数组对比：

| 操作 | `DisposableList` | 数组 |
|---|---|---|
| `push`（`:14-19`） | **O(1)**：Map 追加 + 返回**删除器**（删除器幂等、可安全二次调用） | push O(1)，但删除要 `splice` |
| `delete`（`:21-25`） | **O(1)**：`Map.delete`，且删除器可交给外部（如 fiber 的 disposer），无需知道索引 | `splice` **O(n)**：先 `indexOf` 再搬移元素；索引在迭代中还会漂移 |
| `clear`（`:27-31`） | 返回**逆序数组**（`.reverse()`），与 fiber 卸载的"后注册先清理"语义严格对应（`fiber.ts:431` 同样逆序） | `forEach`/`map` 按插入序，需要额外 DIY `reverse` |

应用到 `runtime.fibers`（`registry.ts:322-328` 的 runtime 复用：`fibers: new DisposableList()`）的场景：

1. **O(1) 删除**：每个 fiber 的 disposer 都要把自己从 `runtime.fibers` 移除（`fiber.ts:266-269`：`const remove = runtime.fibers.push(this)`，dispose 时 `remove()`）。纤维频繁挂卸（HMR、配置热更新）时，数组的 O(n) splice 会让"每卸载一个插件"变成 O(n) 扫描。
2. **clear 逆序**：HMR 批量卸载时 `runtime.fibers` 的遍历清理必须按**逆序**（后挂先卸），`DisposableList.clear()` 直接给出逆序数组（`:27-31`），与 fiber 语义对齐；数组要自己反转。
3. **迭代稳定**：`notify` 会**反复遍历** `runtime.fibers`（`reflect.ts:317`：`for (const fiber of runtime.fibers)`）来通知依赖者；Map 按插入序迭代，遍历期间即使有增删（某个被通知的纤维在回调里注册/卸载新插件）也不会跳过或重复元素；数组在遍历中 `splice` 会导致索引跳跃、漏掉元素。

**一句话**：`runtime.fibers` 是"**高频增删 + 频繁全量遍历**"的全局注册表，`DisposableList` 的 O(1) 删除、逆序 clear、稳定迭代正好对应纤维生命周期的三个需求；数组的 `splice` 在三个维度上都更差。

### 挑战层

**7. 设计"可热替换"插件：A→A′ 时 B 不感知但立刻用新实例**

**需求分解**：① B 不得依赖 A 的具体类型（"不感知"= 接口契约层面）；② A′ 挂载后 B **立刻**用新实例（机制层面，而非 B 自己写轮询/重试）。

**方案**（三段构成）：

1. **B 只依赖名字契约**：B 写 `inject: ['counter']`（声明式，`registry.ts:300-302` 语法糖）或在 `apply` 里每次 `ctx.get('counter')`，绝不 `import` A 的类、绝不缓存实例引用——B 的源码只认识"`counter` 这个服务名"（第 2 章 Q1 的酒店类比：报需求不报房号）。
2. **A/A′ 提供同名服务**：两者都以 `'counter'` 为名注册，实现互不相同（实现类可以完全改变，只要满足接口）。替换的时序要遵守机制：**先卸 A、再挂 A′**（或 A′ 在另一 isolate 作用域下就绪，`context.ts:110-126`，再切换）；卸载 A 时保持"先卸后挂"可避免同名查重冲突（`reflect.ts:289-290`）。
3. **一致性由 epoch/notify 机制保证**：这就是"B 立刻用新实例"的来源，不需要 B 写任何代码——

**论证（结合 provide/notify/uid 语义）**：

- 挂载 A′ 时新纤维获得**新 uid**（每个新纤维 `parent.registry.counter` 递增，`fiber.ts:235`；uid 是"提供方实例身份"的标识）。
- `provide` 完成入册后 `notify`（`reflect.ts:295`）；`notify`（`:314-336`）遍历 `runtime.fibers`，对每个注入 `counter` 的纤维重跑 `_checkImpl`（`:323`）→ `_refresh`（`:326`，`fiber.ts:611-623`）→ B 的 epoch 从 `:N`（旧 A）变成 `:N+1`（新 A′），`_setEpoch` 检测到 epoch 变化（`fiber.ts:625-639`）。
- epoch 变化 ⇒ B 被**卸载/重载**（`fiber.ts:646-673` `_reload`：`:676` 清旧、`:686` 置空 store、重载后 `apply` 重跑）：B 重载后第一次 `ctx.counter` 读取，strict 解析（`reflect.ts:241`）只会看到 ACTIVE 的 A′——**新实例在 B 的下一次 apply 中就位**，且 B 的代码毫无改动。

**为什么"B 不重启"不可能**（3.6 节推论的正面运用）：教材 3.6 的推论是"**提供方实例即身份：提供方实例变更 ⇒ epoch 变更 ⇒ 消费方连带卸载/重载**"。B 的注入解析结果（服务实例）缓存在 B 的 `store` 与 `epoch` 里；如果 B 不重载，它的解析结果仍指向旧 A（要么悬空、要么陈旧），机制上没有任何途径让"同一个 B"平滑换用新实例——Cordis 的可逆副作用模型把"换实现"定义为"卸载旧的、装载新的"，消费方**必然**被波及（这正是 3.5 的"注册即 effect"：B 对 counter 的依赖本身就是 B 的一个 effect，effect 的语义就是"依赖变了，从头来过"）。

**因此精确表述是**：B "不感知"只可能指**接口不变**（B 不知道、也不需要知道 A′ 的类型），而"**B 的重载**"是机制强制、B 无法也不应避免的。任何宣称"B 进程/纤维零重启完成热替换"的设计，在 Cordis 模型下都违背 3.6 推论——如果想真的让 B 完全不重载，只能把"新实例"留在同一个提供方纤维内部（例如 A 服务对象自身做成可变的、由配置驱动的适配器），那就不是"替换插件"而是"替换配置"了。

---

## 第 4 章 事件即扩展点——五种分发模式

### 基础

**1. `isBailed` 边界判定**

定义（`vendor/cordis/src/events.ts:13-15`）：

```ts
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}
```

**它不是 truthy 判断**：只有三个值"不短路"——`null`、`false`、`undefined`；其余**全部短路**。逐项判定：

| 返回值 | `isBailed` | 是否短路 |
|---|---|---|
| `0` | `0 !== null/false/undefined` 为 true | **是**（与直觉相反；4.6 节坑 1） |
| `''` | true | **是** |
| `NaN` | `NaN !== null` 等均为 true（NaN 与任何值不等） | **是** |
| `null` | false | 否，继续叫下一位 |
| `false` | false | 否 |
| `undefined` | false | 否 |
| `Promise.resolve()` | **作为值本身是"非空对象"，`isBailed` 判定为 true**；但**在 `serial` 分发路径上会被 `await` 解包**（`events.ts:206` `await cb(...)` 后再判 `:207`），解包后的 `undefined` 不短路 | **serial 下：不短路**；若被直接塞给 `isBailed`（如 `bail` 的同步循环，`events.ts:217-222`）：短路 |
| `{}` | 非空对象 | **是**（任意对象都短路） |

**两个容易踩的边界**（正文 4.6 两坑的对应）：`bail` 模式永不返回 Promise（同步拿到 Promise 对象即判胜出）；`serial` 模式"不反对"请**不写 `return`**（返回 `undefined` 才继续）——这正是 `agent/turn-stopping` 声明为 `Promise<void> | void`（`packages/core/agent/src/runtime-types.ts:278`）的原因。

**2. `dispatch()` 的五步流程与三个量的角色**

`vendor/cordis/src/events.ts:165-175`：

```ts
dispatch(type, args) {
  const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null  // ①
  const name: string = args.shift()                                                                   // ②
  if (!name.startsWith('internal/')) this.emit('internal/dispatch', type, name, args, thisArg)        // ③
  const filter = thisArg?.[Context.filter]                                                             // ④
  return (this._hooks[name] || [])
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))                          // ⑤
    .map(hook => hook.callback.bind(thisArg))
}
```

五步：

1. **提取 `thisArg`**（`:166`）：第一个参数若是对象/函数，作为"事件载体"（发布者），`args.shift()` 拿走它；否则为 `null`。
2. **取出事件名**（`:167`）：`args.shift()`，剩余参数就是监听器实参。
3. **`internal/` 前缀特判**（`:168-170`）：非内部事件要发一条 `internal/dispatch` 观察事件（供诊断/跟踪）。
4. **取载体过滤器**（`:171`）：`thisArg?.[Context.filter]`——载体（作用域 Scoped 对象）上挂的过滤谓词。
5. **过滤 + 绑定**（`:172-174`）：保留 `hook.global` 为真、或没有过滤器、或 `filter.call(thisArg, hook.ctx)` 返回真的监听器；返回**绑定到 `thisArg`** 的回调数组。

三个量的角色：

- **`hook.global`**：监听器注册时的"全局"标记（`events.ts:112-117` 的 `EventOptions.global`）——置真则**无条件进入回调集**，跳过一切作用域过滤（`:173` 的第一项 `hook.global || ...`）。典型用途：`internal/update` 全局分发器等系统级监听器（`events.ts:155` 注册时 `{ global: true }`）。
- **`Context.filter`**：**载体侧**的作用域谓词——由 Scoped 载体（如 `packages/core/scope/src/index.ts:170-183` 的 `scopeTarget`，携带"事件只向上流"的 `scopeParents` 祖先回溯逻辑）提供；`filter.call(thisArg, hook.ctx)` 以**发布者**为 `this`、以**监听器注册时的 context** 为参数，判定"这个监听器是否该收到本次事件"。
- **`hook.ctx`**：监听器注册时的 context（`events.ts:257` 存进 hook：`{ ctx: this.ctx, callback, ...options }`）——是过滤判定的**输入**（作用域比较的一侧），也是 `filter` 判断"监听器属于哪个作用域"的依据。

一句话：`hook.global` 决定"跳过过滤"；`Context.filter` 是过滤**规则**（载体提供）；`hook.ctx` 是规则要比较的**被检方**（监听器归属）。

**3. `once` 首次调用发生了什么、为何不需要手动 `dispose`**

`vendor/cordis/src/events.ts:312-318`：

```ts
once(name, listener, options?) {
  const dispose = this.on(name, function (...args) {
    dispose()                                // :314 先自我移除
    return listener.apply(this, args)        // :315 再转发
  }, options)
  return dispose
}
```

- **首次调用**：`once` 注册的**包装函数**先执行 `dispose()`——即立即注销自己（`unregister`，`events.ts:269-275`，从钩子表移除）——然后才把实参转发给真正的 `listener`。因此监听器**至多被调用一次**；若它不再被调用（事件从未发生），包装函数一直留着，直到 fiber 卸载。
- **为什么不需要调用方手动 `dispose`**：`once` 内部走的是 `on` → `register`（`events.ts:254-260`），而 `register` 的返回值被挂进 `ctx.fiber.effect`（`:256`）——**监听器本身就是当前 fiber 的一个 effect**（第 3 章 3.5"注册即 effect"）。即使 `once` 的自我移除没发生（监听器永远没被触发），fiber 卸载时 effect 栈逆序清理也会把监听器从钩子表摘掉（`events.ts:258` 的 `unregister` disposer；`fiber.ts:431` 逆序执行）。`once` 的 `dispose()` 只是**提前**注销，兜底始终是"注册即 effect"机制，所以调用方无需也不应手动清理。

### 进阶

**4. 三个监听器（同步抛错 / 返回被拒 Promise / 正常返回）在 emit / parallel / serial 下分别发生什么**

设 L1 同步抛错、L2 返回 `Promise.reject(e)`、L3 正常返回。三种分发（`vendor/cordis/src/events.ts`）：

**`emit`（`:194-196`：`this.dispatch('emit', args).map(cb => cb(...args))`）**——同步 map、不等待：

- L1 同步抛错 → `map` 回调内抛异常 → **迭代中断**：L2、L3 都**不会执行**；异常同步传播给 `emit` 的调用方。
- （如果 L1 不抛，L2 的 rejected Promise 会被 `map` 丢弃——返回的 promise 没人看，变成 unhandled rejection；L3 正常。）

**`parallel`（`:183-187`）**：

```ts
const results = await Promise.allSettled(this.dispatch('emit', args).map(async cb => cb(...args)))
```

- 注意 `map` 的回调是 **`async` 函数**：L1 的同步抛错被**包进 rejected promise**，不会中断 `map`——**三个监听器全部执行**。
- `Promise.allSettled` 收集：L1 → `rejected`（同步抛错）、L2 → `rejected`（被拒 Promise）、L3 → `fulfilled`（正常值）。
- `:186-187`：只要存在 rejected，就 `throw new AggregateError(所有 reason)`——**L1、L2 的失败被聚合抛出**，L3 的正常返回值被忽略（`allSettled` 不取 fulfilled 值）。

**`serial`（`:204-209`）**：

```ts
for (const cb of this.dispatch('serial', args)) {
  const result = await cb(...args)
  if (isBailed(result)) return result
}
```

- L1 **同步抛错**：`await cb(...)` 处同步异常 → `serial` 返回的 promise **立即拒绝**，**L2、L3 不执行**。
- L1 返回**被拒 Promise**：`await` 抛错，同样中断（结论一致：L1 的失败是"致命"的，因为 serial 语义是顺序链）。
- L3 正常返回 `undefined`：`isBailed(undefined) = false`（`:207`、`:13-15`）→ 不短路 → 循环结束，`serial` resolve 为 `undefined`。

**对照表**：

| 分发 | L1 抛错 | L2 拒绝 | L3 正常 | 调用方得到 |
|---|---|---|---|---|
| `emit` | 中断，L2/L3 不执行 | （不执行） | （不执行） | 同步异常 |
| `parallel` | 收集为 rejected | 收集为 rejected | 执行，值被忽略 | `AggregateError`（全体拒绝原因） |
| `serial` | 拒绝串行链，L2 不执行 | （未执行） | （未执行） | promise 拒绝 |

**设计启示**：三种模式对"监听器出错"的容忍度不同——`parallel` 最宽容（人人执行、失败聚合），`serial` 最严厉（一个失败全链停），`emit` 最危险（一个同步抛错饿死后续监听器）——这正是第 4 章挑战 8 里 dsh 两处手动容错（tools/result 与 agent emit）的动机。

**5. 4.8 示例：`next` 每次调用后的 `cbs`/`order`，以及 L2 拦截版**

4.8 的监听器顺序：L1（`order.push('L1-前')` → `next()` → `order.push('L1-后')` → `return \`[${r}]\``）、L2（`push('L2')` → `next()` → `return \`${r} +L2\``）、L3（`push('L3')` → `next()` → `return \`${r} +L3\``）；默认行为 `() => '默认行为'`；调用 `ctx.waterfall('seal', '戊', () => '默认行为')`。

机制（`vendor/cordis/src/events.ts:234-243`）：`cbs = this.dispatch('waterfall', args)`（`:235`）；`inner = args.pop()`（`:236`，默认行为）；`next()` = `cbs.shift() ?? inner`（`:238`）并调用（`:239`）——**每次调用 `next()` 弹出一个监听器**。

**逐步推演**（`order` 变化、`cbs` 剩余、返回值流向）：

| 步骤 | `next()` 调用 | `cbs`（弹出后） | `order`（累计） | 返回值 |
|---|---|---|---|---|
| 初始 | — | `[L1, L2, L3]` | `[]` | — |
| ① | 第 1 次（外部） | `[L2, L3]` | `['L1-前']` | 进入 L1 |
| ② | 第 2 次（L1 内） | `[L3]` | `['L1-前', 'L2']` | 进入 L2 |
| ③ | 第 3 次（L2 内） | `[]` | `['L1-前', 'L2', 'L3']` | 进入 L3 |
| ④ | 第 4 次（L3 内） | `[]`（空，`?? inner`） | `['L1-前', 'L2', 'L3']` | `'默认行为'` 返回给 L3 |
| ⑤ | 返回 | — | `['L1-前', 'L2', 'L3', 'L1-后']` | L3 → `'默认行为 +L3'`；L2 → `'默认行为 +L3 +L2'`；L1 → `'[默认行为 +L3 +L2]'` |

**最终**：`order = ['L1-前', 'L2', 'L3', 'L1-后']`；`result = '[默认行为 +L3 +L2]'`。

**L2 改为不调 `next()` 直接 `return 'L2 拦截'`**：

- 步骤 ① 同上：L1 打印 `L1-前`、调 `next()` → L2。
- 步骤 ②：L2 打印 `'L2'` 后**直接返回**——不调 `next()`，链在此断裂：**L3、默认行为、L1-后 全部不执行**（"不听 `next()` 的后果"= 否决，正文 4.8 的推论）。
- `order = ['L1-前', 'L2']`；L2 的返回值 `'L2 拦截'` 向上给 L1，L1 套方括号：`result = '[L2 拦截]'`。

**两条规律**：① 最外层监听器先挂、最后返回（洋葱：L1 的"前"最早、"后"最晚）；② 任何一个"想改造参数再放行"的监听器，都必须 `const r = await/next(); return ...r 改造...` 的形式，否则就是拦截。

**6. 为什么 `agent/request` 必须用 waterfall 而不能用 serial**

先看两处源码语义：

- `packages/core/agent/src/runtime-types.ts:242-244`：`agent/request` 声明为 `@mode waterfall`，监听器签名 `(payload, next: () => Promise<LlmCallConfig>) => Promise<LlmCallConfig>`——即"**拿到当前配置，可替换后返回**"，`next()` 给的是"内层链最终会用的配置"。
- `packages/core/agent-loop/src/agent.ts:438-441`：实际分发点 `await this.dispatch.waterfall('agent/request', { turn, step, signal }, () => Promise.resolve(seedConfig))`（`:438` waterfall、`:439` 事件载荷、`:440` 最内层默认行为 `seedConfig`）——最内层就是 `seedConfig`（`:428` 由工具配置组装并冻结的默认调用配置），`:443-445` 随后校验 `proposedConfig.provider/model` 非空并用它发请求。

**为什么必须是 waterfall**：

1. **目标是"改写配置"，不是"表态/否决"**。`serial` 的语义是"按注册序表态，**遇非空值短路返回第一个 bail 值**"（`events.ts:204-209`——`await` 后 `isBailed` 即返回）。它适合"投票"（第一个反对者胜出，如 `turn-stopping`，`runtime-types.ts:266-278`），但不适合"代加工"：`serial` 监听器要么 `return` 一个值终结全链，要么 `return undefined` 放行——**无法表达"我先看看默认配置再改它"**，因为默认配置在 `serial` 里根本不传递给监听器。
2. **waterfall 的 `next` 闭包给了"洋葱式"改造**（`events.ts:234-243`）：监听器先 `await next()` 拿到**整条内层链的结果**（最内层是 `seedConfig`，`agent.ts:440`），再基于它返回替换/增强后的配置——"**改写配置**"语义天然成立：任何一层都可以"先取默认（或下层结果）再决定"。
3. **multiple listeners 叠加**：`agent/request` 允许**多个监听器各改各的**（如 A 加 maxTokens、B 换 model），后注册的外层监听器基于内层结果继续包装；`serial` 一个 `return` 就短路，后续监听器根本没有机会参与——"短路"语义会把"配置流水线"变成"第一个拍板者赢"。
4. **失败语义**：题面提示"改写配置 vs 短路"——`serial` 的 bail 值被当作"决策结果"返回（`4.6` 节：只要非 `null/false/undefined` 就胜出），若监听器想"否决本次请求"，`serial` 无法区分"正常配置"与"否决信号"；waterfall 允许监听器**不调 `next` 直接抛错/返回替换件**，与"校验不通过就拒绝"的表达一致（`agent.ts:443-445` 的校验就是最后一道关）。

**结论**：`agent/request` 是"**冻结调用配置的决策点**"——需要"层层包装默认值"的水流语义（waterfall），若换成 serial，要么只能做"全有全无的拦截"（无法改造）、要么监听器返回一个配置对象却立刻短路后续监听器（配置半途而废），两种都破坏"分层改写 + 默认值兜底"的设计（默认 `seedConfig` 在 `agent.ts:440`，只有 waterfall 的 `inner` 机制能保证"没人监听时就是默认配置"）。

### 挑战

**7. `internal/update` 监听器为什么存 `fiber._hooks` 而不是全局 `_hooks`**

`vendor/cordis/src/events.ts:140-155` 有两段特判：

- `:141-144`（`internal/listener` 观察者）：当注册的事件名是 `internal/update` **且非 global** 时，监听器**不**进 `this._hooks`（全局表），而是进 **`this.fiber._hooks['internal/update']`**（`:142`，`??= new DisposableList()`；`:143` 按 `prepend` 选 unshift/push）——按**当前纤维**分桶。
- `:148-155`（`internal/update` 全局瀑布分发器，`global: true, prepend: true` 注册）：分发时取 `[...this._hooks['internal/update'] || []]`？不——`_next` 闭包遍历的正是**每个纤维的私有钩子**：纤维 `update()`（`fiber.ts:736-751`）把 `internal/update` 瀑布指向本纤维，私有表里的监听器作为 `internal/update` 钩子被依次重放（`fiber.ts:746` 的 `context.waterfall(this, 'internal/update', ...)`、`:749` 的默认行为 `restart()`），保证"每个纤维只收到自己注册的更新回调"。

**用第 3 章 fiber 生命周期解释"卸载后监听器消失"的意义**：

- `fiber._hooks` 是纤维私有字段（`fiber.ts:202` `public readonly _hooks: Dict<DisposableList<Function>>`），且里面的条目由 `DisposableList` 管理（`utils.ts:14-31`）——它**随纤维而生**。
- 纤维卸载时，`_disposables` 逆序清理（`fiber.ts:431`）会跑掉这些监听器的 unregister；即便没跑，纤维对象整体被丢弃，`fiber._hooks` 表随之**整体消失**——不存在"残留到全局表"的路径。
- **对照反事实（幽灵更新回调）**：若存放 `this._hooks`（全局），旧插件卸载后，它的 `internal/update` 监听器仍留在全局表里，每次 `update()`（HMR 热替换、配置变更，`fiber.ts:736-751`）都会**再次调用已销毁插件的回调**——回调里访问 `ctx`/服务只会命中死对象或抛出；这就是第 3 章 3.9 的"幽灵监听器"问题在 update 事件上的版本。
- **对热重载的意义**：热重载 = 旧纤维卸载 + 新纤维装载。私有表让"更新回调"与"纤维生命周期"**同生共死**：新插件装载后，`update()` 只会重放**当前活动纤维**的监听器；旧的回调随旧纤维消失，无需人工注销；同时按纤维分桶让 update 回调天然拥有纤维作用域（不同纤维可以有不同更新逻辑，`fiber.ts:736-751` 的 `update()` 正是逐纤维触发：`:746` 的 `internal/update` waterfall + `:749` 的默认行为 `restart()`）。

**一句话**：`fiber._hooks` 是"**以纤维为作用域 + 随纤维销毁**"的注册表；全局 `_hooks` 则违背"卸载即注销"（`events.ts:254-260`）原则，会让 HMR 后的旧回调变成幽灵——私有表是"可逆副作用"在 update 事件上的直接落实。

**8. 把 `tools/result` 与 agent `emit` 的手动容错换成 `ctx.emit` 后的行为回归**

两处现状（都是"**手动 for + try/catch + promise catch**"）：

- tools/result：`packages/core/tools/src/index.ts:1665-1675`——`notifyResult` 用 `this.ctx.events.dispatch('emit', [scopeTarget(...), 'tools/result', exec, result])` 拿回调数组（`:1665-1667`），然后 `for` 循环里 `try { callback(...); void Promise.resolve(returned).catch(reportFailure) } catch { reportFailure }`（`:1668-1675`）——每个观察者**独立隔离**同步异常与异步拒绝，并写 `logger.warn('tool "..." (...): tools/result observer failed: ...')`（`:1662-1664`）。
- agent emit：`packages/core/agent/src/dispatch.ts:120-137`——注释 `:116-119` 直接点明了 Cordis emit 的两个病："one synchronous throw starves later listeners, and returned promises are discarded"（一个同步抛错饿死后续监听器、返回的 promise 被丢弃）；它自己 `for` + `try/catch` + `Promise.resolve(...).catch(warn)`（`:121-136`）。

**换 `ctx.emit` 后的回归**（对照 `events.ts:194-196` 的语义——同步 `map`、不 await）：

- **回归一（同步抛错饿死后续观察者）**：`tools/result` 的回调集里若有观察者同步抛错，`map` 中断，**排在其后的观察者收不到事件**——工具结果的分发是"非否决性广播"（注释 `:1656`："without exposing a mutation or error channel into the outcome"），任何一个观察者的错误都不该影响其他观察者与工具执行结果；agent 的 `emit` 同理，`agent` 事件也是"non-vetoing"（`dispatch.ts:117-118`）。
- **回归二（异步拒绝无人处理）**：`ctx.emit` 的 `map` 丢弃返回的 promise（`:195`）——观察者返回的被拒 Promise 变成 **unhandled rejection**，既不写日志也无 `logger.warn` 诊断（现行实现分别有 `reportFailure`（tools:1671）与 `.catch`→`ctx.logger.warn`（dispatch:125-127））。排查成本极高的"静默失败"由此产生。
- **回归三（错误渠道丢失）**：现行两处都把失败归档到**日志**（`logger.warn`）；换 `ctx.emit` 后同步异常会直接**抛向调用方**——`notifyResult` 的调用点（`tools/src/index.ts:1644`）在工具执行流水线里，一个观察者抛错会让**工具执行本身**失败或中断后续流程；agent 的 `emit` 则可能把异常传给 `agentEvents` 的调用者，改变"事件不参与决策"的约定（`dispatch.ts:117` "Agent notifications are non-vetoing"）。

**一句话**：两处都是"**广播只许成功不许连坐**"的场景——`ctx.emit` 的"同步 map、不等待、不聚合"语义（`events.ts:194-196`）恰好缺这三样（隔离、诊断、不打断主体流程），所以 dsh 宁可绕过 `emit` 拿 `dispatch` 的回调数组自己循环。（可对照：**dsh 只重写 `emit`**；`parallel`/`serial`/`waterfall` 依然转发，`dispatch.ts:138-147`——因为后三者本身有聚合或顺序语义，不需要这种容错。）

**9. 设计"登录前校验"事件（`serial` 分发，第一个失败中断登录）**

**（a）声明事件**（与 dsh 的声明合并模式一致，`packages/core/agent/src/runtime-types.ts:146` 同款）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    // 返回非空对象 = 校验失败（中断登录）；返回 undefined/void = 通过，继续下一个校验
    'auth/login-check'(this: Context, credentials: { user: string; password: string }): Promise<{ ok: false; reason: string } | void>
  }
}
```

**（b）监听器**（注册到你的插件 `apply(ctx)` 里）：

```ts
ctx.on('auth/login-check', async (credentials) => {
  if (credentials.password !== 'secret') return { ok: false, reason: 'wrong password' }
  // 通过：不 return（等价 undefined）→ 不短路
})
ctx.on('auth/login-check', async (credentials) => {
  if (!(await twoFactorCode(credentials))) return { ok: false, reason: '2FA missing' }
})
```

**（c）登录入口用 `serial` 分发**（`vendor/cordis/src/events.ts:204-209`）：

```ts
const result = await ctx.serial(this, 'auth/login-check', credentials)
if (result) {                    // isBailed(result) === true（任意非 null/false/undefined 对象）
  throw new Error(result.reason) // 或返回登录失败；第一个失败即中断，后续校验不再执行
}
// 全部通过：登录继续
```

语义验证（`events.ts:204-209`）：`serial` 按注册序 `await` 每个监听器，`isBailed(result)`（`:207`）为真即 `return result`——第一个返回 `{ ok: false, ... }` 的监听器**使后续监听器不再执行**，且登录流程拿到非空对象就知道"被拦截"。返回 `undefined` 的监听器不短路，链继续——**"第一个校验失败使登录中断"成立**。

**（d）`isBailed` 边界验证**（4.6 节坑 1 的正面撞坑）：

- 若校验失败写成 `return 0`（"错误码 0"）：`isBailed(0)` 为**真**（`events.ts:13-15`：`0 !== null/false/undefined`）→ **误判为"失败并中断"**——而 `0` 在常见约定里常表示"成功码"！同理 `''`、`NaN`。这就是"错误码 `0` 导致误判"的直接答案：`isBailed` 不是 truthy 判断、也不是"错误码非零才失败"的判断，任何**非 `null`/`false`/`undefined`** 的值都会中断。
- **正确写法**：用**对象结果** `{ ok: false, reason }`（如上面的声明）或显式哨兵（`null`/`undefined` 表示放行）；即使要用数值码，也应把成功表达为 `undefined`（不 return），失败表达为能自带语义的值（对象/字符串），并**避免 `0`/`''`** 出现在"成功"位上。
- 另外注意**不要用 `bail` 分发**：登录校验是异步的（查库/查 2FA），`bail` 是同步循环（`events.ts:217-222`），监听器返回 Promise 会被立刻判为"胜出"，`Promise` 对象本身成了"校验结果"（4.6 节坑 2）——异步校验必须用 `serial`。

**（e）可选的扩展**：若要"多名校验者**都**执行、收集全部失败原因"，应改 `parallel`（`events.ts:183-187`）并自行检查 `AggregateError`；`serial` 的"首个失败即停"语义恰好匹配"登录这么敏感的操作，一旦失败立即拒绝"的需求。
## 第 5 章　cordis.yml 与 Loader：配置文件如何变成插件实例

### 理解

**1. `cordis.yml` 里一行的 `config` 与插件收到的 config 有什么不同？**

有三个层次的不同，前两个即提示的"插值与校验"：

1. **插值前 vs 插值后**。文件里 `config` 是 js-yaml 解析后的**字面值**；其中 `!!js` 表达式在解析阶段只变成一个包裹节点 `{ __jsExpr: 'process.cwd()' }`（`vendor/include/src/index.ts:9-15` 的 `JsExpr` 类型），**不会变成函数调用**。插件真正收到的 config，是 Loader 在 `internal/config` 这个 waterfall 事件（`vendor/loader/src/index.ts:92-101`）上、**用该 Entry 自己的上下文**把每一个 `__jsExpr` 节点求值后的结果——所以 `process.env.DEMO_GREETING`、`dshHomePath` 这类名字解析到的是**这一行**所在作用域里的值。
2. **校验前 vs 校验后**。求值之后，fiber 的 `_resolveConfig` 才调用 `resolveConfig`：`runtime.Config['~standard'].validate(config)`（`vendor/cordis/src/fiber.ts:641-644`、`packages/core/../../vendor/cordis/src/fiber.ts:50-62`，即 `vendor/cordis/src/fiber.ts:50-62`）。schemastery 的 `~standard` 适配器把校验、**默认值补齐**与类型转换合并成一次 `Schema.resolve(value, this, {})[0]`（`vendor/schemastery/src/index.ts:275-292`）。因此文件里可以缺省 `greeting`（5.6 实验里没写），插件收到的却必然是"完整且已校验"的 config；校验失败则在**启动期**抛 `ValidationError`（`vendor/cordis/src/fiber.ts:19-36`），而不是运行时才炸。
3. **顺序是硬约定**：先插值、后校验（`_resolveConfig` 先走 `internal/config` waterfall 再 `resolveConfig`，`vendor/cordis/src/fiber.ts:641-644`）。反过来（先校验后插值）schema 会对着 `{ __jsExpr }` 对象报"类型错误"。

另外两个边界（正文 5.3 讲过）：
- `disabled` 字段**不参与** config 插值，而是每次**挂载决策时**用 Entry 自己的 ctx 求值（`vendor/loader/src/config/entry.ts:104-108` 的 `disabledOf`）；
- 树载体（Group / Include）的 `config` 是"别的行的列表"，**保持字面**不求值（`vendor/loader/src/index.ts:98-100`；Include 标 `EntryGroup.key`，`vendor/include/src/index.ts:182`）——否则会把子行的 `!!js` 提前烤死。

**2. 为什么"插入行立即建索引"是第 6 章多层补丁（bundle 层 + 用户层）能工作的前提？**

第 6 章的多层补丁在代码里的形态是**单次拍平**：`composeEntries` 把各层补丁 `layers.flat()` 成一个大列表，然后**一次**调用 `applyEntryPatches([], …)`（`packages/boot/app-boot/src/profile.ts:413-420`）。也就是说，bundle 层的 insert 与用户层的覆盖/禁用处于**同一次调用、同一张 `entryMap` 索引**——"跨层命中"在实现上退化为"同一列表里后面的 patch 命中前面的 insert"。

`applyEntryPatches` 的索引是**一次性建立**的（`buildMap(data)`，遍历输入时的行），如果插入行不即时进索引，那么：

- bundle 层 insert 的行（base 的 78 条、web-app 的 50 条插入）在用户层 patch 循环开始时**不在 `entryMap` 里**；
- 用户层按 id 覆盖/禁用它们 → 走"找不到"分支 → 只 `warn('patch: entry %C not found')` 后跳过（`vendor/include/src/index.ts:110-112`）；
- 后果就是注释说的 **"inserted rows were silently unpatchable"**（插入的行静默不可补丁，`vendor/include/src/index.ts:96-101`）——bundle 层的行从此既不能被用户层的下一个 patch 覆盖，也不能被禁用，补丁栈分层就失去了意义。

所以 dsh 特意修复了上游行为：`buildMap(insert)` 在每一条 insert 之后**立即**把插入行放进索引（`vendor/include/src/index.ts:95-101`），并作为 vendor README 本地修改第 11 条记录。一句话：**没有即时索引，插入行就"不可寻址"，后一层（＝同一列表的后段）就永远失去对它们的控制权**。

### 应用

**3. 为 greeter 写一份 patch，并解释为什么原来 `tree.yml` 里的 `targets` 完全消失。**

```yaml
- id: greeter
  config:
    greeting: '你好'
    targets: ['我指定的值', '第二个值']
```

配套目标清单 `tree.yml`（同 5.6 实验）：

```yaml
- id: greeter
  name: './greeter.ts'
  config:
    targets: ['from-tree']
```

**为什么 `targets: ['from-tree']` 完全消失**：`applyEntryPatches` 的覆盖分支是**整键赋值**——`for (const [key, value] of Object.entries(overrides)) target[key] = value`（`vendor/include/src/index.ts:118-121`，`config` 只是其中一个键）。`target.config = 新对象` 直接把原对象引用换掉，**没有任何深合并**。所以 `['from-tree']` 不是"被覆盖了"，而是"旧对象整体不存在了"；新 config 里只有你写的两个字段。这正是 `packages/bundle/base/cordis.patch.yml:3-9` 头注释钉死的设计：patch 替换目标行的**整个** `config` 而不是合并进去，每行的最终状态 = 最后一个写它的层（last write wins per row）。

两个细节：
- 若你只写 `targets` 不写 `greeting`，`greeting` 同样消失，但 greeter 的 schema 有 `.default('Hello')`（5.6 的 `Config` 定义），`apply` 收到的仍是补齐后的完整 config——**整行替换 ≠ 配置不完整**，schema 兜底。
- `id` 不会被覆盖（`if (key === 'id') continue`，`vendor/include/src/index.ts:121`）；`name` 只用于校验、不参与赋值（`:116-119`）——所以覆盖时不需要重写 `name`。

**4. 把 `disabled: !!js process.platform === 'win32'` 改写为 `process.platform !== 'win32'`，语义反转后哪个平台会运行该行？**

- 原式：**Windows 上禁用**（`=== 'win32'` 在 win32 上为 true → disabled）——即该行在 POSIX（Linux/macOS）上运行、在 Windows 上不运行。
- 反式：`!== 'win32'` 在 POSIX 上为 true → 该行在 POSIX 上**禁用**，在 Windows 上 `false` → **启用**。即：**反转后只有 Windows 会运行该行、POSIX 反而禁用**。

到 `packages/bundle/base/cordis.patch.yml:178-186` 验证原意：`bash-sandbox`（`:178-182`，`disabled` 在 `:180`）与 `tool-bash`（`:210-212`，`disabled` 在 `:212`）用原式——bash 没有 Windows runner（`packages/bundle/base/README.md` 明说 "bash has no Windows runner"），所以 Windows 上必须禁用；它们的孪生行 `pwsh-sandbox`（`:184-186`，`disabled` 在 `:186`）与 `tool-pwsh`（`:214-216`，`disabled` 在 `:216`）用反式，**非 Windows 上禁用**。两者互补，保证"一份 patch 文件、每个宿主机恰好一个 shell 栈"。

如果对 `bash-sandbox` 做同样的反转：会得到一个"在 POSIX 上禁用 bash、在 Windows 上启用 bash"的**反向配方**——Windows 上启用一个没有 runner 的执行器，加载即失败；POSIX 上反而把唯一的 bash 执行器关掉。这从反面说明互补表达式是"按能力门控"而不是"按喜好门控"。

顺带记住机制：`disabled` 不是 config 插值，而是**每次挂载决策时**用 Entry 自己的 ctx 求值（`vendor/loader/src/config/entry.ts:104-108`），所以门控表达式可以安全出现在 patch 行的顶层，且不依赖插件上下文。

### 综合

**5. 设计一份 overlay：插入 `greeter-2` 且在同一份列表里再覆盖它的配置。**

```yaml
- id: inner
  name: '@deepseek-ai/cordis-plugin-include'
  config:
    path: './tree.yml'
    patches:
      # 补丁 1：插入
      - insert:
          - id: greeter-2
            name: './greeter.ts'
            config:
              targets: ['刚插入']
      # 补丁 2：命中补丁 1 刚插入的行
      - id: greeter-2
        config:
          greeting: '第二层'
          targets: ['后来居上']
```

（与 5.6 实验"补丁 2 + 补丁 3"完全相同；若愿意，也可以写成 `dsh --patch overlay.yml` 的独立文件形态——内联与文件最终汇入同一次 `applyEntryPatches`，见 5.4.4。）

**索引时序**（`vendor/include/src/index.ts:81-101`）：

1. `buildMap(data)` 先建索引：此时只有 `tree.yml` 里的 `greeter`，**没有** `greeter-2`；
2. 补丁 1（insert 无 id）：`data.push(...insert)` 追加到顶层，随后**立即** `buildMap(insert)`——`greeter-2` 此刻进入 `entryMap`；
3. 补丁 2：`entryMap.get('greeter-2')` 命中**同一条对象**（索引里存的就是插入时的引用），走整键覆盖分支，`target.config = { greeting: '第二层', targets: ['后来居上'] }`；
4. 最终树：顶层两行，`greeter`（若补丁 4 没禁用则保持 `你好, 内联补丁!`…）、`greeter-2` 输出 `第二层, 后来居上!`。

**边界推演**（验证你对时序的理解）：
- 若把补丁 2 挪到补丁 1 之前：`greeter-2` 不在索引 → 走 "patch: entry not found" 警告并跳过（`:110-112`）——插入行保留 `['刚插入']`，即"后来者"没有生效；
- 若想在同一份列表里对**同一 id** 再 insert 一次：不查重，树里会出现两行同 id 行（索引 Map 只保留后者），实际挂载时两个 Entry 都会创建——这是写 overlay 时要避免的；
- 注意"覆盖"发生在同一次 `applyEntryPatches` 调用内（同一次 `root.update(data)` 之前），所以**挂载侧永远看不到中间态**，看到的只有最终形态——这正是"确定性"的来源。

**6. 一个 patch 文件在 surface A 上正常、surface B 上"没有任何效果"——至少两种可能原因。**

"没有任何效果" = 要么没命中，要么命中但结果被别的东西抵消。按判定点（都在 `vendor/include/src/index.ts:81-128`）列举：

1. **目标行在 B 上不存在**（最可能）：B 的 bundle 层列表与 A 不同（比如 B 是只有 `dsh-base` 的 profile，而 A 还有 `dsh-web-app`），patch 的 `id` 在 B 的组合里没有对应行 → "patch: entry not found" 只警告、跳过（`:110-112`）。这是**设计内**行为：同一份 overlay 要跨多个 surface 复用，不该因某个 surface 缺行而崩（5.4.5）；也正因如此，"B 上没效果"在日志里只是一行 `warn`。
2. **`name` 校验失败**：patch 带了 `name` 且与 B 上目标行的 `name` 不符 → "patch: name mismatch … skipping"（`:116-119`）。典型场景：A/B 的同一 id 行由不同包实现（如 A 用 `dsh-bash-sandbox`、B 用自装执行器），或 id 被不同层复用。
3. **id 本身变了**：目标行**没有写 `id`**——`EntryGroup.create` 经 `tree.ensureId` 现场生成随机 8 位十六进制串（`vendor/loader/src/config/tree.ts:66-73`），每次重新读文件 id 都不同。同一份 overlay 在 A 上"运气好"命中（A 的那行恰好有稳定 id 或名字对上了），在 B 上遇到随机 id 行 → not found。
4. **目标行在 B 上被更早层禁用**：如 B 走平台门控把该行 `disabled: true`（`vendor/loader/src/config/entry.ts:84-98`），或某 bundle 层显式 disable 了它。patch 命中了（id 找得到、name 也匹配），但行本身"不运行"——**效果上**同样是无效果。这也是第 7 章 web-app 禁用 23 条模型面行后、用户层再 patch 它们时容易踩的坑。
5. **被更后层覆盖回去**：B 的补丁栈里，该 patch 之后还有别的层写同一行（后层胜，5.4.5 规则 2）——patch 生效了但被淹没，"看起来没效果"。

排障要点：`applyEntryPatches` 对"行对不上"一律**只 warn 不抛错**，所以"没效果"不会有任何进程级表现；对照 `dsh --profile B --dump-config` 的 `# == …patched by…` 注释（如能构建）或按 6.5 的定位方法数层，是最快的定位手段。

### 挑战

**7. 论证：如果 `applyEntryPatches` 不 clone 输入，热重载会如何破坏可回退性。**

`applyEntryPatches` 的第一行是 `data = structuredClone(data)`（`vendor/include/src/index.ts:64`），注释（`:43-52`）说得很直白："The input is never mutated and the result is always detached from it (even with no patches): patching or mounting shared entry objects would bake earlier values into the cached parse, so repeated application (config hot-reloads) could never revert a removed or changed patch."

**共享对象从哪来**。有两处"按引用共享"：

1. **`insert` 的行按引用进入结果**：`target.config.push(...insert)` / `data.push(...insert)`（`vendor/include/src/index.ts:82-96`）推进的是**patch 列表里的原对象**，不是克隆。其后任何按 id 命中该行的 patch（同一列表内或后续层）走整键覆盖 `target[key] = value`（`:118-121`）——**改的是 patch 列表对象本身**。
2. **`data` 在热重载之间是共享的**：Include 的 `read()` 对未变化的内容返回缓存的 `{ content, data }`（`vendor/include/src/index.ts:242-245` 的 `if (!forced && this.content === content) return`），即同一次会话内多次 `refresh` 拿到的是**同一个解析结果对象**。

**不 clone 的失效链**（以 6.6.1 / 6.7 的调用方视角）：

- 启动时：`boot` 把 `structuredClone(allPatches(composed))` 传给 `mountRootInclude`（`apps/cli/src/profile-boot.ts:246-247` 注释："include 会把 insert 的行**按引用**推进挂载树，后续按 id 命中并原地修改"）。假设这个 clone 不存在：用户层对某个 **bundle insert 行**的覆盖（如把 base 的 `tool-todo` 配置改掉）会直接写进 bundle 的 `insert` 数组对象；
- 热重载：`watchUserPatches` 触发时，`composeLive` 每次 `structuredClone([...])` 重新组装（`apps/cli/src/profile-boot.ts:240-245`，注释 `:235-239`："把用户覆盖烤进 bundle 插入行后，删掉覆盖就回不去了"）。假设这个 clone 也没有：下一次 `entry.update` 时"用户覆盖"已经**固化在 bundle 行的对象里**；
- 用户此时从 `cordis.patch.yml` **删除**那条覆盖 → 新组合里不再有该 patch → 但 bundle 的 insert 对象已被污染，`applyEntryPatches` 的覆盖分支不会再执行（没有 patch 命中它），**被污染的旧值原样保留**——"移除补丁无法恢复原值"；
- 同理 `data` 侧：若 `applyEntryPatches` 原地改 `data` 而不 clone，`read()` 缓存里那份解析结果就等于"被烤进了所有已应用的补丁"，下次 `refresh`（即使文件没变）再应用同一份 patches 时，行上已经叠加了上一轮修改——**补丁被反复叠加**，而不是可撤销。

**结论**：clone 是"可回退"的代价——它保证每次应用都从"补丁的原始形态 + 文件的原始解析"出发，任何一轮的原地修改最多影响**本轮的返回结果**，绝不污染下一轮的输入。这正是热重载能"改坏一次、回滚到最后一棵好树"（`vendor/include/src/index.ts:296-300`，第 6 章 6.7）的底层前提；5.4.2 注释里"即使没有 patch 也 clone"（`:64-65` 的 `if (!patches?.length) return` 之前）就是为了杜绝"有补丁和无补丁两条路径产生不同的共享语义"。

---

## 第 6 章　Profile 组装：从 `dsh` 命令到插件树

### 理解

**1. 画出补丁栈七层并标注每层的文件来源；哪两层没有独立文件、由什么派生？**

自上而下为应用顺序（**下层被上层覆盖**；同层内按数组顺序）：

| 层 | 名称 | 文件来源 / 派生方式 |
|---|---|---|
| 7 | telemetry 开关 | **无独立文件**。由 `DSH_TELEMETRY_DISABLED` 环境变量派生：`resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has('session-telemetry-otel'))`（`apps/cli/src/profile-boot.ts:80-83`、`:168-169`），非空值生成 `{ id: 'session-telemetry-otel', disabled: true }` |
| 6 | agent-presets 覆盖 | **无独立文件**。由 `composeProfile` 派生：组合里存在 `id: agent-presets` 的行时，追加一条覆盖 patch，把 `config.roots` 换成 `SHIPPED_PRESET_ROOT`（`apps/cli/src/profile-boot.ts:159-167`，根目录常量 `:35`） |
| 5 | `--patch <file>` | 命令行给的文件，argv 序；`patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))`（`apps/cli/src/profile-boot.ts:148`）；缺文件=抛错（必选语义） |
| 4 | home 层 | `$DSH_HOME/cordis.patch.yml`；`homePatchPath()`（`apps/cli/src/profile-boot.ts:49-51`）；缺文件=无层（可选语义） |
| 3 | profile 用户层 | `$DSH_HOME/profiles/<name>/cordis.patch.yml`（`loadProfile` 的 `options.userLayer !== false && existsSync(patchPath)` 分支，`packages/boot/app-boot/src/profile.ts:398-401`）；缺文件=无层 |
| 2 | bundle 层 2 | `@deepseek-ai/dsh-web-app` / `dsh-headless` 的 patch 文件——路径 = 该包 `package.json` 的 `dsh.bundle.patch`（`packages/boot/app-boot/src/profile.ts:388-397`）；`dsh.profile.bundles` 的第 2 个元素 |
| 1 | bundle 层 1 | `@deepseek-ai/dsh-base` 的 patch 文件（同解析方式）；`dsh.profile.bundles` 的第 1 个元素 |

**两层无独立文件：6（agent-presets）与 7（telemetry）**——都是 `composeProfile` 在内存里**派生**的补丁（`apps/cli/src/profile-boot.ts:159-169`），一个来自"组合里有没有 agent-presets 行"，一个来自环境变量。所以 6.5 的表特别提醒：`--dump-config` 的层序只到第 5 层（`apps/cli/src/dump-config.ts:32-48`），拿 dump 核对 6/7 层时要心里有数。

（补充：层 0"空根"不是补丁层而是基底——`<profile>/cordis.yml` 恒为 `[]`，见第 7 题。）

**2. 为什么 `--patch` 缺失文件会抛错，而 `$DSH_HOME/cordis.patch.yml` 缺失却静默通过？**

两个函数，两套语义（注意实核位置：两者都定义在 `packages/boot/app-boot/src/index.ts`）：

- `loadOptionalPatches(binName, file)`（`packages/boot/app-boot/src/index.ts:278-287`）：`readFileSync` 捕获 `ENOENT` 时**返回 `undefined`**——"文件不存在"被翻译成"**没有这一层**"。这正是 home 层想要的：`$DSH_HOME/cordis.patch.yml` 是机器级可选层，没写就是"没有偏好"。
- `loadOverlayPatches(binName, file)`（`packages/boot/app-boot/src/index.ts:298-306`）：文件不存在**直接 throw**（`failed to read overlay …`）——因为"调用者指名道姓给了这个文件"（`--patch ./x.yml`、bundle 的 `dsh.bundle.patch`），它的缺席是**配置错误**，不是"没有 overlay"（注释原文："its absence is a misconfiguration, not 'no overlay'"）。

一句话哲学（正文 6.3）：**"缺席"与"坏了"是两种病**——可选层缺了 = 没有这一层；指名层缺了 = 你写错了。除此之外两者**其余行为完全一致**：文件存在但读不了/解析失败（非数组、元素非 mapping），一律抛错（`parsePatchList`，`packages/boot/app-boot/src/index.ts:320-338`）。

### 应用

**3.（未验证：本机未构建 dsh，无法真机运行 `dsh --profile web --dump-config`）用 6.5 的定位方法，手工推出 web profile 会加载的行，并给三行注明来源层。**

推导方法：`$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` = 模板 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`（`packages/boot/app-boot/src/profile.ts:114-117`）；每层的 patch 文件经双锚解析到磁盘后按 `loadOverlayPatches` 读出；`layers` 的 `label` 是 `layer.packageName`（`apps/cli/src/dump-config.ts:33-36`），所以 dump 的 `# ==` 段首会写包名或 patch 文件**绝对路径**。三行示例（行号均为 base / web-app 的 patch 文件）：

1. **`timer`**（`packages/bundle/base/cordis.patch.yml:16-17`）——base 层 `insert:` 块的第一个条目。若用户层与 home 层没人动它，dump 里 origin 注释为 `# == @deepseek-ai/dsh-base`。
2. **`session-query-sqlite`**——base 层插入（`packages/bundle/base/cordis.patch.yml:115-121`，`path: ':memory:'`、`openAt: never`），web-app 层**重述**（`packages/bundle/web-app/cordis.patch.yml:30-33`，键值相同）。dump 的条目前注释会是 `# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app`——这正是 `renderConfigDump` 逐层快照 diff 的产物（`packages/boot/app-boot/src/index.ts:404-441`：内容变化的行把该层追加进 `patchedBy`），**它是验证"整行替换不合并"的现成证据**：web-app 必须把两份键全写出来。
3. **`webserver`**（`packages/bundle/web-app/cordis.patch.yml:110-115`）——web-app 层 `insert:` 加入的传输层行：`host: !!js ctx.webStartup.host ?? '127.0.0.1'`、`port: !!js ctx.webStartup.port ?? 3080`。origin 注释为 `# == @deepseek-ai/dsh-web-app`。

补充两条重要边界（已从源码确认）：
- dump 的层序 = bundle 层（按序）→ profile 用户层 → home 层 → `--patch`，**不含 agent-presets 与 telemetry 派生层**（`apps/cli/src/dump-config.ts:32-48`）；
- dump 打印的是**未求值**的 `!!js` 字面（dialect 为 `entryListSchema`，`packages/boot/app-boot/src/index.ts:393`），所以 `webserver` 的表达式原样出现在输出里，不会变成 `127.0.0.1`。

**4. 写 `$DSH_HOME/cordis.patch.yml` 禁用遥测，并叠加 `DSH_TELEMETRY_DISABLED=0`，解释谁生效。**

```yaml
# $DSH_HOME/cordis.patch.yml —— 机器级用户层，对所有 profile 生效
- id: session-telemetry-otel
  disabled: true
```

叠加 `DSH_TELEMETRY_DISABLED=0` 后，`composeProfile` 的第七步额外生成一条补丁：`resolveTelemetryPatch('0', rows.has('session-telemetry-otel'))` → `(('0' ?? '') === '')` 为 false → 返回 `{ id: 'session-telemetry-otel', disabled: true }`（`apps/cli/src/profile-boot.ts:80-83`），追加在 overlays 末尾。

**谁生效？两个都生效，且效果相同**——两条补丁都写成 `disabled: true`，对同一行做同样的整键覆盖，最终该行的 `disabled` 恒为 true（后层胜，但值一样，没有"谁压过谁"的问题）。真正值得解释的是 `'0'` 的含义：

- `resolveTelemetryPatch` 的判定是 `(disabledEnv ?? '') === ''`——**只有"未设置或空字符串"才不生成补丁**；`'0'`、`'false'`、`'no'` 乃至任意非空字符串（"ANY non-empty value"）都视同禁用（`apps/cli/src/profile-boot.ts:70-75` 注释："a privacy switch prefers off-by-mistake over on-by-mistake"——隐私开关宁错勿漏）。
- base 侧注释同款：`DSH_TELEMETRY_DISABLED` **任何非空值**——"any value, including '0'/'false' —— opts the process out"（`packages/bundle/base/cordis.patch.yml:129-133`），且"**config 不能禁用一行**"，禁用只能靠启动器加 patch（第 6.3 第 7 步的 telemetry 开关就是这么做的）。
- 所以 `'0'` 在此处的语义是"**禁用开关的值域里 0 不是 false**"——它作为环境变量"存在且非空"就触发禁用，不会像一般布尔约定那样把 `'0'` 解析成 false。

另外两层"保险"的设计意图：home 层写法是"人写的、可撤销的"（删掉那行即可恢复）；环境变量是"机器注入的、不可见但绝不误开"的兜底——两者叠加时，即使有人删了 home 层那行，环境变量仍保证进程不采集。

### 综合

**5. 在 `cordis.patch.yml` 里写错 `id`（目标行不存在）会怎样？写成非法 YAML（顶层不是数组）又会怎样？**

前提区分：写错 id 的是 **profile 层的 `cordis.patch.yml`**（`loadProfile` 里 `existsSync` 为真时经 `loadOverlayPatches` 读出，`packages/boot/app-boot/src/profile.ts:398-401`）；解析问题发生在 `parsePatchList`（`packages/boot/app-boot/src/index.ts:320-338`）。

- **错 id**：`parsePatchList` 只检查"顶层是数组、元素是 mapping"，id 合法性不归它管。随后 `composeEntries([bundlePatches, profile.patches, homePatches, overlays])` 调用 `applyEntryPatches`（`apps/cli/src/profile-boot.ts:151-153`）→ 目标缺失走 `warn('patch: entry %C not found', id)` 分支（`vendor/include/src/index.ts:110-112`）→ **只警告、跳过该条、启动继续**。挂载侧同样只打 warn（include 的 `applyPatches` 经 loader logger 转发，`vendor/include/src/index.ts:267-270`）。**结论：进程照常启动，日志里多一行警告。** 对应函数：`composeProfile`/`composeEntries`（预组合）与 `mountRootInclude`→`applyEntryPatches`（挂载）两处都会说一次。
- **非法 YAML（顶层不是数组）**：`parsePatchList` 的 `if (!Array.isArray(parsed))` 分支**直接抛错**（`packages/boot/app-boot/src/index.ts:329-331`，消息 `must be a top-level YAML array of loader patch entries`），错误沿 `loadOverlayPatches` → `loadProfile` → `prepareProfile` → `composeProfile` 向上传播 → **启动失败**（伴随 `boot` 失败路径的 `fiber.dispose` 回滚与带 cause 的诊断错误，`packages/boot/app-boot/src/index.ts:786-801`）。对应函数：`parsePatchList`（经 `loadOverlayPatches`）。

两者对照正是 5.4.5 / 5.7 的判定哲学：**"文件自身坏"是失败；"某一行对不上"是警告**。注意还有个微妙的中间层：patch 文件的某个元素不是 mapping，`parsePatchList` 也会抛错并点名第几个元素（`packages/boot/app-boot/src/index.ts:332-336`）。

**6.（未验证：需构建并运行 dsh；以下为源码推演）设计"最小 profile" `mini`，预测会挂载哪些基础服务。**

手工创建三个文件：
- `$DSH_HOME/profiles/mini/package.json`：`{ "name": "dsh-profile-mini", "private": true, "dependencies": {}, "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base"] } } }`；
- `$DSH_HOME/profiles/mini/cordis.patch.yml`：注释 + `[]`（或直接留空数组）；
- `$DSH_HOME/profiles/mini/cordis.yml`：`[]`（启动时 `prepareProfile` 会重写它，`apps/cli/src/profile-boot.ts:98-103`）。

启动路径：`loadProfile` 发现 `package.json` 存在 → 不触发模板初始化（`packages/boot/app-boot/src/profile.ts:376-384`）；`bundles` 只有一个 `@deepseek-ai/dsh-base`，经双锚解析（安装锚优先，`:344-355`）；其 `dsh.bundle.patch` 声明 `./cordis.patch.yml`（`packages/bundle/base/package.json:36-40`）。补丁栈 = base 78 条 +（空的）用户层 +（可能缺失的）home 层——**没有 web-app/headless 层**，因此组合里没有 `agent-presets` 行（`composeProfile` 不生成预设 patch），也不会生成 telemetry 补丁（默认不设 `DSH_TELEMETRY_DISABLED` 时……注意：遥测**行**在 base 里，`rows.has('session-telemetry-otel')` 为 true，但环境变量为空 → `resolveTelemetryPatch` 返回 undefined，`apps/cli/src/profile-boot.ts:80-83`）。

预测挂载的**服务面**（base 78 条，按主题；本机为 win32，平台门控取 Windows 分支）：

1. 基础设施：`timer`、`hmr`（`root: ['.']`——**headless/web 都禁 hmr，mini 没有它们，所以 hmr 保持启用**，`packages/bundle/base/cordis.patch.yml:16-22`）；
2. 模型与会话主干：`llm`、`session`、`typert`/`typert-loader`/`typert-gateway`、`session-title`/`session-title-llm`、`user-questions`、`agent`、`jobs`、`llm-retry`、`agent-default-model`（`provider: deepseek-official, model: deepseek-v4-flash`，`:61-67`）；
3. 用户配置面：`settings`（`$DSH_HOME/settings.yaml`）、`credentials`、`llm-pi-ai`（**休眠**：无 `llm-pi-ai:` 设置节时零路由，`:88-96`）；
4. 持久化与投影：`session-persistence-jsonl`（`root: !!js dshHomePath('sessions')`）、`attachment-local`、`session-query-sqlite`（挂载但 `openAt: never`——`ctx.sessionQuery` 可用、内容检索报 `SESSION_QUERY_SEARCH_DISABLED`，`:115-121`）、`session-projection`、`session-telemetry-otel`（挂载但 `mode: !!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'`——**默认关闭**，`:147-161`）；
5. 沙箱与安全栈：`subprocess`、`sandbox`、`sandbox-policy`（`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`、`workspaceRoot: !!js process.cwd()`，`:172-176`）、`bash-sandbox`（**win32 禁用**，`:178-182`）、`pwsh-sandbox`（**win32 启用**，`:184-186`）、`approval`、`permission`；
6. 工具与 agent 面：`shell-env`、`tool-bash`（win32 禁用，`:210-212`）、`tool-pwsh`（win32 启用，`:214-216`）、`tool-jobs`、`fs-observation-policy`、`tool-fs`、`tool-fs-search`、`agent-instructions`、`skill`/`skill-filesystem`/`skill-badge`（**disabled: true**，`:243-245`）/`tool-skill`、`commands`/`command-feedback`/`goal`/`goal-round-driver`/`command-goal`、`plan-mode`、`token-meter`、`compaction-basic`、`command-compact`、子代理家族（`subagent` 注册表、`subagent-spawn-in-process`、`subagent-fork-in-process`、`tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`、`tool-subagent-fork`、`tool-subagent-report`）、`workflow-worker-thread`/`tool-workflow`、`timeout-policy`、`spill-local`/`spill-policy`、`session-checkpoint-policy`、`tool-result-pruner`、`tool-todo`、`tool-goal`、`tool-ralph`、`tool-str-replace-editor`、`repeat-tool-reminder`；
7. web 能力：`web`、`web-search-deepseek`、`tool-web`（`fetch: false`，`:414-418`）；模型面中性行：`tools`（无 mode，schema 默认）、`system-prompt`（`persona: ''`）、`agent-loop`（`agents: []`）、`fs-sandbox`、`llm-deepseek`（不内联 key/endpoint）。

**关键预测**：这棵树**能挂起来**（`assertEntriesActivated` 只要求每个 Entry ACTIVE，`packages/boot/app-boot/src/index.ts:692-725`），但**不干活**——`agent-loop` 的 `agents: []`（`:436-438`）、`system-prompt` 的 `persona: ''`（`:430-433`）、没有 `headless-runner`/`web-startup` 任何入口行，也没有 agent-presets 行。它就是一个"服务骨架"：如果你之后用 `dsh plugin --profile mini add …` 装业务层或在 `cordis.patch.yml` 里补行（如 insert 一个 `headless-startup` + `headless-runner`，或补 `agent-presets` 行），它就变成可用的了——这正是"组合都是补丁层"的证明。

### 挑战

**7. 论证 `prepareProfile` 的"每次重写空根"是必须的。**

**机制**：`prepareProfile` 在 `loadProfile` 之后执行 `writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)`（`apps/cli/src/profile-boot.ts:98-103`），`PROFILE_ROOT_CONFIG` 就是注释 + `[]`（`:60-64`）。

**写回路径（两段代码）**：
1. `vendor/loader/src/index.ts:103-109`：`internal/update` 钩子——任何 Entry 的 config 更新经 `next()` 完成后，把 `this.entry.options.config` 用 `Config['simplify']` 反解后写回选项，并 `this.entry.parent.tree.write()` 持久化（根 include 的文件就是 `<profile>/cordis.yml`）；
2. `vendor/loader/src/index.ts:152-156`：插件**自卸载**路径——当 loader 判定某个 fiber 的销毁不是"loader 行为"（前面列了 7 种 case 逐一放行，`:131-152`），就在最后写 `fiber.entry.options.disabled = true; fiber.entry.parent.tree.write()`——把"这行被我禁了"也持久化回文件。

**删掉重写会发生什么**：
- 场景：某一次运行中，插件 A 自卸载（或某行 config 被 `internal/update` 热更，或 HMR 改动了树的某个局部）→ loader 把**当前整棵树**写回 `<profile>/cordis.yml`。这棵"当前树"里包含**全部已组合的行**——bundle 层 insert 的 78 条（甚至更多）原样躺在根文件里；
- 下一次启动：`mountRootInclude` 读到的 `cordis.yml` 不再是 `[]`，而是上一次的 78 条；随后 `applyEntryPatches(那 78 条, 补丁栈)` 又执行一遍——每个 bundle 的 insert **再插一次**，同 id 行出现两份（索引 Map 后写覆盖，但数组里两行都真实存在，挂载时两个 Entry 都会创建/或同 id 冲突），行数翻倍、行为错乱，且"行归属"全部失真；
- 更隐蔽的：写回还带着**上一轮用户 patch 的最终效果**（整行替换后的形态）。这等价于"把历史组合烤进文件"，与"组合 = 空根 + 补丁层"的模型相悖——以后你想调整某层的补丁，旧值像幽灵一样残留在根文件里，**不可回退**（与第 5 章第 7 题同源的"烤进"问题，只是这次烤的是根文件）。

**为什么可以安全重写**：注释（`apps/cli/src/profile-boot.ts:88-93`）给出了另一个方向的理由——这个文件**存在的唯一理由**是 Loader 需要一个真实存在的 include 根来锚定 `baseUrl` 到 profile 目录（dump 也锚定同一文件，"both compose over the identical base"）；根文件本身不承载任何真相，真相在补丁栈。所以每次启动无条件重置为 `[]` 是**幂等且无损**的。顺带一问：若有人在运行时往根文件里写别的东西，它会在下次启动被清掉——这是特性，不是 bug。

---

## 第 7 章　组合包与内置 bundle：base / headless / web-app

### 理解

**1. 用三句话分别定义 bundle、profile、preset，并指出三者最重要的区别维度。**

- **组合包（bundle）**：一个 npm 包，在其 `package.json` 的 `dsh.bundle.patch` 字段声明一份 patch 文件的相对路径，这份 patch 文件（顶层 YAML 数组）就是组合包的实体；组合器只读 manifest 字段、绝不 import 包代码（`packages/bundle/base/package.json:36-40`，`packages/bundle/README.zh.md:5`）。**区别维度：发布单元**——它回答"我这个包贡献哪份 patch 层"（`packages/boot/app-boot/src/profile.ts:41-70` 的 `DshBundleManifest`）。
- **配置档案（profile）**：`$DSH_HOME/profiles/<name>` 目录，内含 `package.json`（`dsh.profile.bundles`——有序的 bundle 包名列表）与 `cordis.patch.yml`（用户自己的补丁层，应用在每一个 bundle 层之后）（`packages/boot/app-boot/src/profile.ts:5-13`）。**区别维度：运行入口**——它回答"这个目录按什么顺序叠哪些 bundle"（`DshProfileManifest`）。同一份 manifest 可同时声明两角色（`packages/boot/app-boot/src/profile.ts:53-55` 注释）。
- **agent preset（预设）**：一个目录（id = 目录名），内含 `agent.cordis.yml`（插件行列表）与可选的 `preset.yml`（仅展示用元信息）；roster（`dsh-agent-presets`）在整个进程内把每个预设**只挂载一次**到常驻 scope，每个命名它的会话通过把 agent 的 scope key 认父到该挂载来加入（`packages/preset/agent-presets/README.zh.md:1-5`）。**区别维度：会话级装配**——它回答"一个 agent 应有哪些工具、哪些提示词段"（`apps/cli/config/agent-presets/standard/agent.cordis.yml:3-6`）。

一句话收束：**bundle 决定"装什么"（发布），profile 决定"怎么叠"（运行），preset 决定"每个会话的 agent 长什么样"（会话级）。**

**2. 为什么 base 用互补的 `!!js` 表达式做 shell 栈平台门控，而不是维护两份文件？Windows 用户想改用 bash 时，为什么必须"禁 pwsh 两行 + 启 bash 两行"成对完成？**

**为什么不用两份文件**：
- 平台门控要用的是"**同一时刻恰好一个栈**"这个不变量，而 `disabled` 是**每次挂载决策时求值**的（`vendor/loader/src/config/entry.ts:104-108`）——一个表达式就能表达"bash 在 win32 禁用、pwsh 在非 win32 禁用"（`packages/bundle/base/cordis.patch.yml:178-186`、`:210-216`），两份文件反而引入"哪份是对的"这一**必须靠人记忆**的问题；
- 第 7 章 7.1 的三条准则：patch 是**整行替换不合并**（base 头注释 `packages/bundle/base/cordis.patch.yml:3-9`），行归属必须可追——一份文件 + 互补表达式，让"bash 栈"与"pwsh 栈"在**同一个文件里成对出现、同在 178-186 / 210-216 相邻**，一眼能对照；拆成两个文件后，`cordis.patch.yml` 的 read 与 diff 语义、升级时的漂移都会放大；
- 表达式是**幂等且确定**的：`process.platform` 是启动事实，不随环境变化；两份文件靠"用户记得用哪一个"反而是不确定的。

**为什么必须成对完成**：`bash-sandbox` 与 `pwsh-sandbox`（以及 `tool-bash` 与 `tool-pwsh`）注册的是**同一个 `bash` 服务**（`packages/bundle/base/README.md`："both executor families register the same `bash` service"）。因此：
- Windows 上只禁 `pwsh-sandbox`/`tool-pwsh` 而不启用 `bash-sandbox`/`tool-bash` → bash 服务**没有实现**，依赖它的行加载失败；
- Windows 上只启用 `bash-sandbox`/`tool-bash` 而不禁 pwsh 两行 → 两个执行器家族**同时注册**同一个 `bash` 服务 → 服务冲突，加载时报错（README："an incomplete recipe fails loud at load"）；
- 所以完整配方 = **禁 pwsh 两行 + 启 bash 两行**（且要在用户层把 `disabled` 从 `true` 覆盖回 `false`/删除），缺一不可。这正是"行序无语义、激活由服务可用性驱动"（base 头注释第 3 条）的直接体现：**壳栈必须是完整置换，不是增量开关**。

### 应用

**3. 在 base 的 78 条中找出所有带 `disabled:` 的行，按"平台门控"与"默认关闭"分类。**

（`packages/bundle/base/cordis.patch.yml` 全文 grep `disabled:` 共 5 处，全部如下：）

**平台门控（4 处，两对互补）**：
| 行 | 位置 | 表达式 | 语义 |
|---|---|---|---|
| `bash-sandbox` | `:178-182`（disabled 在 `:180`） | `!!js process.platform === 'win32'` | Windows 上禁用（bash 无 Windows runner） |
| `pwsh-sandbox` | `:184-186`（disabled 在 `:186`） | `!!js process.platform !== 'win32'` | 非 Windows 上禁用 |
| `tool-bash` | `:210-212`（disabled 在 `:212`） | `!!js process.platform === 'win32'` | Windows 上禁用 |
| `tool-pwsh` | `:214-216`（disabled 在 `:216`） | `!!js process.platform !== 'win32'` | 非 Windows 上禁用 |

**默认关闭（1 处，常量）**：
| 行 | 位置 | 写法 | 语义 |
|---|---|---|---|
| `skill-badge` | `:243-245`（disabled 在 `:245`） | `disabled: true` | 徽章功能默认不挂，用户层可覆盖启用 |

**讨论**（严格说不是 `disabled:` 键，但同属"默认关闭"设计，答题时值得补一句）：`session-query-sqlite` 的 `openAt: never`（`:115-121`，检索保持关闭、部署覆盖 `openAt`）、`session-telemetry-otel` 的 `mode: !!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'`（`:147-161`，遥测默认关、只显式 opt-in）、`llm-pi-ai` 的"休眠挂载"（`:88-96`，无设置节则零路由）。它们没有用 `disabled: true`，是因为"关闭"的维度不同：有的是**行为关闭**（检索），有的是**数据采集关闭**（遥测，且 base 注释明确"config 不能禁用一行"——`disabled` 只能由启动器 patch），有的是**注册表为空**（pi-ai 零路由）。

**4. headless 与 web-app 都禁用了 `hmr`，但注释给出不同理由——说出两者的区别，及 bundle 注释的价值。**

- **headless**（`packages/bundle/headless/cordis.patch.yml:12-15`）：注释 "The shared module-reload HMR row stays off; the launcher's watch-only fallback still keeps the user patch layers live until the run exits." 理由是**运行形态使然**——headless runner 是一次性的（跑完即退，`dsh --profile headless "task"`），模块热重载没有意义；而第 6 章 `watchUserPatches` 的"纯监视 HMR"仍然让用户 patch 层保持实时（`apps/cli/src/profile-boot.ts:272-298`）。**动机：语义层面——不需要，所以关。**
- **web-app**（`packages/bundle/web-app/cordis.patch.yml:20-23`）：注释 "TODO: Re-enable shared HMR for Web after its reload lifecycle is tested." 理由是**工程状态**——Web 表面是长生命周期 surface，HMR 理应有用，但共享 HMR 的 Web 重载生命周期**尚未测试**，属于临时禁用、留了 TODO。**动机：测试状态——想开但还不能开。**
- **对照价值**：同样的动作（`- id: hmr / disabled: true`），动机恰好相反。如果注释缺席，后来的维护者看到 headless 的禁用，很可能顺手给 web-app 也套上"一次性模式不需要 HMR"的解释，或反过来想"web-app 留了 TODO，headless 是不是也该开"——两种推断都错。bundle 注释把**"为什么"钉在动作旁边**（且 web-app 的 TODO 还标明了复开条件），这正是"配置即文档"的体现，也是 7.1 准则"行归属可追"在"理由归属"上的延伸。

### 综合

**5. 写一个 `--patch` overlay：把 headless profile 的 `agent-default-model` 换成 pi-ai 路由，并给 `tool-web` 打开 `fetch: true`。**

```yaml
# overlay.yml —— dsh --profile headless --patch overlay.yml
# 1) 默认模型改走 pi-ai 路由
- id: agent-default-model
  config:
    provider: my-gateway        # 必须是 settings.yaml 里 llm-pi-ai.providers 的某个路由键
    model: legacy-chat          # 该路由目录里的模型 id
# 2) 打开 web_fetch 工具（fetch 是独立于 search 的注册开关；默认 false）
- id: tool-web
  config:
    fetch: true
    searchTimeoutMs: 60000
# 3) 挂载 fetch 提供方（base 刻意不挂；开 fetch 必须自己补上）
- insert:
    - id: web-fetch-http
      name: '@deepseek-ai/dsh-web-fetch-http'
```

**要点与理由**（全部以 `packages/bundle/base/cordis.patch.yml` 与相关源码为据）：

1. **pi-ai 是"休眠孪生"**：`llm-pi-ai` 行挂在 base（`:88-96`），但"零路由（并少算选择器里的模型）直到 `llm-pi-ai:` 设置节提供 provider profiles（`:88-93` 注释）"。所以单改 `agent-default-model` 不够——你还必须在 `$DSH_HOME/settings.yaml` 里写：
   ```yaml
   llm-pi-ai:
     providers:
       my-gateway:
         apiKeyEnv: GATEWAY_API_KEY
         api: openai-completions
         baseURL: https://gateway.example/v1
         models:
           - id: legacy-chat
   ```
   路由键（`my-gateway`）即 `agent-default-model.provider` 的值；模型 id 必须在该路由的目录里（`packages/llm/llm-pi-ai/README.md` 的 Config 节：route 命名 pi-ai 已知 provider 时继承其目录，未知名则整份声明）。`agent-default-model` 的原值（`provider: deepseek-official, model: deepseek-v4-flash`，base `:61-67`）被整行替换:63-67——这就是"把默认入口点从官方路由切到 pi-ai 网关"。
2. **`fetch: true` 的 SSRF 顾虑**：base 注释（`:396-403`）说得直白——"Fetch stays disabled and no fetch provider is mounted: that provider defers SSRF protection and the model would choose the request target." dsh 的取舍是：`web_search` 稳定（DeepSeek 搜索路由给 60s，`searchTimeoutMs: 60000`），而 `web_fetch` **刻意不挂**，因为请求目标由模型选择、SSRF 防护被推迟。所以你的 overlay 开了 `fetch: true`（`tool-web` 的 `fetch` 字段控制是否注册 `web_fetch` 工具，`packages/web/tool-web/src/index.ts:40-41` 默认 true，base 显式 false，`:414-418`）**之后，必须同时承担两件事**：① 挂一个 fetch 提供方（`@deepseek-ai/dsh-web-fetch-http`，name `web-fetch-http`，注册进 `ctx.web` 的 fetch 注册表，`packages/web/web-fetch-http/src/index.ts:28-30`）；② 自己对该工具的请求目标负责（网络访问控制、可信域名清单）。`ctx.web` 的选取语义：`fetchProvider` 显式钉住或"恰好一个可用提供方自动选中"（`packages/web/web/src/index.ts:50-70`），所以只挂一个 `web-fetch-http` 即可，不必写 `fetchProvider`。
3. **验证（未验证：本环境未构建 dsh）**：能构建时用 `dsh --profile headless --patch overlay.yml --dump-config` 观察 `agent-default-model` 与 `tool-web` 两行的 `# == …patched by …/绝对路径` 注释，且 `--dump-config` 与挂载共用同一个 `applyEntryPatches`（`packages/boot/app-boot/src/profile.ts:405-412` 注释），打印即组合事实。
4. **另一条合规路线**（如果不想提供方/不想 SSRF 升级）：把 `web` 行的 `searchProvider` 换掉而不是开 fetch——`tool-web` 的 `web_search` 才是"每个模式都启用的稳定工具"（base `:396-403`），要换的是搜索路由而不是开一个新能力面。

### 挑战

**6. 推演：把 standard preset 的 `tool-subagent-control` 移进 delegation 组的 entry-local realm 会发生什么？**

**先纠正前提（实核结果）**：`tool-subagent-control` **现在就在** delegation 组里——`apps/cli/config/agent-presets/standard/agent.cordis.yml:174-181`：`- id: delegation / name: cordis:group / group: true / isolate: { workflowEngine: true }` 的 `config:` 子列表第一行就是 `tool-subagent-control`（`:180-181`）。所以"移进去"在当前文件里是**已成事实**；真正值得推演的是两个方向：**它待在里面有没有问题**，以及**把别的行挪坏的典型错误**长什么样。

**它待在里面为什么没问题**：
- `tool-subagent-control` 是**工具行，不是服务行**——`packages/subagent/tool-subagent-control/src/index.ts:25-28`：`export const inject = ['tools', 'subagents']`，`apply` 里只 `ctx.tools.register(defineTool({…}))` 两个工具（`send_message`、`interrupt_agent`），不 `provide` 任何服务；
- isolate 的 realm 只重映射**`entry.options.isolate` 里列出的名字**（`vendor/loader/src/config/isolate.ts:96-103`：`newMap` 从父级 isolate 表继承、只有 `workflowEngine` 被换成 entry-local 符号）。`subagents` 不在名单里，所以它的符号仍是宿主符号——**工具行照常注入宿主 `subagents` 单例**（它只是 `ctx.subagents.followup()/interrupt()` 的薄适配器，`:1-8` 头部注释）；`tools` 注册表更是 host 平面，realm 不影响注册去向；
- 它"不发布服务"，因而**不受** `:11-18` 的 MUST 规则约束（那条规则只约束"在这里发布服务的行"）。delegation 组的 isolate 之所以存在，是因为组内的 `workflow-worker-thread` 提供 `workflowEngine` 服务、`tool-workflow`/`tool-ralph` 消费它——它们必须共享同一 realm（对照 compaction 组注释 `:128-129`：`compaction-basic` 经 `ctx.get` 读 `toolResultPruner`，"二者必须共享同一 realm"）。工具行只是搭了这趟车。

**真正会"坏了"的推演**（题库想考的反面）：
- **把 `tool-subagent-report` 挪进 realm**：它注册的不是"本 agent 调用的工具"，而是**子代理单例上的 continuable setup**（`packages/bundle/web-app/cordis.patch.yml:386-390` 注释："it registers a CONTINUABLE SETUP on that singleton rather than a tool this agent calls, and the setup list is not scope-aware——one copy per mounted preset means every child gets `report` registered once per live session, which throws on the second"）。realm 不隔离注册表（`subagents` 单例的 setup 列表挂在宿主上），所以每次挂载的 preset 都会往**同一个宿主单例**再注册一遍 → 第二个 live session 就抛错；
- **把提供 `subagents` 注册表的行（如 any registry 行）挪进 realm**：`subagents` 是进程单例、带跨会话查询面（`listChildren`、`followup`），且 provider 名全局唯一——每会话一份副本会让宿主行饿死、第二个会话直接冲突（`packages/bundle/web-app/cordis.patch.yml:367-372`）。同理宿主**读取方**标准（`:336-343`、`:351-356`）：被组外行 `ctx.get` 读的服务必须留 host，放进 entry-local realm 会让远程调用得到 `service-unavailable`；
- **把服务行（如 `planMode`）拿出来**：反过来踩 MUST 规则——没有 realm 的服务行发布进根 realm、进程全局，另一个 preset 发布同名服务直接冲突，`dsh-agent-presets` 在挂载时拒绝（`:11-18`）。

**一句话答案**：`tool-subagent-control` 已经待在 delegation 组里，且因为它是"消费宿主单例、向宿主注册表登记"的工具行，realm 对它是**中性**的；危险的从来不是"工具行进 realm"，而是"**在宿主单例上做注册/提供服务的行**进 realm"——那会让注册重复（continuable setup 抛错）或让宿主读不到服务（饿死/冲突），两者都会被加载期或第二个会话的运行时抓个正着。

---

## 第 8 章　会话日志：仅追加事件流与"模型可见即已记录"

### 理解层

**1. 把 13 种事件写进三分类表，并为每一类各举一条"为什么必须存在"的理由。**

（事件定义与注释均在 `packages/core/session/src/types.ts:236-333` 的 `SessionEventMap`；行号为各键位置。）

| 类别 | 事件（行号） | 作用 |
|---|---|---|
| **边界** | `turn/start`（:243）、`turn/end`（:252）、`step/start`（:254）、`step/end`（:256）、`session/end-seed`（:332） | 括出轮次/步骤/种子边界 |
| **模型可见** | `user/message`（:264）、`assistant/message`（:273）、`tool/result`（:291） | 恰为 `SurfaceEventType`（:343-346），进入投影历史 |
| **日志专用** | `assistant/chunk`（:266）、`tool/call`（:279）、`todo/write`（:299）、`request/header`（:304）、`request/context`（:309） | 只进日志、不进模型历史 |

**每一类"为什么必须存在"**：

- **边界类**（`turn/start`、`turn/end`、`step/start`、`step/end`、`session/end-seed`）：历史必须**可分割**——回放要知道哪里是一轮、恢复要知道哪里是种子、fork 要知道边界是否完整。`turn/end` 携带 `reason`（`TurnEndReasonMap`，:155-174）是状态机结算单；`session/end-seed` 让"种子部分与实况部分字节相同"的日志可以被一条事件切分（:310-331 注释）；`_forkSeed` 用 `OPEN_TURN` 拒绝断在未关闭 turn 中间的 fork（`packages/core/session/src/index.ts:1128-1135`）——没有这些边界事件，这些判断全部无从谈起。
- **模型可见类**（`user/message`、`assistant/message`、`tool/result`）：只有这三类能投影成消息历史（`deriveEventMessage` 只认它们，`packages/core/session/src/surface.ts:83-114`；`SurfaceEventType` 定义 :343-346）。它们是"模型看到什么"的**唯一入口**，`deriveMessages` 的输入就是它们组成的表面序列。
- **日志专用类**：
  - `assistant/chunk` —— **token 级重放保真**（:266 注释），没有它重放无法还原"模型逐字吐了什么"（见第 5 题）；
  - `tool/call` —— 记录模型**产出的原始 `arguments` JSON 字符串（未解析）**（:274-279 注释），解析是读端的事；它也是 `tool/result` 的 `sourceEventSeqs` 指向对象；
  - `todo/write` —— 整表快照、**last-write-wins** 的纯日志 UI 状态（:298-299 注释），`TodoItem = content + status`（:189-194）；
  - `request/header` —— 下一个请求的完整头快照（:300-304），"最新快照重建请求头"，`reason: 'initial' | 'resume' | 'change'`（:228）；
  - `request/context` —— 路由元数据，只在路由变化时记，**不参与请求重建、不参与 header 相等比较**（:305-309 注释）。

**2. 用两句话解释：什么叫"over-refuse"？为什么 `ignorable` 缺省即"必认"？**

**over-refuse（过度拒绝）**：在扩展日志的演进中，旧版本读者若遇到未知类型事件就**拒绝重建整个会话**——明明是"不认识这条新事件"，却让整个会话文档不可用，这就是"过度拒绝"：一种**不方便**，但绝不产生**错误数据**。**缺省必认的原因**：`ignorable` 的注释（`packages/core/session/src/types.ts:412-422`）定义"缺省 = 必须认识，读者遇到未标记的未知类型必须拒绝重建而不是静默丢弃"——因为未标记的未知事件**可能改变日志其余部分的解读方式**；若把缺省改成"可忽略"，忘记打标记的后果就是旧读者**悄悄重建出残缺的会话**（一种**错误**）。两害相权取其轻：**"不方便"优于"伤数据"**，所以 `ignorable` 缺省为必认、作者必须显式标 `true` 才允许读者跳过（这正是正文 8.2.4 "over-refuse，宁可拒绝也不带病重建"）。也正因如此，版本号可以保持单整数 `SESSION_FORMAT_VERSION = 0`（:56）——"只新增普通事件类型不 bump（交给 ignorable），只有结构变化才 bump"（:33-55 注释）。

### 应用层

**3. 给定事件流：`turn/start → user/message(0) → assistant/message(1, 空 content) → assistant/message(2) → tool/call(3) → tool/result(4)`，写出 `deriveMessages()` 的结果（逐条说明 `deriveEventMessage` 的分支）。**

（按题意把括号号视为事件在流中的序号：user/message=0、assistant/message(空)=1、assistant/message=2、tool/call=3、tool/result=4；turn/start 位于其前，序号连续性不影响结论。）

`deriveMessages()` 返回 **3 条消息**：`[user/message(0) 的消息, assistant/message(2) 的消息, tool/result(4).message]`。

逐条分支（纯函数 `deriveEventMessage`，`packages/core/session/src/surface.ts:83-114`；实例面 `packages/core/session/src/index.ts:755-757`）：

| 事件 | 分支 | 结果 |
|---|---|---|
| `turn/start` | 非 surface 类型 → `default` | `null`（:107-112：边界/chunk/usage/错误都是 trace/replay 数据，"Intentionally non-exhaustive"） |
| `user/message`(0) | `case 'user/message': return event.data` | 该消息本体——逐字透传（:94-96；注释强调**不得重新加框架**，`<context>` 这类包装由生产者烘进 content） |
| `assistant/message`(1) 空 content | `case 'assistant/message'` → `if (content.length === 0) return null` | `null`（:97-103：只为承载 max-tokens step 的 usage 而存在，不得把无内容 assistant 塞进 transcript——第 9 章 max-tokens 的关键） |
| `assistant/message`(2) | 同上，content 非空 | `event.data.message`（:102） |
| `tool/call`(3) | `default` | `null`（工具调用记录不投影；它被 `tool/result` 的 `sourceEventSeqs` 引用） |
| `tool/result`(4) | `case 'tool/result': return event.data.message` | `event.data.message`（:104-106）——注意是 result 携带的 `ToolResultMessage`，通常以 user 角色呈现工具结果块 |

顺带确认第 8.4.2 最小示例的同一规则：边界与 chunk 产生 0 条消息；`deriveMessages` 只在**表面节点**（5 个 `surfaceOp` 标注的序号）上调用 `deriveEventMessage`——本题这些事件除 turn/start 外都是表面事件（`turn/start` 不是 surface 类型），所以逐节点投影即上表。

**4. 若第 3 题里 `tool/result` 的 `sourceEventSeqs` 写成 `[5]`，`append` 会怎样？写成 `[3, 3]` 呢？**

两个 `append` 都**抛错、日志一行不变**。校验在 `assertProvenance`（`packages/core/session/src/surface.ts:211-243`），由 `planSurfaceEvent` → `validateNext` 在 `log.push` **之前**调用（`packages/core/session/src/index.ts:634`）——"先计划后提交"，校验失败时日志零变更（8.6 闸门三）。

- **`[5]`**：事件 seq 是 4，`sourceEventSeqs` 里的 5 **不小于**当前 seq → 抛 `sourceEventSeqs must reference earlier events: 5 >= current seq 4`（`packages/core/session/src/surface.ts:239-241`，原注释："must reference earlier events"）。引用"未来事件"被拒——溯源必须是"这条消息由哪些**更早**事件产生"。
- **`[3, 3]`**：重复引用 → 抛 `sourceEventSeqs must not contain duplicates`（`packages/core/session/src/surface.ts:236-238`：`sources.size !== raw.length` 即拒）。
- 正确写法是 **`[3]`**：`tool/result` 的对象是那次 `tool/call`，第 9 章 `tool-calls.ts:288` 写结果时正是带 `sourceEventSeqs: [callSeq]`。
- 其他相关规则（即使本题未触发也值得记住）：`sourceEventSeqs` 缺省合法（可选字段）；**空数组只允许 `assistant/message`**（已知空 provider 流），`tool/result` 给 `[]` 会抛 `sourceEventSeqs must not be empty except on assistant/message`（`packages/core/session/src/surface.ts:228-230`）；若是 `replace` 操作，引用还必须**覆盖全部被遮蔽节点**（:241-243，`assertProvenance` 的 `missing` 检查）。

### 综合层

**5. 论证"只记 `assistant/message`、不记 `assistant/chunk`"会破坏哪些能力；再论证"只记 chunk、不记 message"又会怎样。**

**只记 message 不记 chunk**：
1. **token 级重放保真丢失**——`assistant/chunk` 的定义就是 "Raw stream chunk — token-level replay fidelity"（`packages/core/session/src/types.ts:266`）。日志是"事实的账本"（:231-234："Every event is lossless JSON and sequence numbers stay contiguous, including raw chunks"）；只存组装好的消息，重放/恢复时**无法还原模型逐字吐了什么**：UI 的流式轨迹（ui-trajectory 类展示）、打字动画、逐 chunk 的增量 UI 全部退化为"一条消息一句话"；
2. **溯源链条断裂**——`assistant/message` 用 `sourceEventSeqs = chunkSeqs` 声明"由哪些 chunk 拼成"（`packages/core/session/src/types.ts:424-431`；第 9 章 `agent.ts:381-390` 的 `step()` 写它）。没有 chunk 事件，这条引用没有对象，第 9 章把 chunk 与消息关联、按 chunk 计数的逻辑（token-meter 等）无从谈起；
3. **违背"日志存事实而非结果"**——"组装好的消息"是**某个阶段的结果**；丢了原始事实，任何未来的新投影（比如把 chunk 重新分组、按 token 审计）都无米下锅。

**只记 chunk 不记 message**：
1. **投影层没有入口**——`deriveEventMessage` 对 chunk 恒 `null`（`packages/core/session/src/surface.ts:107-112 的 default`），且 `chunk` 根本不在 `SurfaceEventType`（`types.ts:343-346`）里，**永远进不了表面序列**。要让模型看到历史，必须由读端**再把多个 chunk 折叠成消息**——于是"事件 → 消息"的折叠规则出现**第二套实现**（一套在 `surface.ts`，一套散在消费方），直接违反 8.4.3 反例三"重建路径只有一条、折叠必须唯一"；
2. **usage 无处安放**——`assistant/message` 携带该 step 的 `usage`（`types.ts:269-273`："Carries the step's usage … there is no separate usage record"）。只有 chunk 时，token 计费、max-tokens 判定（第 9 章）的数据载体消失；
3. **投影成本失控**——每次 `deriveMessages` 都要扫 O(一个 step 的 chunk 数) 来现拼一条消息；而有 message 事件时，`deriveMessages` 是"每表面节点投影一次、增量缓存"（`packages/core/session/src/index.ts:726-747` 的 CACHED 注释），把 O(n) 折叠变成 O(1) 引用。长会话里"只记 chunk"会让投影从 O(节点) 恶化到 O(事件)；
4. **混淆"无输出"与"空输出"**——一个 step 可能因 max-tokens 没有完整消息（`assistant/message` 空 content 就是这种 stub，:97-103 注释）；只有 chunk 时无法区分"模型没吐字"和"吐了但被截断/错误"。

**结论**：两者**都必须存在、各司其职**——chunk 是事实（保真、可重放），message 是产物（投影、usage、溯源锚点）；日志存事实、投影出产物，这就是 8.1 的"日志即真相、视图由日志推导"。

**6. 模型必须看到文件变更通知，但通知内容可能含不可序列化对象（如 Error 实例）。梳理从消息源到日志的路径，指出 dsh 在哪里以什么错误拒绝它，并给出两类修复方案。**

**路径**：文件监视器（生产者）→ `agent.inject()` 合成的上下文（`user/message` 三类来源之一："a synthetic `agent.inject()` context (file-change notices, …)"，`packages/core/session/src/types.ts:257-263`）→ 最终都调 `Session.append('user/message', data, { surfaceOp: 'append' })`（唯一公开写入口，`packages/core/session/src/index.ts:604-608`）。

**在哪被拒绝**：`append` 的**第二步**——`const dataSnapshot = snapshotJsonValue(data)`，返回 `undefined` 即抛 `session event "user/message" carries non-JSON-serializable data`（`packages/core/session/src/index.ts:614-617`）。`snapshotJsonValue`（`packages/core/session/src/json.ts:177-179`）走 `walkJsonValue` 的**单遍"读 + 校验 + 复制"**（:70-163），其中对对象的原型链检查（`hasIntrinsicConstructor` / `hasPlainObjectPrototype`，:16-49）发现 `Error` 实例不是 plain object → 判定不合格。**时机**：在 `log.push` 之前、`surfaceManager.validateNext` 之前——坏数据在 append 现场就失败（注释 :599-600："at the append site, not the backend flush"），日志完全不变；同类的还有 `tool/result.meta`（必须 JSON 可序列化，`types.ts:280-297`）与 surface 元数据自身的校验（`index.ts:619-622`）。要区分的是：如果 Error 出现在**消息文本里**（`content[].text = String(error)`），它已经被序列化成字符串，没毛病；问题只出在把 Error **对象**塞进 data 的某个字段。

**修复方案**：

- **生产者侧（就地序列化）**：文件监视器在构造 content 之前把 Error 折叠成 JSON 形状——`content: [{ type: 'text', text: \`[通知] ${error.name}: ${error.message}\` }]`，或把 `{ name, message, stack? }` 作为**纯对象字段**放进 data（纯 JSON 值域内）。改动最小、不触协议；代价是"结构化信息"被压成文本、不可恢复（stack 若不要可省略）。
- **协议侧（新增事件类型）**：若通知需要**保留结构化错误信息**并作为**模型可见输入**，按 8.4.4 扩展规则必须"新增一种会话事件类型 + 给出投影规则"：向 `SessionEventMap` 合并如 `'fs/change-notice': { path: string; error?: { name: string; message: string } }`，在 `deriveEventMessage` 里加分支投影为 user 消息（或按你的语义投影），`sourceEventSeqs` 可省略（新鲜观测、无更早来源）——**Error 依旧不进日志**，只进它的"可投影视图"。若该通知**不需要模型看到**（只是 UI/审计痕迹），做成 `ignorable: true` 的日志专用事件即可（`types.ts:412-422`），UI 订阅 `session/event` 消费。
- 边界提醒：无论哪条路线，"**绕过日志直接塞 messages 数组**"都是被 8.4.4 禁止的（可见 ⇒ 已记录）；修复必须让通知先成为**事件**。

### 挑战层

**7. 设计自定义会话事件 `weather/current`（天气快照）：surface 还是日志专用？如何写 `deriveEventMessage`？UI 展示历史天气曲线应订阅什么？画出"事件 → 日志 → 投影 → UI"链路，并说明 `sourceEventSeqs` 有/无的理由。**

**第一步：判定类别**。关键问题只有一个——**模型需要看到它吗？**
- 若天气是"给 agent 的上下文"（如"今天下雨，去仓库记得带伞"这类任务相关输入）→ **surface 事件**：模型可见输入必须先是事件（8.4.4 反向规则），且必须进消息历史；
- 若天气只是"UI 曲线 / 审计痕迹"（agent 不需要）→ **日志专用事件**，并标 `ignorable: true`（旧读者可安全跳过，`types.ts:412-422`），不投影。

下面按 **surface 事件**设计（更有挑战的一半）：

**类型定义（插件合并扩展）**：
```ts
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'weather/current': {
      turn: number; step: number
      city: string; temperatureC: number; condition: string
      at: string            // ISO 时间，JSON 字符串
      meta?: JsonValue      // 可选：展示载荷（如图标名）
    }
  }
}
```
注意所有字段必须是 JSON 可序列化（`append` 的 `snapshotJsonValue` 闸门一）；若想带"观测失败"的 Error，按第 6 题协议侧方案：`error?: { name: string; message: string }`，**绝不塞 Error 实例**。

**投影规则**（在 `deriveEventMessage` 加分支，`packages/core/session/src/surface.ts:83-114`）：
```ts
case 'weather/current': {
  // 投影为 user 角色消息（inject 类上下文惯例），文本由这里排版
  return {
    id: `weather-${event.seq}`,
    role: 'user',
    content: [{ type: 'text', text: `[天气] ${city} ${temperatureC}°C ${condition}（${at}）` }],
    source: { kind: 'injected' },   // 以 MessageSource 的值为准
  }
}
```
注意两条纪律：① 这是**给消息重新加框架**的唯一合法位置（框架必须由投影层显式加，且遵守"生产者烘 content / 投影逐字透传"的分工——`user/message` 的 case 注释 :88-95 强调不得隐式加框架，`weather/current` 是自定义事件，加框架是**我们自己的设计决定**）；② 空/错误分支返回 `null`（无内容不塞进 transcript，仿 `assistant/message` 的空 content 处理 :97-103）。该事件必须携带 `surfaceOp: 'append'`（surface 事件强制标记，`types.ts:376-389`；非表面事件禁止携带，`surface.ts:185-194`）。

**`sourceEventSeqs` 设计：无（省略）**。理由：`sourceEventSeqs` 声明"这条消息由哪些**更早**事件产生"（`types.ts:424-431`）；天气快照是**外部观测、无更早来源**，所以字段缺省（合法：可选字段，`SurfaceIntent` :380-388 允许缺省），而不是给空数组——空数组只允许 `assistant/message`（`surface.ts:228-230`），别的表面事件带空数组会被拒。若你想强调"该快照响应了某次 `request/context`"，也可以引用那个更早 seq——但这会让"天气"与"路由上下文"耦合，我**不推荐**：引用应表达**产生关系**，而不只是时间先后。

**UI 订阅什么**：
```yaml
事件 → 日志 → 投影 → UI
[天气采集器] → Session.append('weather/current', …) → snapshotJsonValue 校验 → validateNext（计划） → log.push → session/event 广播 → UI 订阅者
                              ↓ 只读侧                     ↓ deriveMessages()/foldSurface
                         不可变日志（唯一真源）          天气曲线数组 / 消息历史
```
- UI 订阅 **`session/event`**（mode emit，`packages/core/session/src/index.ts:76`；监听者拿到**已入账**的冻结事件，:379 附近与 8.6 结尾）过滤 `type === 'weather/current'`，把 `temperatureC/at` 追加进自己的曲线数组——直接消费事件数据，不需要投影层参与（曲线是"事实"的直读）；
- 如果 UI 还想展示"模型当时看到的天气"——用 `deriveMessages()` 的投影结果（或恢复路径的 `foldSurface`，`surface.ts:387-395`），与模型历史严格一致；
- **恢复/回放**时注意：种子事件**不发 `session/event`**（`packages/core/session/src/index.ts:454` 注释 "constructor seeds do not emit"），所以 UI 在 `Session.create/fromRestore` 后必须从日志折叠一次补速（`foldSurface`），不能只等新事件。

**8. 10 万条事件的长会话，compaction 每 50 步跑一次。估算 `deriveMessages` 的摊销成本，并设计"UI 有瞬时结果、又不打断 model 请求"的读取策略。**

**成本结构**（`packages/core/session/src/index.ts:726-747` 与 `surface.ts` 对照）：

`deriveMessages()` 的代价 ∝ **表面节点数**，不是日志长度：

- **增量路径**：`derived`/`derivedNodes`/`derivedGeneration`（:701-706）缓存"已投影到第几个节点"。每次调用只处理 `nodes.slice(this.derivedNodes)`——每个表面节点**恰好投影一次**，单次调用成本 O(新增节点数)（:717-719 注释 "a call costs O(new nodes)"）。每 50 步内每次调用看到的新节点 ≈ 1（每次 UI 刷新），成本 **O(1)**；
- **重建路径**：某次 compaction 的 `replace` 让 `surface.replaceGeneration + 1`，下一次 `deriveMessages` 发现 generation 变了就整表作废重建（:730-734）。重建成本 = **当前表面节点数**，而表面长度在压缩后 ≈ 一个摘要节点——每 50 步一轮：50 个 append 节点 + 1 个 replace 节点，replace 把整轮旧节点折叠成 1 个 → 表面长度稳定在 **O(50)**；
- **总账**：10 万条事件 = 2000 轮 ×（50 次 O(1) 增量 + 1 次 O(50) 重建）≈ **O(10⁵)，均摊每个事件 O(1)**。比较：若没有 surface、每次全日志折叠 → 每次调用 O(10⁵)，10 万次调用就是 O(10¹⁰) 的平方级灾难。**这就是"表面是折叠索引"的价值**——`SessionSurface.nodes` 是当前表面事件序号的有序数组（:136-142），`deriveMessages` 从不遍历原始日志（`this.log[seq]!` 只是按索引取，:735）。

**读取策略**（"UI 瞬时、不打断 model 请求"）：

1. **发布-订阅 + 帧批处理**：UI 订阅 `session/event`（已入账事件，index.ts:76），把新事件**排队**，在 `requestAnimationFrame`（或 16ms 定时器）里**每帧最多调一次** `deriveMessages()`——单次调用是 O(1)~O(50) 的同步操作，微秒级，绝不阻塞；
2. **快照 + 差异渲染**：`deriveMessages()` 每次返回**新数组**（`:719-721` "later appends never grow an array a caller already holds"），且消息对象**共享、深冻结**（:721-723）。UI 持有"上次渲染的数组引用"，比较 `length` 与末元素 id，变才重渲染；持有旧数组的组件（正在绘制的帧）永远安全——它看到的是"重构前/更早的完整快照"，不会半新半旧；
3. **不打断 model 请求**：model 请求路径在**构建请求那一刻**调用自己的 `deriveMessages()`/`requestHeader()` 拿**自己的快照**（第 9 章 `buildRequest`），UI 的读取是**只读**的：`derived` 缓存只被 `replaceGeneration` 失效，不被 UI 改动——两个读方共享同一个不可变视图，单线程下无锁、无竞态；UI 渲染的耗时工作（DOM 更新）放在帧回调里，与日志追加天然隔离；
4. **compaction 时的取舍**：压缩后 generation 变化 → UI 下一次帧会重建（O(当前表面节点) ≈ O(50)），这**恰好**是"瞬时结果"想要的——UI 直接切到摘要视图；而 model 请求方在**请求边界**的快照不受影响（它已经持有旧数组）；
5. **可选优化**：若 UI 需要比 `deriveMessages` 更细的粒度（比如逐 chunk 曲线），不要走投影，直接订阅 `session/event` 拿 `assistant/chunk`（事实级、日志专用事件）——**UI 关心事实，投影关心历史**，两者分开订阅各自维护，谁也拖不慢谁。

---
## 第 9 章　Agent Loop：一次轮次的一生

### 理解层

**1. 画出相位状态机：三个节点、全部迁移边、每条边的触发函数与对外 `agent/status` 变化；再标出"锁存位"在哪里被置位、在哪里被消费。**

**三节点及其载荷**。相位（phase）是 `Phase` 判别联合（`packages/core/agent-loop/src/agent.ts:38-46`）：

- `idle`：`{ kind: 'idle'; lastTurn: number }`——无事可做，等待唤醒；
- `maintenance`：`{ kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }`——驱动器已交付但暂时无活，相位仍归为 **idle** 对外；注意它随身携带自己的 `AbortController`；
- `running`：`{ kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }`——正在跑一个轮次。

**对外状态的换算**。`status` 不是相位原文，而是一个 getter（:99-101）：`phase.kind === 'idle' || phase.kind === 'maintenance' ? 'idle' : 'running'`。这就是为什么 `maintenance` 对外是 idle——**相位是内部事实，status 是外部视图**。`setPhase`（:104-111）只在 status 真变化时才 `emit('agent/status', …)`（:108-110），所以相位迁移可能发生而 status 事件不发生（例如 running → maintenance 不会发生；但 idle → maintenance 对外**不**发事件）。

**全部迁移边**：

| 迁移 | 触发函数 | 对外 agent/status |
|---|---|---|
| idle → running | `wakeDriver`（:172-193）新建 running 相位（:185-191），`withInitiator` + `kick`（:192） | idle → running（一次翻转） |
| idle → maintenance | `runMaintenance`（:142-162）：非 idle 抛错（:143），构造 maintenance 对象（:145-150），`setPhase`（:151） | **无变化**（对外仍是 idle，getter :99-101） |
| maintenance → idle | `runMaintenance` 收尾（:157），随后重放与 `done.resolve`（:158-159） | **无变化** |
| running → idle | `kick` 的 `finally`（:215-223，`setPhase({kind:'idle'})` :219） | running → idle（一次翻转） |
| running 内续跑 | `turn` 尾部 :324-329 换控制器、清位、`step=0`、`return true`（:329）——**不换相位** | 无变化（同相位内进入下一轮 while） |

**锁存位 `wakeRequested` 的置位与消费**。锁存（latch）解决的是"驱动器已经不在场，谁来叫醒"的问题：

- **置位**：`wakeDriver` 发现 `phase.kind !== 'idle'`（:175）时，若 `reason?.kind !== 'disposed' && (phase.kind === 'maintenance' || wakeAfterAbort)` 则 `this.phase.wakeRequested = true`（:177-180）。注释（:178-179）点明设计动机："Live drivers claim queued work themselves; disposal never latches, so teardown waits on no model turn."
- **消费**：两处。`runMaintenance` 收尾（:158）与 `kick` 的 `finally` 重放（:220）——在回到 idle 后检查 `wakeRequested && hasPending`，为真则再 `wakeDriver(true)`；此时 idle 分支直接新建 running（status 再翻转一次）。所以"只有位已置**且**活动已结束"才会重放，而重放本身又是一次 idle → running。
- **清位**：`cancel`（:134-140）清掉锁存（:137），`turn` 尾部换新控制器时置 `wakeRequested = false`（:327），`wakeDriver` 新建 running 时也显式置 false（:190）。

一句话总结：相位是循环的主体，status 只是投影；锁存位是"唤醒意图的欠账"，在活动收敛时被结清并触发重放。

**2. 把 11 个 agent/* 事件按"生命周期通知 / 机器扩展点 / 错误通知"三组分类，并指出哪些事件载荷里带 `signal`。**

事件块共 **12 个**声明（`packages/core/agent/src/runtime-types.ts:146-291`），题面说"11 个"——因为第 12 个 `session-start`（:217）被单独列为"会话生命周期"，不在 agent 生命周期三组之内。分类如下：

**生命周期通知（6 个）**：
- `created`（:159）、`disposed`（:168）——生与死；
- `status`（:178）——相位投影；
- `inbox/inserted`（:186，持久名 `agent/inbox/spliced`，见 `packages/core/agent/src/inbox.ts:186`）、`inbox/claimed`（:197）、`inbox/discarded`（:205）——收件箱三态。

**机器扩展点（4 个）**：`pre-step`（:225-231）、`request`（:233-244）、`request-error`（:246-260）、`turn-stopping`（:261-278）。它们都是瀑布（waterfall）形态："`Calling next() preserves the current messages.`"（:228-229）——扩展点在**请求被组装之前**改写请求，而不是事后观察。

**错误通知（1 个）**：`error`（:290）。

**带 `signal` 的正是全部 4 个机器扩展点**：`pre-step` 载荷 `{ agent, messages, turn, step, signal }`（:230-231）、`request` 载荷 `{ agent, turn, step, signal }`（:244）、`request-error` 与 `turn-stopping` 同样携带 `signal`——它们都是"当前这一个动作"的窗口，显式中止信号必须随窗口传递，便于监听器判断"这轮是否已被取消"。生命周期通知只报事实，不带 signal。

> 一图记忆：6 个通知回答"发生了什么"，4 个扩展点回答"接下来怎么走"，1 个错误回答"哪里断了"；`session-start` 是会话这个更大对象的起点，按 `runtime-types` 的分组注释（:206）单列。

### 应用层

**3. 写一个 `agent/pre-step` 插件：把 `inject` 来的动态上下文压缩成一行文本。写出插件代码、改写后的事件序差异、以及"若压缩结果为空字符串"时轮次会怎样结束。**

**先厘清一个前提**：运行时上下文投影消息**不在收件箱里**。`RuntimeContextProjection.project`（`packages/core/agent-loop/src/runtime-context.ts:64-75`）只在"内容变化"时生成一条 `UserMessage`（`if (this.retained?.text === snapshot) return`，:67），而这条消息是由 `preStep` 的**默认回调**拼进 `decision.messages` 的（`packages/core/agent-loop/src/agent.ts:236-239`）。因此插件的正确姿势是：**先 `await next()` 拿到默认决策（含投影），再改写其 `messages` 数组**——与 `agent/request`"`await next()` yields X; return a replacement"模式一致。

**插件代码**（挂在 `agent/pre-step` 瀑布上，`Agent` 为 scoped 类型）：

```ts
import { type AGENTS, type Agent } from '...' // 以仓库实际导出为准

export const compressInjectContext = (ctx: Context) => ctx.on(
  'agent/pre-step',
  async (agent: Agent, payload, next) => {
    const decision = await next()                       // 拿到默认决策（含投影消息）
    if (decision.kind === 'reject') return decision
    const messages = decision.messages.map((m) => {
      const src = (m as { source?: unknown }).source
      if (src && (src as { kind?: string }).kind === 'plugin'
          && (src as { plugin?: string }).plugin === '@deepseek-ai/dsh-system-prompt') {
        const text = (m.content ?? []).filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text).join('')
        return { ...m, content: [{ type: 'text', text: text.replace(/\s+/g, ' ').trim() }] }
      }
      return m
    })
    return { ...decision, messages }
  },
)
```

**改写后的事件序差异**（对照 9.2.2 事件序表）。投影消息照样进入 step：默认回调仍追加一条 `user/message`（agent.ts:282-283 落账），只是其 `content` 变短——事件**数量不变**（`pre-step` → `user/message` → `step/start` → … → `turn/end`），变化的是消息体。但有一个**副作用**：本项目 `project` 以"内容变化才生成"为不变量（runtime-context.ts:67），若压缩后内容与上一条投影相同（例如两次都压成同一行），你**手动改写**会使日志出现重复的同文消息，且不可由投影器自身去重——这是"在瀑布里改消息"与"让投影器自己生成"的语义差异，日志层面会多出用户可见的重复。

**"压缩结果为空字符串"的两种结局**：
- **保留空文本消息**：`messages` 里仍有一条 `content` 为空数组/空串的 `user/message`，照常落账（:282-283）、照常开 step，轮次正常结束 `completed`——只是模型会接收到一条空消息（多数提供方容忍，但浪费一次 step）。
- **过滤掉该条（且为首步）**：`decision.messages` 变为空 → `turn` 的首步空消息分支（:274-276）使轮次直接以 `turn/end reason = completed` 结束，**没有 step**：日志序列是 `pre-step` → `turn/end(completed)`，skips 掉整个 step。若过滤发生在非首步且 `turnEnds` 为真，则走 :271 的空 break 分支。

**4. 实现"步骤限流"：在 `agent/request` 瀑布里把 `maxTokens` 限制为 2000；并回答为什么同一处瀑布不能做"限制消息条数"。**

**限流实现**（`agent/request` 瀑布返回 `LlmCallConfig`，改字段即可）：

```ts
ctx.on('agent/request', async (agent, payload, next) => {
  const config = await next()               // 默认配置（首请求为 agent options，其后为已记录标头）
  return { ...config, maxTokens: 2000 }     // 返回替换值即切换
})
```

**为什么同一处不能限制消息条数**。两个原因，都写在契约里：

1. **载荷里没有消息**。`agent/request` 载荷只有 `{ agent, turn, step, signal }`（runtime-types.ts:244），返回类型是 `LlmCallConfig`——它只含 provider/model/`reasoningEffort`/temperature/`maxTokens`/stop（`packages/llm/llm/src/call-config.ts:23-30`），**没有 messages/tools 字段**。你拿不到消息，自然无法数、无法截。
2. **契约明令禁止**。注释（runtime-types.ts:235-236）："Model-visible content must use logged channels; this waterfall cannot mutate messages."——模型可见内容必须走"已落账的通道"，而 `agent/request` 恰是**请求组装**环节，消息已于更早的 `pre-step` 落账（agent.ts:282-283），此处再改就会产生"日志与请求不一致"的违约状态。

**正确的替代位置**：`agent/pre-step`（agent.ts:234-240）改写 `decision.messages`——它发生在消息落账**之前**，且 `turn` 会把改写后的消息落为 `user/message`（:282-283），日志与请求一致。（第 9 章练习 3 正是同一条河道的另一种用法。）至于 **assistant 历史**（上一轮模型输出）：它不在任何瀑布的载荷里——`deriveMessages` 是从会话日志全量重建的（:341），没有官方接缝可以"截断历史"；真正的长上下文控制手段是**压缩（compaction）**（第 8 章），而非在请求层偷偷删消息。

### 综合层

**5. 取消发生在工具执行中途：正常取消路径下日志中 `tool/call` 与 `tool/result` 是否对偶？调度器内部失败路径呢？**

先给结论：**正常取消路径对偶，调度器内部失败路径不对偶（这是有意为之）**。题面提示中两处引注现指向正确文件——`packages/core/agent-loop/src/tool-calls.ts:96` 与 `:240` 正是"取消时补 skipped"的两个调用点，`:231-235` 正是调度器失败 catch，模块注释 `:9-10` 是第二承诺的出处；不必修改题面。

**正常取消路径（对偶）**。取消发生在工具执行中途时，`runGroup` 分两段补齐账本：

- **未启动的调用**：`executeToolCalls` 里 `outcome.aborted` 时对 `planned.slice(next)` 调 `appendSkippedToolCall`（:94-96）；`runGroup` 内部对 `group.slice(started)` 同样处理（:237-241）；
- `appendSkippedToolCall`（:249-259）**补一条 `tool/call` + 一条合成 `tool/result`**：内容为 `"Error: tool call aborted before dispatch"`、`isError: true`、错误码 `TOOL_ABORTED_BEFORE_DISPATCH`（:472）。于是每个 `tool/call` 都有配对的 `tool/result`——这就是模块注释承诺 1（:8-9）："Abort records synthetic error results for skipped calls so replay stays valid." 回放时投影不会遇到"有调用无结果"的悬空调用。
- **已启动的调用**：正常走 `appendToolResult`（:268-288），它们要么成功、要么取消，也都有结果。所以整条取消路径上 `tool/call ↔ tool/result` **一一对偶**。

**调度器内部失败路径（不对偶）**。若调度器本身抛错（例如 `scheduler.prepare` 失败），`runGroup` 的 catch（:231-235）只做两件事：记下 `schedulerFailure`、`await Promise.allSettled(inFlight.values())` 等已启动的派发落地，然后**抛出原错误**——**不**为未启动的调用补合成结果。此时日志里已写入的 `tool/call` 没有配对 `tool/result`，这就是模块注释承诺 2（:9-10）："A terminal scheduler failure preserves already-recorded tool/call events without fabricating results."

为什么这种"不对偶"是对的：调度器失败是**基础设施故障**，不是取消；此时补一条"aborted before dispatch"会**伪造**失败原因（真实原因是调度器坏了），把一次运维事故伪装成正常取消。保留"有 call 无 result"的事实，让回放/审计看到明确的断裂点，比给出一个假结果更诚实。

**6. 论证"running 且未中止时锁存唤醒"会造成的两类错误（丢唤醒 / 重复开轮），并说明为什么代码选择只对 maintenance 与 wakeAfterAbort 锁存。**

先复述现状：`wakeDriver` 在 `phase.kind !== 'idle'` 时，只在 `reason?.kind !== 'disposed' && (phase.kind === 'maintenance' || wakeAfterAbort)` 才置锁存位（`packages/core/agent-loop/src/agent.ts:177-180`）。也就是说 **running 且未中止时来到的唤醒既不投递也不锁存**——为什么？

**反事实：若 running 未中止也锁存，会出两类错**：

1. **重复开轮（误开）**。锁存位是单比特，它**不区分**输入类型。设想 running 中用户先 `send` 一条真消息（此时跑步中的驱动器会在本轮收尾时自领——:179 注释 "Live drivers claim queued work themselves"），随后又有 `inject`/工具上下文等**非唤醒输入**到达并置位；本轮的 `kick` 收尾时（:220 重放检查 `wakeRequested && hasPending`）收件箱里只剩这些非唤醒输入，`hasPending` 为真 → 会**重放并再开一个轮次**——而这个轮次里没有任何用户消息可 claim，纯属白跑。这正是"锁存只该留给**无法自领**的情况"：running 的驱动器还活着，它会自己领走当前的消息；锁存反而会把本不该开轮的情况变成开轮。
2. **丢唤醒（位与相位蒸发）**。锁存位寄存在相位对象上，而相位会换：`turn` 尾部换新控制器并清位（:327）、`wakeDriver` 新建 running 时置 false（:190）、`setPhase(idle)` 后旧的一位随相位蒸发。若 running 未中止也锁存，锁存位会与"自领"通道及这些清位点交错：中止、换挡时收件箱里有货（真消息），但位可能在 `cancel` 被清（:137）或随相位重建丢失 → **唤醒就丢了**。锁存机制必须只在"位不会与正常投递通道打架"的时刻使用。

**为什么保留两条锁存路径**：
- **maintenance**：此时**没有活着的驱动器**（`runMaintenance` 交付后就休眠），消息只能靠锁存记账，否则必丢——所以 maintenance 时任何非 disposed 唤醒都锁存（:178-180）；
- **wakeAfterAbort**：`send` 在插入前分类（:116 `wakingAfterAbort = wakeup && phase.kind !== 'idle' && abort.signal.aborted`），专指"唤醒输入撞上**已中止**的活动"——中止中的驱动器不会自领（活动已死），但消息是**真用户输入**，必须锁存以待重放。这是唯一需要"跨活动记账"的正常输入。
- **disposed 永不锁存**（:176-177）："disposal never latches, so teardown waits on no model turn"——销毁路径不欠唤醒，锁存会让 teardown 卡在"等一个不会来的模型轮次"上。

### 挑战层

**7. pre-step 拒绝后的瞬间，控制台收到 `followup(...)`：写出之后的完整事件序与 `turnEnds` 的值，并画出 phase 的完整变化序列。**

场景：turn 1 里 `pre-step` 瀑布拒绝（`decision.kind = 'reject'`），随后**在 running 相位尚未结束时**控制台调用 `followup("继续")`（即 `send` + `wakeup=true`，target 为 `next-turn`，agent.ts:122-124）。

**关键判定**：`send` 里 `wakingAfterAbort = wakeup && phase.kind !== 'idle' && abort.signal.aborted`（:116）——本场景 running **未中止**，故为 **false**；target 保持 `next-turn`，消息插入 **next-turn 收件箱**（`agent/inbox/spliced` 事件，inbox.ts:186），随后 `wakeDriver(false)`：非 idle 分支不锁存（:177-180 条件不满足），直接返回。**消息留在箱里，等本轮收尾**。

**事件序**（agent/inbox/claimed 在 reject 时不发 user/message，runtime-types.ts:188-190——"neither discarded nor re-emitted"）：

```
turn 1：turn/start#1 → agent/pre-step(1,1)（拒绝）
      → agent/inbox/claimed（claim 的那条在此终结）
      → turn/end#1  reason=blocked（agent.ts:267-269）
      →（followup 的消息此时在 next-turn 箱里）
收尾：turn 尾部 hasPending 真（:324）→ 换控制器（:325）→ 清锁存位（:327）
      → step=0（:328）→ return true（:329）【相位不变，仍是 running】
turn 2：turn/start#2 → agent/pre-step(2,1)（放行）
      → user/message（claimed 的消息落账，:282-283）
      → step/start#2 → assistant/chunk* → assistant/message
      → step/end#2 → turn/end#2  reason=completed（:394/:399）
```

**`turnEnds` 的值**：`turnEnds` 是 `send` 时随消息一起存的"目标"（'next-turn'，:261 每轮重新 `target = 'next-turn'`）。本场景 followup 消息在 reject 后到达，**仍属于 turn 2 的输入**，turn 2 打开即领取（claim 语义：next-turn 只取一条，inbox.ts:71-76）。turn 2 结束时 `turnEnds` 恢复为 null；整个过程中 turn 1 没有 step，turn 2 有 1 个 step。

**phase 序列**：`running`（turn 1）→ `running`（turn 2，未换相位，:324-329 的续跑就是同相位换活动）→ `idle`（kick finally :219）。对外 `agent/status` 只翻转两次：`idle → running`（wakeDriver :183-192）与 `running → idle`（:219）。

**对照情形**：若 followup **晚于** kick finally（已回 idle）才到达，`send` 时 `phase.kind === 'idle'` → `wakeDriver` 直接走 idle 分支新建 running（:185-191）→ 相位序列 `idle → running → idle → running → idle`，`agent/status` 翻转**四次**。两种情形的分界就是"消息到达时 running 是否还活着"——这正是锁存注释（:178-179）所说的边界。

**8. 设计"轮次级重试"：若提供方持续 429 且 `agent/request-error` 每次返回 `{ kind: 'retry' }`，step 内的 `while(true)` 会不会无限循环？**

**会——没有任何内置计数或预算**。`step` 的骨架（`packages/core/agent-loop/src/agent.ts:332-401`）是：

```ts
while (true) {                       // :339 无计数、无预算
  const config = buildRequest(...)   // :340-342 每轮重新构建
  await stream(...)                  // :345 一次流式调用
  ...
  const action = await waterfall(... 'agent/request-error' ...)  // :354-365
  if (action.kind !== 'retry') { if (...) throw ...; break/continue } // :367-368
}
```

循环唯一的出口是：`finish` 非 error/aborted（:353 之后）、`action.kind !== 'retry'`（:367-368）、各处信号检查（:346/:348/:352/:366），以及 `buildRequest` 内部的检查（:442/:456/:484）。若提供方**持续返回 429** 且你的 `request-error` 监听器**每次**都 `return { kind: 'retry' }` 且不调 `next()`，则循环永不满足出口条件——**活锁**：CPU 忙转、每轮重新 `buildRequest`（`agent/request` 瀑布每轮都被调用，可改配置）、日志以不可控速率膨胀。这与第 10 章的 `retryPolicy`（adapter/stream 层重试）不同：那是**同一次请求**内的重试且带持久预算（`llm/retry` 事件），而轮次级重试是**整个请求的重新发起**，目前没有预算层。

**带重试计数上限的插件**（计数器以 `turn/step` 为键，避免跨轮泄漏；超过上限"交还"给默认行为——不调 `next()` 的监听器返回 `undefined` 会让失败保持终态，runtime-types.ts:246-260）：

```ts
const budget = new WeakMap<object, number>()   // 以 agent 为键；或 Map<`${agent.id}:${turn}:${step}`, number>
ctx.on('agent/request-error', async (agent, payload, next) => {
  const key = `${agent.id ?? ''}:${payload.turn}:${payload.step}`
  const count = (budget.get(agent as object) ?? 0) + 1
  if (count > 3) {
    return next()            // 超出上限：交给默认 undefined → 失败终态
  }
  budget.set(agent as object, count)
  if (is429(payload.failure)) {
    await delay(500 * 2 ** count)    // 指数退避
    return { kind: 'retry' }         // 不调 next，自己接管恢复
  }
  return next()
})
```

要点：① 计数上限使循环必然终止（超出即 `next()` 或返回非 retry）；② 退避是为了不把 429 风暴变成忙转；③ 键一定要含 `turn/step`——否则跨轮次共享计数会把无关轮次拖进终态（`budget` 清理可挂 `turn/end`）。

**与 `retryPolicy` 的边界**（这是本题的另一半）：`retryPolicy` 在**注册时被捕获**（`packages/llm/llm/src/index.ts:387-393`；`llm-deepseek` 的 `ensureRegistrationFacts` :258-268 注释直言它是"per-request resolution cannot refresh"的那一个事实），它只作用于 **adapter/stream 层的同一次请求重试**，并受 `llm/retry` 持久事件预算约束。轮次级重试则发生在 `agent/request-error`——它**可以**换请求配置（每轮重新 `buildRequest`），代价是没有内置预算、必须自计数。一句话：**retryPolicy 管"同一请求再来一次"（有预算），request-error 轮次级重试管"换一个配置再来一轮"（需自加预算）**。

## 第 10 章　提示词组装与 LLM 适配器

### 理解层

**1. 不看源码说出 order 约定：harness 身份、persona、工具指引各用什么阶？为什么 `deployment:persona` 常量会被导出（提示：遮蔽语义）？**

**order 约定**（`packages/core/system-prompt/src/index.ts:57-59` 注释原文约定：-100 身份、0 persona、工具 100-199）：

| 段 | order | 出处 |
|---|---|---|
| harness 身份（如 `harness:identity`） | **-100** | `SystemPrompt` 构造 :357-363（`harness:identity -100` 硬编码） |
| persona（`deployment:persona`） | **0** | `PERSONA_ORDER = 0`（:131） |
| 工具指引 | **100–199** | 各 tool-* 插件（如 `tool:read` order 100）；`collapse` 段用 99（`COLLAPSE_SECTION_ORDER`，`packages/core/tools/src/index.ts:51`）；SDK（`run_code`）用 150（`packages/core/tools/src/code-mode.ts:23`） |

阶的语义是**优先级**：-100 最靠前（最"底层"的身份声明），0 居中（人格），100+ 最后（工具目录）。`orderTools`（:164-178）与 `validateToolOrder`（:146-157）保证工具段恰好落在 100-199 区间内、且段间无重名（:316-318）。

**为什么导出 `PERSONA_SECTION`**。段名 `deployment:persona` 不仅是字符串，还是**遮蔽（shadow）机制的关键**：同名段在 scoped 层可以遮蔽（shadow）全局层同名段（assemble 的 merge :483-485 采用 scoped 覆盖全局的合并；只有**同一层**重名才抛错 :316-318）。`PERSONA_SECTION` 被导出的原因注释写得很清楚（:123-126）：其他插件（尤其是 scoped 提供方，如子代理的 `deployment:persona`，`packages/subagent/subagent/src/child-agent.ts:172`）需要**引用同一个常量**来注册同名段，从而**替换**全局 persona——如果用字符串字面量，一旦全局改名就静默失效；用导出常量，遮蔽关系在编译期就被固定。一句话：导出是为了让"替换"变成"引用同一符号的遮蔽"，而不是"碰巧同名的两个段"。

**2. 一个 `complete` 段注册后，插件监听 `system-prompt/assemble` 能否往提示词里加一段？为什么？**

**不能**（至少不能持久地加；瀑布可改 tools/contexts/variables，唯独加不了 sections）。原因在 `assemble` 事件注释（`packages/core/system-prompt/src/index.ts:24-26`）："A registered complete section is restored after this waterfall, so listeners cannot add to or replace that scope's system prompt." `assemble` 的尾部实现（:536-541）证实：瀑布（:532-535）返回后，若存在 `completeSection`，则 `sections` 被**整体替换回 `[completeSection]`**（:539）——瀑布里往 `assembly.sections` 塞的任何东西都被丢弃；瀑布仍可改 `tools`/`contexts`/`variables`（返回值权威，:532-535），因为只有 sections 被还原。多重 `complete` 段同时注册会在瀑布**之前**直接抛错（:505-508：`multiple complete prompt sections are active`）。

这条设计有一处题面引注的笔误需要温和指出：题面让对照 `packages/llm/token-meter/README.zh.md:24-26` 的注释——实测该文件 24-26 行是"## 会话投影"节标题，与 complete 语义无关；正确对照应为上面所引的 `packages/core/system-prompt/src/index.ts:24-26`（assemble 事件注释原文）。题面所引 `:536-541` 无误。

**为什么这么设计**：`complete` 段的契约是"**这是唯一的、不可被瀑布增删的系统提示**"（`PromptSection.complete` 语义 :69-73）——它把"这个 scope 的提示词内容"锁死为一个提供方的责任，避免瀑布监听器把"我无法完全控制提示词"的局面搅浑（例如审计要求"此 scope 的提示词必须只有 X"）。代价是显式的：想加段，注册段（plugin），而不是改瀑布。

### 应用层

**3. 写出用 `renderPrompt` 渲染 `{name:'a', text:'{{x}}'}` 且 variables 为 `{x: undefined}` 的结果，并说明抛错发生在哪一行、错误消息大致内容。**

**结果：渲染抛错，没有"渲染结果"返回**。`renderPrompt`（:212-217）先做插值（`interpolate`），插值失败直接抛；"先插值后过滤"意味着不会返回含有未替换 `{{x}}` 的字符串给你"事后处理"。

**抛错位置与原因链**（`interpolate` :258-295）：

1. `{x: undefined}` 在变量表中**存在**：`interpolate` 用 `Object.prototype.hasOwnProperty` 判定"这个变量名是否被提供"（:283-285）——`hasOwn` 命中（`{x: undefined}` 确实有键 `x`），所以**不会**走"unknown variable"分支（:279-281 的名字校验: 名字必须匹配 `VARIABLE_NAME` 正则 :134）；
2. 但读取到的值是 `undefined`：:287-290 的检查 `if (value === undefined)` 命中 → 抛错（:289 行）；
3. 错误消息为：`` prompt variable "{{x}}" has no value for this assembly (section "a") ``（:289）。

**语义解读**：系统故意区分"**没有这个变量**"（unknown，`hasOwn` 不命中，走 :279-281 的校验/报错）与"**提供了但值为 undefined**"（:287-290 抛错）——变量提供方（`variable()` :446-455）返回 `undefined` 视为"本组装没有值"，而不是"值为空字符串"。想给空值请给 `''`，想不给请**不要注册该键**。顺带提醒：这与 `interpolate` 的 malformed 分支（:268-275，花括号不配对等）是两类不同错误，消息前缀不同。

**4. 用单测验证：注册一个 order 为 5 的 section 后，渲染结果位于 persona 段之后、工具段之前；再注册同名段，记录抛错文本。**

按题面要求给出**离线单测**（只构造 `SystemPrompt` 并 `assemble()`，不发起模型调用；本环境未构建运行，以下期望行为来自源码走读，**（未验证）**，题面已言明）：

```ts
import { Context } from 'cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
// 假定测试环境按仓库测试模式构造：见 packages/core/tools/tests/execution-mode.spec.ts:16-21 的 Context 模式

test('order 5 section renders after persona, before tools', async () => {
  const ctx = new Context()
  ctx.plugin(SystemPrompt)  // 纯 SystemPrompt：不含任何 tool-* 插件
  const sp = ctx.get('systemPrompt')
  sp.section({ name: 'mine', order: 5, text: 'X' })
  const result = await sp.assemble({ /* scope */ })
  const titles = result.sections.map(s => s.name)
  // 期望：-100 harness:identity → 0 deployment:persona → 5 mine
  expect(titles.indexOf('mine')).toBeGreaterThan(titles.indexOf('deployment:persona'))
  expect(titles.indexOf('mine')).toBeLessThan(titles.findIndex(n => n.startsWith('tool')))  // 工具段不存在时为 -1，见下
})

test('duplicate name in the same layer throws', () => {
  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  const sp = ctx.get('systemPrompt')
  sp.section({ name: 'mine', order: 5, text: 'X' })
  expect(() => sp.section({ name: 'mine', order: 6, text: 'Y' }))
    .toThrow(/prompt section "mine" is already registered/)
})
```

**期望行为推演**（源码依据）：`assemble` 收集 `sectionDefinitions`（:519-531 按 orderTools 排序 :529）；纯 `SystemPrompt`（未挂任何 tool-* 插件）下工具段为空，所以顺序为 `-100 harness:identity`（构造 :357-363）、`0 deployment:persona`（:364-369）、`5 mine`——**mine 位于 persona 之后**是必然（5 > 0），**位于工具段之前**的条件是"若存在工具段"，它们 order ≥ 100，恒在 5 之后。第二个测试：同层重名在 `NamedEntries` 构造时抛错（:316-318：``prompt section "mine" is already registered (for a per-agent override, register through that agent's `agent.ctx` instead)``）——注意错误消息正是题面想要的"记录抛错文本"；其实现是 `NamedEntries.insert` 的重名检查（:45 附近，`duplicateError`）。**（未验证：本机未构建，以上为源码推演。）**

### 综合层

**5. 写一个"把 baseURL 指向自建网关"的最小适配器方案，并论证为什么换 baseURL 不需要 `registration.replace()`，而换 retryPolicy 需要。**

**最小方案**：复刻 `llm-deepseek` 的 `apply` 接线（`packages/llm/llm-deepseek/src/index.ts:200-275`）：

```ts
// gateway-adapter.ts —— 以 llm-deepseek 为模板的最小网关适配器
import { Context } from 'cordis'
import { PROVIDER, PUBLIC_BASE_URL } from './constants'   // 自建网关的 provider 名与 baseURL

export const name = 'gateway-deepseek'
export const inject = ['config', 'llm', 'environment', 'logger']

export function apply(ctx: Context, config: GatewayConfig) {
  let current = config
  let lastRaw: unknown, lastGood: ResolvedOptions | undefined

  // options thunk：每请求快照；同 raw 直返缓存，失败保 lastGood（:204-222 同构）
  const options = (): ResolvedOptions => {
    const raw = current
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    const next = resolveAdapterOptions(raw)   // baseURL: config.baseURL ?? env ?? PUBLIC_BASE_URL（:185-187）
    lastRaw = raw; lastGood = next
    return next
  }

  const resolveApiKey = () => options().apiKey   // :225-246 同构

  ctx.llm.registerConfigurableProviders([{ id: PROVIDER, name: PROVIDER }])
  const registration = ctx.llm.registerAdapter([PROVIDER], makeAdapter({ options, resolveApiKey }))

  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])   // 唯一需要 replace 的事实
    registeredPolicy = policy
  }
  ensureRegistrationFacts()

  // 设置面板：改 baseURL / retryPolicy 都经 options() 取到（:270-275 同构）
  ctx.llm.installSettingsSection({ setSource: (src) => { current = src; ensureRegistrationFacts() } })
}
```

**为什么换 baseURL 不需要 replace**：baseURL 属于**每请求可重新解析的事实**——`options()` 是 thunk，在**每次请求时**求值（:204-222），LLM 层每次调用适配器都会调它（`prepareCall` / `stream` 路径），所以配置快照一变，下一次请求自动用新 baseURL（:185-187 的解析链：`config.baseURL ?? environment.get(BASE_URL_ENV) ?? PUBLIC_BASE_URL`）。它不参与注册时的"路由事实"。

**为什么换 retryPolicy 需要 replace**：retryPolicy 是**注册时被捕获**的事实——`registerAdapter` 的 `prepareRoutes` 在注册时读取并存入 `registration.retryPolicy`（`packages/llm/llm/src/index.ts:387-393`），此后每次请求用的是**注册表里的副本**（`prepareCall` :797 从 registration 取），`options()` 的刷新救不了它。`llm-deepseek` 的注释（:261-265）直言："The registry captures the retry policy at registration, so it is the one fact per-request resolution cannot refresh." 所以 `ensureRegistrationFacts` 检测到 policy 变化时调用 `registration.replace([PROVIDER])`——它把旧路由**替换**为新路由，且是**单同步段**完成（:263-266、llm/src/index.ts:405-413 的 `commitRoutes`），不存在"先 dispose 再注册"中间空窗（那样会发布一个空路由集，观察者会看到提供方消失又回来）。题面要求 `mode: 'always'` 即把 `retryPolicy` 配成 `{ mode: 'always' }`，令适配器层对每次失败都重试——这正是需要 replace 生效的那一档。

**6. 工具 schema 的 `parameters` 在 assemble 里被 `structuredClone`，试论证：若不做克隆，哪个环节可能篡改注册表的原件？**

**题面提示成立**。先确认两个瀑布的载荷边界：

- `agent/request` 载荷仅 `{ agent, turn, step, signal }`（`packages/core/agent/src/runtime-types.ts:244`），返回类型是 `LlmCallConfig`（`packages/llm/llm/src/call-config.ts:23-30`）——**没有 tools 字段**，所以在 `agent/request` 里根本接触不到工具 schema；
- `llm/stream` 瀑布的载荷是**请求对象本身**，含 `request.tools`，且已被 `deepFreeze` 深冻结（`packages/llm/llm/src/index.ts:52-64` 注释）。

**真正能接触到工具 schema 原件的两个环节**：

1. **`system-prompt/assemble` 瀑布（主要毒点）**：瀑布拿到的是**可变**的 `assembly`（返回值权威，system-prompt/src/index.ts:532-535）。`assemble` 在构造 assembly 时对每个工具的 `parameters` 做了 `structuredClone`（:498），恰恰是为了让瀑布**随便改写**而不污染注册表。**若不做这个克隆**：`assembly.tools[i].parameters` 与 `ToolRuntime` 注册表里存的 `parameters` 就是**同一个对象引用**（`schemaOf(definition, false)` 在 `detachParameters = false` 时直接返回注册表原引用，`packages/core/tools/src/index.ts:1258`，`wireSchemas` :984/:993 用的正是 false）——瀑布监听器原地 `assembly.tools[0].parameters.properties.x = ...` 就直接改写了注册表原件，之后的每次组装、每个 scope 都会看到被篡改的 schema。
2. **`llm/stream` 瀑布（次要毒点）**：请求对象已 `deepFreeze`，原地改写会抛错（不可变保护生效）；但 `deepFreeze` 是**递归**的——若 `request.tools[].parameters` 与注册表共享引用（没克隆时），deepFreeze 会**连带冻结注册表原件**（跳过 AbortSignal，:104）。于是注册表此后想调整/删除工具时，写操作在"已冻结对象"上静默失败或被严格模式抛错——这是一种更隐蔽的"篡改"（不是内容被改，而是内容被锁死）。此外，监听器若 `{ ...request }` 展开重建，`tools` 数组与 `parameters` 引用仍是共享的（浅展开不深拷贝），依然踩雷。

**结论**：克隆（:498 的 `structuredClone`）切断的正是"瀑布→注册表"的引用链；没有它，毒点就落在 **assemble 瀑布的原地改写**（直接污染注册表）或 **llm/stream 展开重建/冻结**（间接锁死注册表）上。两条都要防，但源头在 assemble——克隆放在组装点而非消费点，一劳永逸。

### 挑战层

**7. 设计一个"persona 每次组装从文件读取并缓存失效"的插件：说明把"读文件"放在 `section().text` 函数还是 `variable()` 里、缓存键是什么、如何让 HMR 换文件后下一次组装生效。**

**放 `section().text` 函数里**。理由：

- `text` 函数**每次组装都会被求值**（`assemble` 的 section 文本求值 :510-518 逐段调用 `section.text`，:514），"每次组装重新读文件"与需求天然吻合；
- `variable()`（:473-482）虽然也每次求值，但它的结果要再经过 `renderPrompt` 插值（:212-217），且受 `VARIABLE_NAME` 名字约束（:134）与"无值抛错"语义（:283-290）影响——把文件**内容**当变量会引入额外转义与约束；
- **关键**：persona 段的存在依赖**遮蔽语义**（练习 1：scoped 同名段 shadow 全局），要求"段落本身被替换"；`section()` 直接注册 `{ name: 'deployment:persona', order: 0, text }` 就是替换本人，而 `variable()` 只能改段内 `{{x}}` 的值——文件里面若是**整段人格文本**（含段落结构），放在 text 函数里才能原样替换整段。

**插件设计**（`text` 函数 + 缓存键 + 失效）：

```ts
ctx.systemPrompt.section({
  name: 'deployment:persona', order: 0,       // 与全局同名 → 遮蔽（scoped 注册）
  text: () => {
    const p = ctx.config.personaFile           // 绝对路径
    const st = statSync(p)                     // 每次组装一次 stat（自校验）
    const key = `${p}:${st.size}:${st.mtimeMs}`
    if (cache.get(key)) return cache.get(key)!
    const text = readFileSync(p, 'utf8')
    cache.set(key, text)
    return text
  },
})
```

- **缓存键** = 绝对路径 + `{ size, mtimeMs }`：stat 是自校验——文件内容变了（HMR 换文件）则 size/mtimeMs 变，键变，命中失败，重新读文件；不需要外部"通知"。
- **生效时机**：`assemble` 只在 `preStep`（`packages/core/agent-loop/src/agent.ts:230`）每 step 调用一次——所以 HMR 换文件后，**下一次 step 的组装**自然读到新内容，无需重启、无需手动失效。
- **与 `options()` thunk（:204-222）对比**：`options()` 是"**配置源**"的缓存——配置快照变更驱动失效，但它**不感知文件内容变化**（文件系统不是它的配置源）；`installSettingsSection` 的 `setSource`/`onChange`（:270-275）同理，回调只在**配置源变更**时触发。它们都回答"我的配置变了吗"，而文件场景回答"我读的这份文件变了吗"——后者必须 stat 自校验。
- **一个限制**：`PromptSection.text` 是**同步签名**（:67），`assemble` 不 await 它（:514）；若未来想支持异步读（如网络/超大文件），需预取（在 HMR 事件里提前读好）或 `fs.watch` 主动维护缓存，而不是把异步放进 `text`。

## 第 11 章　工具系统与执行流水线

### 理解层

**1. 某工具在 pre-execute 瀑布里被监听器拒绝，随后被瀑布更早的另一监听器"放行"。它的命运由谁决定？若换成守卫，答案会变吗？**

**瀑布：先拒绝者赢——"放行"不能翻案**。`pre-execute` 是瀑布（`packages/core/tools/src/index.ts:142-208` 事件块），瀑布语义是"**谁不调 `next()` 谁拍板**"：监听器按顺序被调用，每个都把管道交给下一个；一旦某监听器**返回决策（拒绝）而不调 `next()`**，瀑布就此终结，后面的监听器（包括更早注册的"放行"者——注意瀑布顺序与注册顺序相同）**不会再被调用**。更精确地说：监听器 A（放行）在监听器 B（拒绝）**之后**注册时，B 先被调用并拒绝，A 根本收不到这次调用。反之若 A 在 B 之前注册，A 放行（调 `next()`），B 拒绝——拒绝生效。"放行"永远无法**翻案**一个已经发生的拒绝；只有"显式 allow 且顺序在前"才可能短路（但也只是让 B 不再有机会拒绝）。这正是 `tools/execute` 的同义语义（:153-163 注释："wrappers may change only exec.signal"，同样谁不调 next 谁拍板）。

**守卫：答案会变——守卫是单调的、绝对否决**。`ToolGuard`（:703-711）定义为 `(execution) => string | undefined`，注释明说："Because guards have no allow result, listener ordering cannot turn a denial back into permission." 守卫**没有放行结果**：返回字符串 = 拒绝，返回 `undefined` = 不表态。在 `prepareExecution` 里守卫只在瀑布**放行**（`decision.kind === 'allow'`）时才被求值（:1486-1488 `guardReason(exec)`），一旦返回原因就 `materializeFinalResult` 成拒绝结果（:1489-1498）。所以：

- 守卫可以否决**任何**瀑布放行（哪怕瀑布全链条允许）；
- 瀑布放行**不能**否决守卫的拒绝——守卫是"一票否决"的最后一关；
- 同一层多个守卫：**任一守卫 deny 即 deny**（guardReason 的求值 :1119-1128 遍历守卫，遇首个原因即返回）。

一句话：瀑布的"放行"是**可以撤销的提议**，守卫的"拒绝"是**不可撤销的裁决**。题目场景换成守卫后，答案从"拒绝者赢"变成"拒绝者依然赢，而且更早的放行者连参与的机会都没有（守卫在瀑布之后）"。

**2. 什么是"规范值（value）"？为什么它"只在执行局部存在"，而 `content` 与 `meta` 可以持久化？**

**定义**：value 是执行局部的**规范值（canonical value）**——工具返回的**原始程序化数据**（如 `read` 返回的 `{ text }` 对象、`bash` 返回的 `{ code, stdout, stderr }`）。`ToolExecutionSuccess.value` 的注释（:558）写明："Execution-local canonical value; deliberately omitted from durable events." ——它是"标准答案"，但**刻意不写进持久事件**。`materializeFinalResult`（:1861）进一步说明：value 只在最终**内存结果**里存在。

**三件套 vs 两件套**。工具的最终结果有三层（`createSuccessResult` :1792-1823 四步：snapshot → validate → deepFreeze → render，; 其中 render 产出 content/meta）：

| 字段 | 是什么 | 谁消费 | 持久化 |
|---|---|---|---|
| `content` | 模型可见的**文本投影**（渲染后的 assistant 消息内容） | 模型（回放时模型看到的必须与当初一致） | ✅ 随 `tool/result` 持久 |
| `meta` | 呈现载荷（`presentationMeta` :1805-1814 的快照，供 UI 桥接重放卡片） | UI（"persisted so a UI bridge reproduces the card on replay"，tool-calls.ts:285-287） | ✅ 随 `tool/result` 持久 |
| `value` | 程序化**原始 JSON**（执行局部规范值） | 程序（post-execute 监听器、`normalizeDispatchResult` 按它重建 :1825-1844） | ❌ 刻意不持久 |

查看 `appendToolResult`（tool-calls.ts:281-288）可证实：持久事件里只落 `message`/`content`/`isError`/`error`/`meta`，**没有 value**。

**为什么 value 不持久**：回放时——UI 需要 `content + meta`（重建卡片与消息流），模型需要 `content`（看到当初的文本）；而 value 是**程序间数据**，是给当前进程里的下游监听器（post-execute 可以整体替换结果 :1764-1775）用的"原始物质"。它可能含有不可序列化对象（Buffer、大字符串、私密内容），且每次执行都是新的快照（snapshot 一步 :1792-1823），持久化它既重又无消费者。让 value 只活在执行局部，是"**日志保真（content/meta）、运行保活（value）**"的分工。

### 应用层

**3. 按仓库测试模式写一个约 15 行的测试：注册一个 `isConcurrencySafe` 抛异常的工具，断言 `executionMode` 返回 `exclusive`。**

按 `packages/core/tools/tests/execution-mode.spec.ts` 的模式（setup :16-21：`new Context()` → `plugin(SystemPrompt)` → `plugin(ToolRuntime)`；exec 助手 :23-25），仿 :81-93 的"raw classifier 抛错"变体：

```ts
import { Context } from 'cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, executionMode, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { expect } from 'vitest'

test('a throwing isConcurrencySafe classifier fails closed to exclusive', async () => {
  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  const tool: ToolDefinition = {
    name: 'boom',
    description: 'a tool whose classifier throws',
    parameters: { type: 'object', properties: {}, required: [] } as never,
    isConcurrencySafe: () => { throw new Error('classifier exploded') },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),   // 不会走到这里
  }
  const exec = {
    tool,
    agent: ctx,          // 按 spec 的 exec 助手形态（:23-25 参考）
    callId: 'call-1',
    arguments: {},
  } as never
  // executionMode 只调用分类器，不调用 execute
  expect(await executionMode(exec)).toEqual({ kind: 'exclusive' })
})
```

**推演**：`executionMode` 的 fail-closed 语义（`packages/core/tools/src/index.ts:1269-1285`）——分类器计算结果必须**精确等于 `true`** 才返回 `{ kind: 'parallel' }`，其余（包括**抛错**）一律 `{ kind: 'exclusive' }`；实现上以 `try/catch` 包裹（:1282-1284），异常即视为不安全。因此断言 `toEqual({ kind: 'exclusive' })`。注意与 spec 中 :81-93 的对照：那是"throwing raw classifier"用例，正是本题所仿。**（未验证：本环境未构建运行，按仓库测试模式编写；断言依据为 :1270-1284 的源码走读。）**

**4. 给 11.2 的 `read_file` 工具加上 `timeoutMs: 5000`，在 `timeout-policy` 已挂载的前提下说明：谁读 `timeoutMs`、谁换 `signal`、结果由谁替换成 `TOOL_TIMEOUT`。**

`timeout-policy` 是**横切层**——它不要求你改工具实现，只需在注册时携带 `timeoutMs` 元数据：

```
timeout-policy:
  timeoutMs: 5000        # 读它的是 timeout-policy 插件自身
```

**谁读**：`timeout-policy` 挂载在 `tools/execute` 事件上（`packages/bundle/base/cordis.patch.yml:343-344`），从 `exec.timeoutMs` 读取（其 `timeoutMs` 读取处 :57）；`timeoutMs` 是**策略元数据**，不是模型可见的 schema 字段（`tools/README.zh.md:99`）——注册时由 `register` 校验（:1046-1050）。

**谁换 signal**：包装层在 `next()` 前把 `exec.signal` 换成自己的 deadline 信号（`deadline` 计算 :61、换信号 :65-66），即"在进入工具主体之前，注册表立即将调用方的原始信号重新合并到当前信号中"（`tools/README.zh.md:26`——这是 `tools/execute` 契约：包装层**只能替换 signal**，:155-161，且不得改 `exec.arguments`/`callId`）。

**结果由谁替换**：若在 deadline 内未完成（`timeoutOf` 判定 :73-75），包装层把结果**替换为** `toolTimeoutResult`（:74）——错误码 `TOOL_TIMEOUT`（:25/:46）；`finally` 里还原原 signal（:77-79）。工具本身的 `execute` 看不到超时（它只在被中止后回来）。

**关键纪律**：超时与取消是**两个信号源的竞速**——`timeout-policy` 把"限时"表达为"换一个更早到期的 signal"，而不是改 `arguments` 或直杀线程；这是第 11 章"around 包装只能换 signal"的活样例（对照 `fuseToolSignals` :1889-1916 的语义）。

### 综合层

**5. 需求："只允许在 `/workspace` 下写文件。"评估 `tools.restrict`、`tools.guard`、`tools/execute` 包装三条路径，指出哪条做不到、为什么。**

**`tools.restrict`——做不到**。`restrict`（`packages/core/tools/src/index.ts:1064-1098`）是**可见性过滤**，不是权限：`README.zh.md:22` 明说"restrict 是实时可见性组合，不是权限边界"。三个硬伤：① 它必须 scoped（:1072-1075，`restrict` 只接受 `{ scoped: true }` 形态），是给子代理/子 scope 减配的；② 它的谓词**按工具名**匹配，没有参数级判断（一个 `write` 工具要么全部可见要么全不可见）；③ 更根本的——**工具必须先可见才可能被执行**，而"只在 /workspace 下写"需要的是**参数级**裁决（`path` 字段），restrict 恰好没有这个刀。它能让"写工具不可见"（干脆不给模型），但做不到"写得见、但只在白名单路径下写"。

**`tools/execute` 包装——也做不到门禁**。`tools/execute` 的契约（:155-161、README.zh.md:26/:58）：环绕包装层**只能替换 `exec.signal`**，不能拒绝、不能改参；而且它运行在**门禁之后**（:1573-1576，已过 pre-execute 与守卫），只是一个"执行期信号注入点"（超时、取消）。在它里面做路径判断，等于"先放行再拦截"——没有拒绝通道。

**`tools.guard` / `pre-execute`——能做到**。这两者位于**门禁**（参数已解析并深冻结 :1416）：`guard` 返回字符串即拒绝（:703-711），可以检查 `exec.arguments.path` 是否以 `/workspace` 开头并以拒绝收场——正是"运行时拦"；`pre-execute` 瀑布可以 `deny`/`ask`（`PreToolDecision` :588-591 的形态）。注意守卫**不能改参**（返回 `string | undefined`，:711），只能拒/放；若需求是"把越界路径改写为工作区内路径"则要改用 pre-execute 瀑布的返回值（它可返回新决策）。**结论：只有 guard/pre-execute（门内、参数级）能实现；restrict（可见性）与 tools/execute（只换信号、门后）都做不到。**

**6. 子代理的 `toolFilter` 在 `packages/subagent/subagent/src/child-agent.ts:174` 落成 `childCtx.tools.restrict(...)`。从 `view()` 的自身层豁免规则论证：为什么子代理自己的"汇报/结构输出"工具不能被父代的过滤器剪掉？**

**先看 `view()` 的设计**。`view()`（`packages/core/tools/src/index.ts:1130-1193`）计算"某 scope 可见的工具集合"时有一条**自身层豁免**（:1137-1142、:1176-1183）："A restriction filters what a scope **inherits**…never what its **OWN** layer registers." 注释更直白（:1140-1142）：delegation runtime 把子代理的汇报/结构输出工具注册进子代理的 **own 层**。`view()` 的求值结构是：`own = peek()`（:1158，本层自己注册的）、`inherited`（:1161-1165，从祖先层继承的）、两者**交集/合取**（:1169-1174）——**restrict 只作用于 inherited 那一支**（`child-agent.ts:174` 的 `restrict(composition.toolFilter)` 只约束继承面），own 层工具不过滤。

**为什么必须这样**。子代理的运行依赖两类"自备"工具：**汇报工具**（把结果报回父会话）、**结构输出工具**（按 `outputSchema` 产出结构）。它们注册在子代理 own 层（delegation runtime 注入，:1140-1142），是子代理角色的**生存必需品**。若父代过滤器能剪掉它们：子代理要么无法汇报（活干了却交不了差），要么无法结构化输出（能力声明 false 却拥有该字段）——子代理就"哑了"。`view()` 的豁免规则等价于"**过滤器剪的是你继承来的能力，不是你的本体**"。

**历史教训佐证**（:1144-1148 注释）：presets 曾把这类工具移到 **agent plane**（父代/祖先层），于是子代理的 restrict 立刻把它们当成"继承来的"剪掉了——过滤器"silently stopped constraining anything it was given"（实际效果变成悄悄失效/剪错对象）。把工具放回 own 层 + 自身层豁免，才让"过滤继承面"与"保留本体"同时成立。所以答案是：**豁免不是特权，而是本体工具的位置决定的**——它们不在继承面，过滤器（只作用于继承面 :1168-1174）碰不到它们。

### 挑战层

**7. `fuseToolSignals` 不用 `AbortSignal.any`。论证：若某包装在 `next()` 返回后不还原 `exec.signal`，`tools/post-execute` 的监听器会看到哪个信号，可能造成什么错误？**

**先看正常通道**。`dispatchToolBody` 里：`fuseToolSignals` 把"原始调用方信号"与"包装层当前信号"融合（:1536-1537），在**进入工具主体前** `exec.signal = wrappedSignal`（:1544），工具返回后 `finally` 里 `fused.dispose(); exec.signal = wrapperSignal`（:1558-1559）——注意：**还原的是 `wrapperSignal`**（进入主体前的那个），不是 caller 原始信号。

**若不还原**：`exec.signal` 停留在**包装信号**（wrapperSignal 或 fused 的结果）。`tools/post-execute` 的监听器看到的就是这个"残留的、部分注入的信号对象"。后果分两层：

1. **信号失真**：监听器拿 `exec.signal` 判断取消（`aborted`/`reason`），看到的是**被包装过**的信号——若包装是超时（`timeout-policy` 的 deadline 信号），凡是"读 `exec.signal` 判取消"的监听器都会**误以为调用已被取消**（其实只是超时）；若包装是另一个取消信号，嵌套的 deadline 会在对方包装里**立即误判为已中止**（两重 deadline 互相传染）。`tools/result` 的观察者也会拿到**错误信号**做审计/统计（把超时记成取消）。
2. **为什么 `callerCancelled` 复查不受污染**：`callerCancelled`（:1509-1515）用的是 `cancellationStates` 里的**原始 caller signal**（不读 `exec.signal`），且 `prepareExecution`/`dispatchToolBody` 内部取消复查（:1592-1594、:1612-1616）也基于原始信号——所以**结果分类仍是对的**（取消 vs 正常 vs 超时由 caller 信号决定）；坏的是**观察面**（post-execute、tools/result 的监听器）。

**正确写法**：对照 `timeout-policy`（:65-66 换信号处保存 upstream、:77-79 `finally` 还原）——"保存 upstream + finally 还原"；`fuseToolSignals` 自己（:1890、:1912-1913）用**同引用直返 + one-time 监听**而非 `AbortSignal.any`，注释（:1885-1888）说明原因：`AbortSignal.any` 会产生**嵌套的 listener 链**（any 的结果信号又挂监听，层层叠加）且**监听器泄漏**（复合信号不随子信号 cleanup）；one-time 监听 + dispose 保证每次融合都干净拆除。

**8. 设计一个策略：让工具 A 与工具 B 永不并行、但 A 与 A 可以并行。它需要改 `executionMode` 吗？给出方案并指出它落在流水线的哪一站。**

**不需要改 `executionMode` 的核心语义，但需要扩展分类器的信息面**。`executionMode`（:1269-1285）按**单次调用**分类：分类器只有 `arguments`，**没有批内视野**（它不知道同一批里还有谁）——而"A 与 B 互斥"恰恰是**批内**约束（同一批里有 B 时 A 要串行；只有 A 时 A 们可并行）。因此按调用分类等价于"状态无关分类"，天然做不到；必须把**批内冲突信息**带到分类现场。信息落点有两个：

- **分组点**：`packages/core/agent-loop/src/tool-calls.ts:88-89`（`executionMode` 决定 `group`，`mode === 'exclusive'` 时 `group = [first]`——含 B 的批会**整体串行化**，后续 call 留到下一轮 :89）；
- **重分类点**：:203-204（滚动池每次启动前**重新分类**，此刻批内容已变）。

**方案一（核心级改动，干净但动 core）**：在 `runGroup` 增加一层"冲突表"——注册工具对 `(A, B)` 的互斥关系（或由 `isConcurrencySafe(comments)` 升级为 `executionMode` 接受**批内上下文**参数），分组时若"group 里已有 B 且当前是 A"则把 A 排到下一轮。优点：语义精确（分组与重分类都在调度层），缺点：改核心（`tool-calls.ts` 与 `executionMode` 签名）。

**方案二（插件级，不动 core，靠 in-flight 状态）**：让 `isConcurrencySafe` 读一个**外部 Set**（记录正在 running 的工具名），A 的 classifier 在"Set 含 B"时返回 false；B 同理。这样：同一批纯 A → 全并行（Set 里无 B 时 A 们互不干扰）；批含 B → B 启动后 Set 置位（由 `tools/execute` 或 `tools/result` 维护），后续 A 的 classifier 读到 B 在跑 → 返回 false → 独占。**为什么不动 core 就够了**：分类只发生在 :88 与 :203-204 两个时点，每次启动前都会重分类；in-flight Set 在两次分类之间保持"最近事实"。**代价/竞态**：① 分类与启动之间有窗口（B 即将启动但 Set 未置位时 A 分类放行——可以接受"批内首轮"竞争，或把置位提前到 `tools/pre-execute`）；② 归类时 :203-204 的重分类时机若晚于 B 的实际启动，仍可能放 A 出去；③ Set 要严格配对（`tools/result` 清理或 with-finally）。

**对比取舍**：方案一语义最强（冲突表在调度器内部），方案二零核心改动但依赖"外部状态与调度节奏"的匹配。**守卫/pre-execute 都做不到**"不并行"——它们只有拒绝/放行，没有调度权（"不并行"是调度分层的职责，`tools/execute` 包装也只能换信号）。最后提醒：方案二里"含 B 的批整体串行化"与"A 与 A 并行"的组合行为，要按 :89 的 `group=[first]` 语义反复确认——独占模式下 B 会把整批拖到下一轮，可能比你预期的"只串行 A-B"更保守。

## 第 12 章　能力 Seam 全景：三种角色一种思想

### 理解

**1. 用自己的话向同学解释"为什么 `ctx.fs` 一个上下文只允许一个实现是特性而非缺陷"，并引用源码依据。**

**先讲机制**。`FileSystem` 抽象类构造时调用 `super(ctx, 'fs')`（`packages/fs/fs/src/index.ts:87-89`）——这是 cordis 的 **Service Definition** 注册：一个上下文（Context）里，**一个服务键 = 一个槽位**。`ShellExecutor` 同样（`packages/shell/shell/src/index.ts:67`），且模块注释（:48-50）直说："one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior."——再加载一个实现会**直接抛错**，这是 cordis 的标准行为，不是 bug。

**为什么是特性**。三个角度：

1. **替换 = 换人，不是叠加**。正因为一个键只有一个实现，"换 fs 提供方"才是**原子**动作：`fs-sandbox` 取代 `fs-local`，就是`ctx.fs` 槽位上换了一个对象，**没有新旧并存、没有优先级、没有回退链**（无从"两个 fs 谁先谁后"）。若允许多个实现，你就得发明一套"路由规则"（按路径？按调用方？），而所有消费方（`tool-fs`、观察策略等）都在 `ctx.fs` 这一个槽位上取——多实现会立刻让"我读到的文件到底来自哪个 fs"成为歧义。
2. **消费方不关心提供方**。消费方只看**接口**：`ToolExecutionInput` 只认工具名与参数（`packages/core/tools/src/index.ts:314-338`），`ctx.fs.readText` 的调用方不知道底层是本地、沙箱还是远程——单实现 + 单接口 = **提供方可换、约定不变**，这正是 seam（接缝）的全部意义。
3. **多路能力是刻意区分**。唯一性并非绝对教条：`terminal` 走**注册表-后端**模型（`registerBackend` 按 backend 名注册多个，`packages/terminal/terminal/src/index.ts:125-129` 重名才抛 `DUPLICATE_BACKEND`）——因为"多个终端后端"是**并行存在**的真实需求（本地/PTY 并存）。而 fs/shell/subprocess/sandbox 这类"**基础载体**"（一个执行世界只有一份），单实现才是对的。区分标准就一条：**这是"一个资源的多家供货商"还是"同一个资源的多个实例"**——前者多路，后者单例。

**一句话**：单实现是"槽位语义"——服务键即契约，契约只有一份实现，替换即换人；多实现会让"我用的到底是谁"进入运行时，而这是设计上要根除的歧义。缺陷的说法成立，只在你**错把两个不同的资源**（本地 fs 与远程 fs）当成"同一个 ctx.fs 的两个选项"——它们应该是**两个不同的上下文/进程**，各自槽位上各一个实现。

**2. 在 12.1 的八 seam 表中挑选三行，找出它们各自的"错误码封闭联合"定义位置，并说明错误码为什么必须归定义包。**

八 seam 表中试选三行（fs / terminal / codeRuntime），各自的错误码封闭联合：

| seam | 错误码联合 | 定义位置 |
|---|---|---|
| **fs** | `FsErrorCode`（**13 个码**：如 `FS_NOT_FOUND`、`FS_SANDBOX_DENIED`、`FS_STALE_VERSION`…） | `packages/fs/fs/src/types.ts:175-188` |
| **terminal** | `TerminalErrorCode`（**8 个码**：`DUPLICATE_BACKEND`/`NO_SESSION`/`SEND_ACTIVE`…） | `packages/terminal/terminal/src/index.ts:55-63` |
| **codeRuntime** | `CodeRunFailure.kind`（**6 种**：`exception`/`timeout`/`abort`/`worker-exit`/`invalid-output`/`output-limit`） | `packages/code-runtime/code-runtime/src/types.ts:105`（附带形态差异：错误是**结果的一个字段**而非 `run()` 的 rejection，:110-114） |

**为什么必须归定义包**（即"词汇归定义包"原则），三层理由：

1. **按 code 分流、不解析消息**：消费者处理错误时用 `error.code` 做判别（fs/types.ts:170-174 的注释正是"按 code 分流"的设计说明；`FsError` 的注释 :190-194 说明该类型就是为"程序化处理"而生）——消息文本是给人看的（本地化/措辞可改），code 是给程序用的（稳定）。把 code 放在**提供方包**里，换了提供方（fs-sandbox → fs-local）代码不变；若放在实现里，换人即换码。
2. **封闭联合 + 穷尽检查**：`type` 字面量联合 + `assertNever` 能在**编译期**强制"新错误码必须被处理"（switch 漏掉一种直接编译错误）——这是封闭联合的最大红利：提供方加新码 → 定义包加字面量 → 所有消费方编译失败提醒，而不是运行期悄悄漏判。
3. **提供方换人、模型所见不变**：错误码是**契约词汇**，属于定义包（seam 的"词汇"角色）；提供方只是"词汇的兑现者"。模型（消费方之一）通过工具错误消息看到的是**同一个词汇表**，所以换实现不影响模型行为——这与第 12.1 小结"三角色蓝图"（定义包定词/提供方实现/消费方使用）一一对应。

### 应用

**3. 写出把 `fs-sandbox` 换回 `fs-local` 的最小 patch，并说明 `read`/`write`/`edit` 三个工具的行为哪些会变、哪些不会。**

**先定位**：`base` 组合包默认挂 `fs-sandbox`（`packages/bundle/base/cordis.patch.yml:443-444`）；`headless-agent` 独立组合**本来就用 fs-local**（`examples/headless-agent/cordis.yml:156-159`，形态：`id: fs-local`、`name: '@deepseek-ai/dsh-fs-local'`、`config: { cwd: !!js process.cwd() }`）——它就是"换回 fs-local"的现成样例。

**最小 patch**（在 base 之上）：

```yaml
# cordis.patch.yml（在原本挂 fs-sandbox 的位置替换）
- id: fs-local
  name: '@deepseek-ai/dsh-fs-local'
  config:
    cwd: !!js process.cwd()
```

（若 base 的 fs-sandbox 条目仍在，需先 `disabled: true` 禁用它——**单一 ctx 槽只允许一个实现**，两个都挂会因重复服务抛错，见练习 1。）

**行为变化分析**：

| 工具 | 变还是不变 | 细节 |
|---|---|---|
| `read` | **不变** | fs-sandbox 的"读直通"（`packages/fs/fs-sandbox/src/index.ts:7-8`："Reads pass through untouched: every mode permits reading"），换回 fs-local 后读依然无围栏，语义一致 |
| `write` | **变** | ① 取消沙箱围栏：不再有 `read-only → FS_SANDBOX_DENIED`、`workspace-write` 工作区/临时区围栏、`danger` 直放的区别——路径**越界时错误从 `FS_SANDBOX_DENIED` 变为 OS 级**（`FS_PERMISSION_DENIED`/`FS_NOT_FOUND`，且只有 OS 真的拒绝才报）；② **schema 变化**：fs-sandbox 覆写 `sandboxMode`（fs-sandbox :69-71），`tool-fs` 以 `ctx.fs.sandboxMode` 为门槛宣传 `sandbox_permissions`/`justification` 升权字段（`packages/fs/tool-fs/src/index.ts:75` 注释"all keyed off whether the mounted ctx.fs confines (ctx.fs.sandboxMode)"、`write.ts:53` 字段与 `:75` 的 `schemaFields()` 展开）；fs-local 的 `sandboxMode` 默认 `undefined`（`packages/fs/fs/src/index.ts:91-105`），**这些字段从工具 schema 消失**——模型可见的工具描述变了 |
| `edit` | **变** | 同 write：无围栏、错误码回落到 OS 级（FS_NOT_FOUND/FS_STALE_VERSION 等底层码仍保留，但"沙箱拒绝"不复存在） |

**不变的**：工具 schema 主体（名称/描述/参数结构除了上述升权字段）；结果三件套（content/meta/value 契约不变）；**若 `fs-observation-policy` 保留**（它注册在 fs 事件上、非服务，`packages/fs/fs-observation-policy/src/index.ts:1-8`），读后写版本防护（`FS_NOT_OBSERVED`/`FS_STALE_VERSION`）依旧生效；tool 层（`tool-fs`）不感知提供方是谁——它只调 `ctx.fs`。

**注意**：这不只是"少一道检查"——`sandbox_permissions` 字段消失意味着模型**措辞**也变（升权引导没了），这是"提供方改变模型可见契约"的活例：seam 替换不是纯内部操作。

**4. 设计一个"shell 只允许白名单命令"的策略插件。提示：占 `tools/pre-execute` 瀑布，或换一个继承 `LocalBashExecutor` 的提供方；比较两种方案各需要哪种注入。参考"策略三形态"自检。**

**方案 A：占 `tools/pre-execute` 瀑布（瀑布形态）**。

```ts
export const inject = ['tools', 'systemPrompt']  // 需要工具运行时与系统提示（可选）
export function apply(ctx: Context, config: { allow: string[] }) {
  ctx.tools.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'bash' && Array.isArray(exec.arguments?.command)) {
      // command: string[]（BashToolArgs.command 是数组，packages/shell/tool-bash/src/index.ts:46）
      const [program] = exec.arguments.command
      if (!isWhitelisted(program, config.allow)) {
        return { kind: 'deny', reason: `command "${program}" is not allowed` }  // PreToolDecision 形态
      }
    }
    return next()
  })
}
```

- **注入**：`tools`（事件/瀑布）、`config`（白名单）；若想给模型提示可再注入 `systemPrompt` 加一段说明。
- **语义位置**：门内、参数已解析（`arguments` 深冻结 :1416），可 deny 可 ask（`PreToolDecision` :588-591）；优点：统一入口、不需要动 shell 实现；缺点：**模型仍能"看到"全部命令**（schema 不缩水，只是执行被拦），且它属于组合层策略（挂在瀑布上），不是 shell 层语义——**任何更早的 allow 短路都影响不到它**（瀑布"先拒绝者赢"，deny 在就生效），但守卫若配了会更严。

**方案 B：继承/包装 `ShellExecutor` 的提供方（argv 包装形态的近亲）**。`ShellExecutor` 是抽象类（`packages/shell/shell/src/index.ts:65-101`：`resolve` :85 生成 execution spec、`run` :93、`start` :100），且 **`ctx.shell` 只允许一个实现**（练习 1 的单槽语义）——所以必须"**继承原实现 + 包装**"（装饰器模式），而不是再加一个实现（再挂一个会抛重复服务错）。

```ts
export class WhitelistShell extends LocalBashExecutor {
  constructor(ctx: Context, config: WhitelistConfig) { super(ctx, config) }
  override resolve(...args): ShellSpec {
    const spec = super.resolve(...args)         // 先得到正常 spec
    if (!isWhitelisted(spec.program, config.allow)) throw new ShellError('COMMAND_NOT_ALLOWED')
    return spec
  }
}
// 挂载：把 cordis.yml 里的 bash-local 换成 whitelist-shell（id/name/原生注入 config/子实现）
```

- **注入**：`config`（白名单）+ `shell` 基类所需注入；不需要 `tools`——因为裁决发生在 shell 层。
- **语义位置**：`resolve()` 生成 spec 时（shell 层语义）或 `run()` 前校验并抛错；优点：**策略随提供方走**——任何走到 `ctx.shell` 的调用都被拦（不依赖瀑布有没有人监听）；缺点：要写一个完整提供方、要在组合里替换条目。

**自检（策略三形态）**：方案 A = **瀑布形态**（有机组合、可叠加、模型可见性不变）；方案 B = **"提供方内实现策略"**（近 argv 包装形态——把策略钉进 spec 生成处）。都没有脱离三形态。若选 B，注意它**不再能 ask**（shell 层没有审批通道），只能拒绝——需要"ask 允许一次"的企业场景应选 A 或 A+B 配合（A 问、B 兜底）。

### 综合

**5. 解释 `examples/headless-agent/e2b.cordis.yml` 的 one-world 不变式；若只把 `subprocess` 换成 `subprocess-e2b` 而保留 `fs-local`，预测 `bash` 工具与 `read` 工具各自的行为，并指出哪类错误先出现。**

**one-world 不变式**（`examples/headless-agent/e2b.cordis.yml:5-9` 原文）："One-world invariant: **e2b.cwd, sandbox-policy.workspaceRoot, and bash-local's default workdir (implicit host process.cwd()) must all name the same remote directory.** Only e2b.cwd is created at sandbox open; dropping its `!!js` line falls back to `/home/user/workspace` while Bash and PTY keep targeting the host path, so every tool call fails with a remote spawn error." ——文件系统、进程执行与工作目录必须指向**同一个执行世界**（要么全是远程沙箱，要么全是宿主），否则"模型眼里一个文件在 A 处、实际执行在 B 处"，读写的文件与执行的环境对不上。e2b 的 patch（:10-57）因此是成组的：disable subprocess-local/fs-local（:15-20）→ insert e2b/subprocess-e2b/fs-e2b/sandbox-policy(danger-full-access, workspaceRoot=cwd)（:22-35）——**三件一起换**。

**只换 subprocess 的预测（破不变式）**：`bash` 工具经 `subprocess-e2b` 在**远程沙箱** spawn：它拿到的工作目录要么是 `e2b.cwd`（`/home/user/workspace` 一类的远程路径），要么是主机路径——而**远程沙箱里不存在主机路径**，于是 **`bash` 先失败**：spawn 时"远程 cwd 不存在/路径无意义"，e2b 注释（:9）说得很死："every tool call fails with a remote spawn error"。同时 `read` 工具仍走 `fs-local` **读宿主磁盘**——它"看起来正常"，但读到的是**宿主**文件，与 bash 所见（远程沙箱）**不是同一个世界**：模型可能先 `read` 到一段"存在"的代码（其实只存在于宿主），再用 `bash` 去跑，得到"文件不存在"——两个世界的矛盾以**最误导**的方式呈现（读成功、跑失败）。**结论：bash 类错误先出现（远程 spawn/路径不存在），read 不会报错但语义已错**——这正是 one-world 要防的"半搬家"事故：**只换一半的 seam，等于把模型放进一个文件与进程不一致的世界，失败方式还是"先让你以为成功"**。

**6. 结合 12.7 与 `packages/bundle/base/cordis.patch.yml:196-205`，说明"read-only"预设为什么必须绑定 `approval: ask` 而不是 `never`。**

**先看预设定义**（cordis.patch.yml:196-205）：

```yaml
presets:
  read-only:        { sandbox: read-only,  approval: ask }   # :197-199
  workspace-write:  { sandbox: workspace-write, approval: ask }
  danger-full-access: { sandbox: danger-full-access, approval: never }  # :203-205
```

**为什么 read-only 配 ask**：read-only 只约束**写执行**（沙箱在**执行时**拒绝写：`FS_SANDBOX_DENIED`），但**写工具仍然可见**——模型**照样会请求写**（它看到 `write`/`edit`/`bash` 在工具表里）。此时：

- `approval: ask` → 每次写请求都触发 `approval/request`，把决定权**交给人**（`approval/request` 语义 'ask'：委托应答方链；**无应答方则 fail-closed 为 `unavailable`**，`packages/interaction/user-approval/src/index.ts:88-90、:304-344`）——人是看门人：可以放行这一次，也可以拒绝；即使沙箱最终也会拒，ask 至少创造了**人知道、人裁定**的机会。
- `approval: never` → 写请求被**确定性拒绝**（user-approval :307-312：'never' 在派发**前**裁决，且注释说"only the service's own request path can"保证确定）——**静默地拒绝**：没有人进来"看一眼"就被扔掉了。这有两个坏处：① **无门可看**——只读模式下模型碰写是常态（不是异常），应该给人"机会看到模型想干什么"（放行一次或教它别写），never 把学习机会也掐了；② **与 full-access 不可区分**——danger-full-access 配 never（:203-205）是"放行一切、无需问"；read-only 也配 never 是"全拒、也无需问"，两者在**审批行为**上看起来一模一样（都是"不问"），只有执行结果不同，运维根本无法从审批流区分"这是只读环境"与"这是完全放开环境"。

**为什么 never 只适用于 full-access**：base 的 approval policy 表达式（:191）已经把 never 绑定给 `danger-full-access`（`DSH_PERMISSION_MODE === 'danger-full-access' ? 'never' : 'ask'`）——逻辑是：**只有没有任何写风险时，才不需要问**；只要是"有写能力但受限制"的模式，问一句的成本远低于静默拒绝的代价。一句话：**ask 是"有风险时的看门"，never 是"无风险时的免打扰"；read-only 有写风险（模型会请求写），所以必须 ask。**

### 挑战

**7. 通读 `packages/fs/fs-observation-policy/src/index.ts` 的 `apply`（:106-129）并回答：为什么 `fs/observed` 监听器"必须同步且非抛出"？如果把 `gate.observe` 改成 `await` 一个异步函数，写防护的正确性会以何种方式被破坏？**

**事实基础**（fs-observation-policy/src/index.ts）：

- `apply` 注册的三个监听器（:119 写意图、:122 编辑意图、:127-129 观测）都走**微任务派发**：单槽意图监听器自己也用 `Promise.resolve().then`（:116-118、:119、:122）——整个 fs/* 事件域是**同一种时序**（microtask 队列）；
- `fs/observed` 监听器职责：`gate.observe(target, observation, actor)`（:127-129），注释（:124-126）原文："fs/observed must remain **synchronous and non-throwing**: emit does not await promises, and **successful mutations have already committed**."；fs 事件声明（`packages/fs/fs/src/index.ts:67-76`）同样规定："Listeners must be synchronous recorders: throws fail the tool call and returned promises are not awaited."

**若 `gate.observe` 改为 `await` 一个异步函数，正确性被三路破坏**：

1. **时序确定性丢失（核心）**：`emit` 不等待（fs 事件契约），`await` 的观测在**微任务/更晚**才落地；而下一个 `fs/write-intent`、`fs/edit-intent` 也走微任务派发——**观测与意图的先后次序不再确定**。读后写防护（ObservedStateGate 的核心不变量：写前必须 observed，否则 `FS_NOT_OBSERVED`/`FS_STALE_VERSION` 拒绝，:82/:85）依赖"**先 observe、后 intent**"的严格顺序；异步后意图可能**基于旧观测**：要么**误拒**（明明刚读过，却报未观测/版本过期），要么在**无 CAS 后端上静默覆盖**（观测丢在意图之后，写直接提交，无人察觉）——防护从"确定"变"碰运气"。
2. **异步抛错变成 unhandled rejection**：`emit` 语义下，监听器返回的 promise 无人 await，异步抛错**不会被工具调用方看到**——错误溜进事件循环，表现为"写已提交，但观测丢失/失败"——**静默的数据完整性事故**，比同步抛错更糟。
3. **即使同步抛错也救不回来**：fs 事件注释说"throws fail the tool call"——同步抛错确实会让**工具调用失败**，但 `fs/observed` 发生在**成功突变之后**（观测在写/编辑成功提交后记录，:119-122，注释 :124-126："successful mutations have already committed"）——**提交已发生，回滚不可能**；错误只能让工具"报失败"，但文件其实已经写了。所以"非抛出"不是风格偏好，而是"**事后记录的审计步骤不许炸**"：它炸了，你不能撤销，只能制造"报告与事实不符"。

**一句话**：`fs/observed` 是写提交后的**同步记账**；把它异步化 = 把"读后写防护"从确定的顺序保证降级为竞态，并把审计失败从"可区分"变成"不可见"——两条都是数据完整性层面的退化。
## 第 13 章　多智能体与任务组织

### 理解

**1. 对照表 13-2，说明为什么 `subagent-acp` 的 `capabilities` 全是 false，而 `spawn` 全 true——并指出服务端的拒绝时机。**

先明确"能力位"是什么：`SubagentCapabilities` 是四个布尔（`packages/subagent/subagent/src/types.ts:86-91`），对应子代理会话的四项可兑现承诺——结构化输出（outputSchema）、深度上限（递归预算 maxDepth）、工具过滤（toolFilter）、人格（persona）。它是提供方**自报的"可兑现性"**，不是愿望清单：声明 true 就必须在运行期真的做到，声明 false 就表示"我做不到，别派这类活"。

**`spawn` 为什么全 true**。`subagent-spawn-in-process` 在宿主进程内直接走共享驱动 `startInProcessRun`：子代理就是同一个 dsh 里再创建的一个 agent，所以四项都能兑现——结构化输出由 in-process driver 的捕获运行时支撑、递归预算在共享驱动里强制校验（子深度 = 父深度 + 1，持久化进子会话 header）、工具过滤与 persona 在"未发布设置窗口"装好后才发布子 agent。因此能力声明全 true（`packages/subagent/subagent-spawn-in-process/src/index.ts:42`）。

**`acp` 为什么全 false**。`subagent-acp` 把活交给一个**真实的 ACP 子进程**：对宿主来说子进程跑的什么模型、怎么组织工具全是黑盒，宿主只有"一句话进、一句话出"。于是四项都无法验证/强制：

1. 结构化输出——宿主管不了子进程是否真的按 `outputSchema` 返回；
2. 深度上限——子代理内部的子调用链在子进程里，宿主无从强制；
3. 工具过滤——无法把 `toolFilter` 施加到子进程自己的工具表；
4. 人格——无法保证子进程按 persona 运行。

源码注释直接挑明："cannot honor outputSchema/maxDepth/toolFilter（the service rejects a request needing any of them before start runs）"（`packages/subagent/subagent-acp/src/index.ts:141-150`）；能力声明即 `NO_START_CAPABILITIES`（:147）；同理 `inheritsParentContext = false`（:148-149）——父会话不跨进程边界传播（表 13-2 的"继承父上下文：否"）。

**服务端拒绝时机**：`SubagentRuntime.start` 在真正 start、快照描述符**之前**先调 `assertCapabilities`（`packages/subagent/subagent/src/index.ts:481-496`）：请求需要而 provider 声明 false → 抛 `SubagentError`，错误码 `UNSUPPORTED_CAPABILITY`。也就是说拒绝发生在"委派请求被接受之前"，而不是运行中途道歉——这是"fail-loud at 装配期"的纪律。

**第二道门**：`tool-subagent` 装配期还有一道。用户把 `maxDepth` 配成数字而 provider 没有 `depthLimit` 能力 → 工具**注册时**就直接抛错（`packages/subagent/tool-subagent/src/index.ts:289-294`，提示改为 `'provider-managed'` 把递归预算交给进程外提供方自己管）。所以能力位全 false 的提供方连"被用错"的机会都没有。

**别混淆两条轴**：`capabilities`（能力）与 `inheritsParentContext`（上下文继承）是独立的。`spawn` 能力全 true 但继承父上下文为 false（:99 注释"never sees the parent conversation"）；`acp` 两者都是 false。表 13-2 把它们分列两列，正是提醒读者这是两个问题。

**2. 复述 `completedTurnPrefix` 为什么在最后一个 `turn/end` 截断。**

问题在于：fork 复制给子代理的父会话前缀，必须是一份**合法可回放的子会话种子**。当前在飞的轮次可能包含"模型调了工具但还没收到结果"的不平衡消息对（有 `tool/call` 没有配对 `tool/result`）——文件头部注释说得很直白："the current tool-call turn is unbalanced and cannot be replayed as a valid child session"（`packages/subagent/subagent-fork-in-process/src/index.ts:7-9`）。如果把半截轮次复制进子会话，子会话从一开始的回放就会在"未知结果"处出现歧义：投影折不出工具结果、表面渲染出悬空配对，子会话的派生视图从第一帧起就不合法。

所以实现上 `completedTurnPrefix` 用 `findLast` 定位**最后一个 `turn/end`**（:48-57），把种子截止在这个"完结边界"之后。这里有一个优雅巧合：因为"seq 恒等于数组下标"（仅追加契约，见第 8 章），`slice(0, lastEnd.seq + 1)` 得到的天然就是从序号 0 开始的连续前缀——一份合法可回放的前缀，不需要额外校验连续性。

边界情形：会话刚 `agent/session-start`、还没有任何完结轮次时，空种子就**省略** seed 字段，fork 保持 unseeded（:68-72 的 `...seed.length > 0 ? { seed } : {}`）——子代理从零开始，等价于 spawn。

一句话：截断点是"已完成轮次"与"在飞轮次"的分界线；fork 复制的是**所有已完成轮次**，当前在飞的那半个轮次永远不复制（它不合法，也不属于"已完成的历史"）。

### 应用

**3. 配置 `tool-subagent` 让"后台子代理"走 fork 提供方，说明此时模型看到的工具描述措辞会变成哪一句。**

配置两条：`provider: 'fork'`，`backgroundMode: 'one-shot'`（`backgroundMode` 默认 `one-shot`，:85；`continuable` 对 fork 不可用——fork 没有 `prepareContinuable`，配置了会当场抛错 `tool-subagent: provider "fork" does not support \`backgroundMode: continuable\``，:291-293；且 continuable 目前没有生产调用者，README:60-61）。后台投递用每次调用上的 `run_in_background: true`。

**措辞从哪来**：description = `providerWording(provider.inheritsParentContext)`（:291）。fork 的 `inheritsParentContext = true`（`packages/subagent/subagent-fork-in-process/src/index.ts:64`），所以取"继承支"文案（`packages/subagent/tool-subagent/src/index.ts:211-231`）：

> "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation's context — a follow-up analysis, a review, a continuation — without consuming this conversation's context for the work itself. You receive its result, not its intermediate steps."

`prompt` 参数的描述同样换成继承支："The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new."

**后台附句**：description 还会按 `backgroundEnabled` 追加一句（:295-315）。one-shot 后台对应：" This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`."（对照：continuable 是另一段；前台是 "This call waits for the subagent and returns its result."）

**要点**：措辞只由 `inheritsParentContext` 决定，与 `backgroundMode` 无关；后者只决定附加句。反过来这也说明了 fork 后台化的语义：子代理"带着父会话已完成轮次"在后台干活（子侧看到父历史），而父上下文没有被工作本身消耗——继承支文案里的 "without consuming this conversation's context for the work itself" 正是这个卖点。

**4. 写一个 10 行的 SKILL.md 骨架（含 kebab-case 名字、frontmatter、`disable-model-invocation` 键），说明它会出现在 `<available_skills>` 目录里但不出现在 `skill` 工具调用结果里。**

骨架（10 行）：

```markdown
---
name: audit-lint
description: 检查仓库提交规范与格式问题的辅助技能，仅供用户显式点名调用。
disable-model-invocation: true
---
# audit-lint

当用户要求检查提交规范时，运行 `dsh audit-lint` 并把输出读给用户。
```

frontmatter 三个键：kebab-case 的 `name`（`packages/skill/skill/src/index.ts:20` 的 `SKILL_NAME` 正则约束）、`description`、`disable-model-invocation: true`。解析端 `parseInvocationPolicy`（`packages/skill/skill-filesystem/src/index.ts:988-1010`）读 kebab-case 键（`disable-model-invocation` / `user-invocable`），`modelInvocable = disable !== true`、`userInvocable = user-invocable !== false`；legacy camelCase 键会被 `rejectLegacyInvocationKey` 拒绝，别用旧写法。

**必须诚实指出题面与源码的一处差异**。题面说"它出现在 `<available_skills>` 目录里但不出现在 `skill` 工具调用结果里"。实核源码后的准确图景是：

1. **目录注入也看不见它**。`<available_skills>` 目录（`<system-reminder>` 用户消息）由 `tool-skill` 的 pre-step 注入，它取 `snapshot.skills.filter(isModelInvocable)`（`packages/skill/tool-skill/src/index.ts:226`）——禁用模型调用的技能在注入前就被过滤，目录里同样没有它。
2. **`skill` 工具直接拒绝**。execute 里 `isModelInvocable` 检查命中则抛 `skill "X" is not available for model invocation`（:138-145）。
3. **唯一入口是用户显式调用**。pre-step 里只扫 `source.kind === 'user'` 的消息（:171-190；:178-180 注释"This is the only entry point for `disable-model-invocation` skills; the catalog and the `skill` tool below never see them."），先过 `isUserInvocable`（:195-197）再把正文注入——用户点名才进上下文。

所以确切说法是：**磁盘上的技能目录**（发现/列表层面）里它存在；但模型可及的**两个入口**（`<available_skills>` 目录注入与 `skill` 工具）都把它藏起来了。若题面把"目录"理解为模型看到的 `<available_skills>`，则该句的前半也需修正——这正是 `disable-model-invocation` 的设计意图：有副作用、需要用户判断的技能，模型既不能被目录"引诱"去调，也不会被工具放行；只有用户点名，才由"用户——技能正文"的确定性通道注入。

### 综合

**5. 设计"主 agent 并行派 2 个子 agent 分头调研、再派 1 个汇总"的编排：workflow 脚本方案 与"前台 subagent ×2 + 后台 one-shot ×1"方案，从取消语义、错误传播（fatal vs null）、上下文成本三方面对比。**

**方案 A：workflow 脚本**。`tool-workflow` 的 DESCRIPTION（`packages/workflow/tool-workflow/src/index.ts:135-155`）给出 `agent(prompt, { label, phase, schema, provider, model })`、`parallel(thunks)`（屏障）与 `pipeline`。脚本骨架：

```
const [a, b] = await parallel([
  () => agent('调研模块 A 的接口与依赖', { label: 'research-a', schema: { result: 'string' }, provider: 'spawn' }),
  () => agent('调研模块 B 的接口与依赖', { label: 'research-b', schema: { result: 'string' }, provider: 'spawn' }),
])
return { report: await agent(`汇总以下两份调研…\nA: ${a.result}\nB: ${b.result}`, {
  label: 'synthesize', schema: { report: 'string' }, provider: 'spawn' }) }
```

`parallel` 是屏障（每个 thunk 都结算才继续，`packages/workflow/workflow-worker-thread/src/runtime.ts:400-426`）；`pipeline` 无跨阶段屏障（:427）；`agent` 的 schema 把结果裁剪成结构化值，脚本体只拿裁剪后的少量文本去拼接下一次 prompt。

**方案 B：前台 subagent ×2 + 后台 one-shot ×1**。模型连续调两次 `subagent` 工具（`run_in_background` 缺省为 false）拿到两份结果，第三次带 `run_in_background: true` 投一个汇总任务，返回 job id，后续用 `job_output` 取结果（`packages/subagent/tool-subagent/src/index.ts:400-422` 后台投 jobs）。

**对比三轴**：

| 轴 | workflow | 前台 ×2 + 后台 ×1 |
|---|---|---|
| 取消语义 | 整树随调用取消：宿主 cancel → worker 取消 → 宽限（disposeGraceMs）后 `worker.terminate` 强杀（`packages/workflow/workflow-worker-thread/src/host.ts:190-207`、:236-249）；`WorkflowRun.result` **永不 reject**——失败 → `stopReason: 'error'`，取消 → `'cancelled'`，dispose 必调用（`packages/workflow/workflow/README.md`） | 前台：两个调用挂在本轮上，取消随当前轮传导信号，子代理跟着退；后台 one-shot：job **独立于轮次**（提交即 running，`packages/jobs/jobs-local/src/index.ts:165`），当前轮取消不杀它，owner 销毁或 `job_kill` 才停（:223-224 先 cancel 再 stopping） |
| 错误传播 | `parallel` 中每个 thunk 异常 → 该分支结果为 **null**（其余照跑）；fatal 错误逃逸整个组合器（workflow 以 error 收场）；`agent()` 正常结束但非 `completed` → null；**误用钩子**（在 agent 里调外部工具/fs/网络）抛错必杀脚本（`packages/workflow/tool-workflow/src/index.ts:135-155`；无 fs/网络/timer，前台执行） | 前台：失败 = `isError: true` + partial text 进父上下文，模型自己读错再重试；后台：job 失败 → 状态机 `failed` + 通知，模型收到通知后决定是否重投（`packages/jobs/jobs/src/index.ts:17` 五值闭集） |
| 上下文成本 | 父上下文只看到**一次脚本文本 + 结构化结果**（schema 裁剪），子代理中间步骤、完整输出都不进父上下文 | 前台：子代理返回的**全量文本**进父上下文（每次等结果都消耗父窗口）；后台：结果何时取由模型定，取回时同样进上下文；另注意 fork 子代继承父已完成轮次——**子侧**上下文按父历史大小计费 |

**结论**。编排逻辑（分叉 + 汇总 + 结构化交接）→ workflow：它把"三个子代理 + 一个汇总"变成**一个调用**，父上下文只承担调度文本与结构化结果；简单的"两问一答且要模型即时处置"→ 前台 subagent（结果当场可见、可追问）；与主轮次异步的旁路任务（不阻塞轮次）→ 后台 one-shot（生命周期归 jobs，owner 管收尸）。两者的交叠点正好是 `tool-subagent` 的 one-shot 后台分支把"单个"子代理放进 jobs，`tool-workflow` 把"一批"子代理放进 workflow。

### 挑战

**6. 阅读 `packages/jobs/jobs-local/src/index.ts:416-450` 的 `settle`，论证"完成通知最后发布"为什么必须如此。**

先看顺序（`packages/jobs/jobs-local/src/index.ts:415-450`）：① 写终态字段（status/detail/output/finishedAt）；② 若 waiters > 0 则置 `reported = true`；③ 构建快照；④ 释放 `waitResolvers`（等待者醒来）；⑤ `markSettled`（`isTerminal` 首赢守卫）；⑥ `notifyChanged`（状态变更广播）；⑦ **最后**才跑 `onJobDone` 监听器。

为什么监听器必须排最后——源码注释给出了答案："Completion is announced last because a reporter may open a model turn synchronously: every other observer of this settlement must already have seen the committed record"。`onJobDone` 回调可能**同步打开一个模型轮次**（典型的"任务完成，把结果发给模型继续"场景）。这个新轮次会观察三类东西：会话日志里这条 job 的记录、job 状态/快照（下次查询所见）、inbox/通知。如果监听器在①之前或①②之间跑，它打开的新轮次看到的将是旧状态（running 而非 done）或半提交的记录——新轮次基于错误前提做决策：重复结算、再次等待、把完成当失败，甚至让同一个 job 被开两次模型轮次。

"先提交、后通知"把崩溃的每种位置都算清楚了：

- 崩在①之前 → 结算等于没发生，无任何观察者见过终态，重试安全（`isTerminal` 首赢守卫 + 幂等保证多次 settle 只生效一次）；
- 崩在①~⑥之间 → 终态已提交、通知未发：观察者要么从未知道（下次照常查询到终态），要么收到部分通知，但**不存在"通知了却读不到终态"的窗口**；
- 崩在⑦内部 → 终态与通知都已就位，只有个别监听器没跑（listener 异常仅 warn 不抛，结算流程不中断）。

换句话说，把通知当作"事实提交完毕之后的广播"，而不是"结算的一部分"：事实在前、广播在后，任何观察者看到的世界都至少是"已结算"的世界。这也回头印证了 jobs 的状态机设计——`isTerminal` 首赢、终态字段一次性写完、快照在下发前冻结，全是为了让"通知时"与"通知后"两个时刻的可观测状态一致。

## 第 14 章　长程会话治理

### 理解

**1. 对照五步 surface 契约，说明"为什么 `compaction/end` 必须是最后一个事件、崩溃后如何检测孤儿锁"。**

五步契约（`packages/compaction/compaction/README.md` "Surface contract"）：

1. append `compaction/start`（log-only）——**取锁**；
2. 摘要（对选中区间做总结）；
3. append `compaction/summary`（log-only，携带摘要、范围、被遮蔽 seq、token 计数、provider/model 调用信封）；
4. append 单一 `user/message`，`source: compactCheckpointSource(compactionId)`，`surfaceOp: { op: 'replace', start, end }`——**本操作唯一一次表面变更**；
5. append `compaction/end`（log-only）——**释放锁**。

**`end` 为什么必须最后**：表面变更（第 4 步）必须落在锁括号**之内**。README 原文："The surface mutation (step 4) sits inside the lock bracket: `compaction/end` is the last event, so the lock is never released before the mutation lands." `end` 的意义是"释放锁"，而不是"完成标记"。若顺序颠倒（先发 end 再 replace），崩溃在两者之间会留下"锁已释放、表面没换"的**假完成**状态——重放时未配对 start 不存在，孤儿锁检测失效，读取端会以为压缩成功而实际上表面从未被替换；反之若 `end` 后还有别的变更，就出现"锁已释放仍写表面"的乱序。

**崩溃后如何检测孤儿锁**：崩溃发生在 start~end 之间 → 日志留下一个**没有配对 end 的 `compaction/start`**，这就是孤儿锁。检测规则（README "Blocking"）：tail inspection 独立地找到"最新未配对的 `compaction/start`"与"最新 `session/end-seed`"，然后比较：

- 未配对 start 在该边界**之后** → 这是一个**活锁**（live），压缩确实在忙，报 `busy`；
- 未配对 start 在该边界**之前** → 它是**旧进程生命周期**的残留证据（旧进程已死），**不阻塞**——同一个 end-seed 转换还会清除不变式伴生的重放痕迹。

这解释了为什么锁是"可检测的括号"而非弱引用/互斥量：`compaction/start` 在摘要让出前同步追加，之后每一次失败都恰好尝试一次 `compaction/end { error }`；若关闭那次追加也失败，未配对 start 本身就是刻意的 busy 信号（README：no flush is attempted）。

**两个补充边界**：① marker 对非排他容器——`start…end` 命名的是"锁的获取与释放"，不是排他事件容器，idle `inject()` 可能在手动 start 与 end 之间追加无关上下文，所以手动路径要**重验选中的 span** 而非要求整表面相等（位置替换让注入的上下文在检查点后仍可见；自动压缩在自己的活动轮次内保持整表面相等）；② 锁是 durable bracket——`A live bracket cannot cross a turn/start or turn/end`，即压缩括号不会横跨轮次边界。被遮蔽的事件仍留在原始日志，"so replay is deterministic"。

**2. 说出 `SurfaceEventType` 闭集包含哪三类事件，并解释 `compaction/summary` 为什么不能携带 `surfaceOp`。**

闭集（`packages/core/session/src/types.ts:343-346`）：只有 `user/message`、`assistant/message`、`tool/result` 三类事件可以携带 `surfaceOp`；`compaction/*` 三个事件全部 log-only（无 `surfaceOp`）。

`compaction/summary` 不能携带 `surfaceOp`，理由分三层：

1. **表面是"对外可验证的对话视图"**，而 summary 是**账本**：它记录的是"这次压缩做了什么"（范围、被遮蔽 seq、token 计数、provider/model 调用信封），不是对话内容。把账本放上表面 = 把元数据当消息，模型与 UI 都要学会区分"这是内容"与"这是簿记"。
2. **递归危机**：压缩的本职就是"把一段表面换成一段摘要"。若 summary 自己带 `surfaceOp`，那么下次压缩会把它当作表面内容再压一遍——"压缩记录被压缩"的无限回归；`checkpoint` 与 `surfaceOp:{replace}` 的"位置替换"语义也失去锚点（摘要之上还有摘要，表面位置层层错位）。
3. **表面位置与 seq 脱钩**：`compactRegion` 的 range 是 SURFACE-POSITION span 而非数值 seq 区间（README "Service API"——replace 落地后，新高 seq 的摘要节点位于被遮蔽区间的位置，表面顺序不再跟随 seq 顺序）。若账本事件也参与表面，位置语义进一步崩坏，UI 与回放都要处理"账本也是内容"的情况。

那么摘要怎么让模型看见？靠第 4 步的 **checkpoint**：`user/message` + `surfaceOp: { op: 'replace', start, end }` 携带摘要，`deriveMessages()` 把它渲染为 user-role 消息、后面接保留节点。用户看到的是"压缩检查点"（一条用户角色的消息），而不是 summary 事件本身。"人看见摘要"与"账本记录压缩"是两条通道：前者走表面，后者走日志。

**3. 复述 plan-mode "soft guidance" 的含义，并说明 sandbox/approval 与 plan 状态为什么"不读不写"。**

**soft guidance 的含义**（`packages/plan/plan-mode/src/index.ts` 头注释）：plan mode = 每个请求都注入一段**部署拥有的指导段**（"你处于计划模式，只输出计划、不要执行……"）+ 呈现 `exit_plan_mode` 工具。它不改变执行环境：不拦工具、不动 sandbox、不给权限、不替换任何执行决策——只是"提示模型别动手"。力度上它属于软约束：模型可以无视，但部署方可以在提示段里写明要求。

**sandbox/approval 不读不写 plan 状态**，因为两者**正交**：

- **计划不授予权限**：批准计划 ≠ 批准计划里的每个动作。执行时 sandbox/approval 照常逐动作裁决；一旦 `exit_plan_mode` 退出、`plan/mode false` 折叠生效，指导段不再注入，模型恢复行动自由——但权限边界没有任何变化。若 approval 读 plan 状态，就会犯"计划里写了某命令所以审批放行"的错误授权（把软约束升级成硬授权）。
- **权限系统不替用户计划**：sandbox/approval 不知道"用户在计划里承诺了什么"，它只判断"这个具体动作安不安全"。若它写 plan 状态（比如"批准后自动退出计划模式"），就把"用户批准了一个动作"扭曲成"用户批准了整份计划"。

**实现佐证**：plan 状态没有 live mirror，是 `foldPlanMode(events, end?)` 从事件流折叠而来（`last plan/mode` wins，无则 inactive，:127-143），模块内所有调用点都传 `agent.session.events` 全量日志（:176/:231/:288/:324 等）；`'plan/mode'` 事件是 log-only 非表面、whole-value replace。`pendingIntents` 是 WeakMap（进程内瞬态），在"下次被接受的 in-turn pre-step"被消费；`exit` 工具常驻、只改提示段。所有这一切都只服务于"提示"这一个动词——没有任何读写到达权限面。

一句话：soft guidance = 只进上下文的建议；sandbox/approval = 只动执行边界的事实。二者互相读写的话，软约束就会变成隐藏的硬约束，或硬约束被软状态污染。

### 应用

**4. 某长会话反复报 `CONTEXT_WINDOW_EXCEEDED`，设计排查顺序：先看 `maxOverflowRetries`、再看 `thresholdRatio`，说明每一步依据哪条触发链。**

先建触发链模型（`packages/compaction/compaction-basic/src/index.ts`）：自动压缩有两条入口——pre-step 压力触发（:144-166，按 token 压力决策）与 request-error 溢出路径（:179-194，模型回 `CONTEXT_WINDOW_EXCEEDED` 时强制压缩一次再重试）。两条汇合到同一个"选区间→摘要→替换"流程。`CONTEXT_WINDOW_EXCEEDED` 反复出现，说明**溢出路径在打转**，按下面顺序查：

**第一步：看 `maxOverflowRetries`**（`packages/compaction/compaction-basic/src/config.ts:93`，默认 `1`，即溢出后只自动重试一次）。判读：

- 重试耗尽后仍溢出 → 不是"没触发"，而是**压缩后依然超窗**：要么可压缩区间太小，要么窗口配置与实际模型窗口不符。此时调 `maxOverflowRetries` 无意义（重试次数再多，每次压完都超窗），应转向第二步与第三步。
- 若重试一次后就不再溢出 → 说明当年那次是**单次抖动**（触发阈值附近波动），可以不改参数或稍微调大 `thresholdRatio`。

**第二步：看 `thresholdRatio`**（config.ts:95 `auto` 默认 true；:144 `thresholdTokens = floor(contextWindow × thresholdRatio)`——触发阈值 = 窗口 × 比率）。判读：

- 太小 → 触发过早/过频：每次压力都压缩，烧 token 换不到空间（压缩的摘要本身有成本），还会因频繁"表面替换"扰动模型上下文；
- 太大 → 触发过晚：到了窗口边缘才压缩，一次压力就把窗口打爆，溢出 → 强制压缩 → 可能仍超（可压缩区间不够）。
- 做法：查会话日志中每次压缩前的 token 计数与阈值之差，把 `thresholdRatio` 调到"压缩后的稳态明显低于窗口、且正常行走不会碰到阈值"。

**第三步（如果前两步都正常仍反复溢出）**：查日志证据——① `compaction/start…end` 是否每次都成对（有没有孤儿锁/失败 end）；② `region.ts:98-118` 的尾巴保留是否过大（`selectCompactableRange` 保留最近尾巴，尾巴越大可压缩区间越小；若"保留尾巴 + 摘要"仍超窗，说明窗口本身不够）；③ 核对 provider 实际上下文窗口 vs 配置的 `contextWindow`（配置比模型真窗口大，压缩永远"感觉不到"压力）。

顺序依据：先看"重试次数"区分偶发与系统性，再看"触发阈值"区分触发太晚与压缩不足，最后查"区间与窗口"区分能压没压与没得压——从事件频率到机制参数再到数据面，逐层收敛。

**5. 配置 `allowParallelInProgress: false` 后，一次工具调用标记了两个 `in_progress`，写出模型收到的完整错误文本，并解释为何日志层不检查活动计数。**

**完整错误文本**（`packages/todo/tool-todo/src/index.ts:108` 的错误消息，tools 层统一加 `Error: ` 前缀后进模型上下文）：

```
Error: invalid todos: at most one task may be in_progress (got 2)
```

即消息本体 `invalid todos: at most one task may be in_progress (got <n>)`，`<n>` 为实际活动计数。

**日志层为什么不检查**——这是"策略 vs 事实"的分离：`todo/write` 是**日志事件**（快照当时的清单事实），`allowParallelInProgress` 是**部署策略**（可配置的校验规则）。README "Configuration" 一节原文："The durable-log invariant does NOT follow it: a log written while parallel work was allowed must still replay after a deployment tightens the policy, so the invariant stays silent on the active count."

推演一下反面：若日志层把"活动计数 ≤ 1"写进不变式，那么宽松期（允许并行）写入的日志，在部署**收紧**策略后依然存在——若按收紧后的不变式重放，这些合法旧日志会被判为损坏 → 违反"durable-log invariant"（日志必须永远可重放，见第 8 章）。所以不变式对活动计数保持静默，把校验放在**执行层**：`todo_write` 工具调用时检查并拒绝（模型看到错误、修正后再写），而不是事后把日志判死。

三层各司其职：执行层校验（模型可见的 Error 反馈）、事实层记录（`todo/write` 整表快照投影；`turn/start` 清空进行中、`turn/end` 保留 finished，见 `packages/todo/tool-todo/src/index.ts:132/:142`；返回 counts :217-220）、策略层配置（`allowParallelInProgress` 必填 :42）。策略可变、事实不变——这就是为什么"谁检查"比"何时检查"更重要：检查发生在把模型意图翻译成清单事实的边界上，而不是在既有事实之上。

**6. 给一条需要 90 秒的 `pnpm install` 工具声明 `timeoutMs` 并说明超时后模型的错误消息与错误码。**

**声明**：在 `defineTool` 顶层加字段：

```ts
defineTool({
  name: 'install-deps',
  description: '在项目目录运行 pnpm install',
  parameters: { /* ... */ },
  timeoutMs: 90_000,          // 顶层字段，见 schema
  async execute(exec) { /* ... */ },
})
```

`timeoutMs` 是工具 schema 的顶层可选字段（`packages/core/tools/src/schema.ts:500`，配置校验 :563-564；`validate` 失败抛 `ToolArgsError` :585-588；`isConcurrencySafe` 是软验证 :594-615）。

**超时后模型看到的**（`packages/guard/timeout-policy/src/index.ts:30-46` 的 `toolTimeoutResult`）：消息文本 `tool call timed out after 90000ms`；content = `Error: <该消息>`；`isError: true`；错误对象 `{ name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' }`。错误码是闭集的一部分（`TOOL_TIMEOUT`），模型/宿主可按码分支处理。

**机制**（timeout-policy:54-76）：`tools/execute` 的包装先取 `ctx.tools.get(exec.name, exec.agent)?.timeoutMs`——取不到（undefined）直接 `next()` 直通（没声明超时的工具不受守护影响）；取到就从定义处派生出 **deadline**，用 deadline 派生一个 AbortSignal **临时替换** `exec.signal`（工具拿到的信号带有截止语义，超时即 abort），`finally` 里恢复上游信号；工具返回后 `timeoutOf` 判定"是不是本包装的 timer 触发的"——是则把结果**整体替换**为 `toolTimeoutResult`（即使工具自己已经 abort 过一次，也统一成同一个错误码）。

要点：守护的选择面是"给执行信号加截止"，而不是在提示词里劝模型快跑——它动了执行信号，就是强约束；而模型侧得到的是结构化错误（名字 + 码），可以据此决定重试或换命令。

### 综合

**7. 设计一个"runbook"：用户在 `/plan` 模式下批准计划后，模型开始执行却中途连续调用 `read_file` 七次——画出 plan-mode、todo_write、repeat-tool-reminder、timeout-policy 四者各自在这个场景中做了什么、没做什么，并指出谁负责把用户"方向错了"的反馈传回模型。**

场景注：七次 `read_file` 读的是**七个不同文件**（这是本题的关键事实）。

| 治理件 | 做了 | 没做 |
|---|---|---|
| plan-mode | 批准计划 → `plan/mode false`（`foldPlanMode` 折叠，指导段不再注入；后续请求不再带"只输出计划"提示） | **不监视执行**：不知道模型在读文件、不拦工具、不检查重复；它的唯一职责是"是否还处于计划模式" |
| todo_write | 每次 `todo/write` 做整表投影快照（`turn/start` 清空进行中标记、`turn/end` 保留 finished checklist） | **不检查调用与 todo 的对应**：模型读的文件是否属于待办、是否偏离计划——它只记录清单状态，不裁决行为 |
| repeat-tool-reminder | 对"同工具 + 同参数"的重复计数：计数键 = `JSON.stringify([exec.name, canonicalize(exec.arguments)])`（`packages/guard/repeat-tool-reminder/src/index.ts:185-204`） | **这七次全部不触发**：参数各异 → 每次 key 都不同 → `chain.key === key ? +1 : 1` 恒为 1，计数从不累积；同参数才会第 3 次（GENTLE："You are repeating the exact same tool call with identical arguments…" :63-79）、第 5/8 次（detailed：tool/consecutive_calls/arguments 三段）提醒 |
| timeout-policy | 无 | 快速 `read_file` 远低于任何超时，不触发 |

repeat-tool-reminder 的定位是"Observe-and-enrich, never veto"（:207-222）：post-execute 先计数、再 delegate、再把提醒 prepend 到 `additionalContexts`（block 决策也带上下文）；它只答"你是不是在**重复**"，不答"你的**方向**对不对"。所以这七次异地读文件的"方向错误"对它完全不可见。

**谁负责把"方向错了"反馈传回模型：用户消息，且是唯一真正通道。**用户说"停，你方向错了"→ 下一条 user 消息进入 pre-step；且该消息（`source.kind === 'user'`）还会**重置提醒链条**（:226-232 中 `chains.delete(agent)`）——系统把用户消息当作"语境已变"的权威信号：模型拿到新指令重新校准，重复计数从 0 开始。

**runbook 的设计结论**：四个治理件全是"防止偏离的护栏"，没有一个是"纠正方向的罗盘"——计划只约束"该不该动手"，清单只记录"做了什么"，提醒只纠"机械重复"，超时只罚"拖太久"。方向纠正永远是用户消息；护栏的意义是让"方向错了"的代价可以承受（重复有提醒、长命令有超时、清单有投影），而不是替用户做判断。

**8. 讨论压缩发生在 plan 评审期间会怎样：计划状态会丢失吗？**

**结论先行：计划状态（active/pending、接受的计划）不会丢；代价是计划原文可能被摘要覆盖。**

推理链：

1. `foldPlanMode` 从**全量日志**折叠（plan-mode 模块所有调用点都传 `agent.session.events`），而不是从"表面"折叠。
2. 压缩是**表面替换**：`surfaceOp` 只允许出现在 `user/message | assistant/message | tool/result` 三类上（`packages/core/session/src/types.ts:343-346`）；`plan/mode` 事件是 log-only 非表面。
3. "被遮蔽的事件仍留在原始日志"（README "Surface contract"：The shadowed events remain in the raw log, so replay is deterministic）——压缩只是让它们从**派生视图**（模型消息）里消失，日志本身一字未删。
4. 所以 `plan/mode`（以及 `command/run` 等 log-only 事件）**不在压缩替换范围**：折叠输入不变 → `foldPlanMode` 输出不变 → 计划状态不丢。`pendingIntents` 之类进程内瞬态更与压缩无关。

**代价**：计划**原文**（评审期间模型写出的计划文本，是 `assistant/message`）可能落在被压缩区间——之后表面上看不到原计划全文，只剩 checkpoint 摘要（user-role）里的概括。这是通用压缩代价（任何旧文本都可能被摘要），并非计划特有。

**另一个保障**：live bracket 不跨 `turn/start`/`turn/end`（README "Blocking"：A live bracket cannot cross a turn/start or turn/end）——压缩括号只取平衡的轮次区间；`plan/mode` 切换发生在轮次边界（plan/mode 事件在 turn 结构内），不会被半截压缩切开：压缩前/后，计划状态所在的日志片段都完整可折叠。

**若产品要求"计划原文必须保留"**：把计划相关轮次加入保留尾巴（区域选择器保护集）或抬高尾巴保留量即可——这是**策略**问题，不是机制缺陷。机制上"状态安全、文本可摘要"是既定事实。

### 挑战

**9. 阅读 `packages/compaction/compaction/src/tool-pairing.ts` 的 `toolPairingBalancedBefore/After` 与 `packages/compaction/compaction-basic/src/region.ts:98-118`，论证"压缩边界必须避开未配对的工具调用"与"保留最近尾巴"两条规则如何共同保证压缩后模型仍能继续对话。**

**规则一：平衡边界**。`toolPairingBalancedBefore/After`（`packages/compaction/compaction/src/tool-pairing.ts:117/:129`）定义"安全边"：**没有未应答的 assistant 工具调用跨越该边**——每个 `tool/call` 在边内都要配到 `tool/result`。实现上按 `surface.replaceGeneration` + 已处理表面条目数做缓存（生成不变则只折叠新增尾条目、log-only 追加不读事件；替换则重建成员与平衡表）。对损坏的表面状态直接拒绝：缺 seq、或出现没有开调用配对的 `tool/result`，"reject as corrupt surface state"。

**为什么必须避开**：`deriveMessages()` 的渲染序列是"checkpoint（user-role 摘要）+ 保留节点"。若压缩边界切在工具调用中间（`tool/call` 在压缩区间、`tool/result` 在外面，或反之），渲染出的消息流就出现**悬空配对**：模型看到一个"没有工具调用却有工具结果"或"有调用永远等不到结果"的消息块——工具上下文被破坏，模型无法把这个块与任何调用对应；更糟的是回放侧（加载会话重建表面时）对这种状态直接判损坏拒绝，压缩反而把会话弄坏。

**规则二：保留最近尾巴**。`selectCompactableRange`（`packages/compaction/compaction-basic/src/region.ts:98-118`）在选压缩区间时保留最近的尾巴。这保证"最近对话完整在场"：模型最后看到的是**未经压缩的连续尾段**，与摘要节点一起构成"摘要（远）+ 原文（近）"的连续上下文。尾巴里如果还有未完成的工具轮次（in-flight 部分），也自然落在保留区——平衡只约束被压缩的区间，保留尾巴让"半截轮次"不必被压缩。

**共同保证**：平衡边界管"删得干净"（压缩出去的部分必须自洽：所有工具调用都有配对、区间两端都是可折叠边界），保留尾巴管"留得完整"（留在场上的部分连续、无缺口）。两者合起来，压缩后的渲染序列 = 摘要（user-role 消息）+ 完整保留节点，无悬空引用、无缺配对；模型可以在摘要之后无缝继续对话（最近消息原样在场、工具上下文完整），而"被遮蔽事件仍在原始日志"保证任何时候都可以重放回未压缩状态。

**10. 对比"todo 投影在 `turn/start` 清空"与"goal 激活不持久化"，从"跨轮状态的生命周期"角度论述二者设计取向的异同。**

**todo：每轮重置**。投影规则（`packages/todo/tool-todo/README.md` "Session projection"）：`todo/write` 整表替换、`turn/start` 清为 null、`turn/end` 保留 finished checklist、`stateVersion=2`；实现 :132/:142。这是**显示性状态**——清单本质上"给模型看的当前近况"（session 内容的投影）。每轮重置防止**旧清单冒充当前进行中**：若跨轮残留 `in_progress` 项，模型在下一轮会把上一轮的"进行中"当作当前承诺——用户改了方向、任务被中断、上轮其实是"搁置"状态，旧进行中都会被误读为"还在做"。清空是"每轮从零开始重新记账"的语义。

**goal：会话级持久，但激活不持久化**。`goal/change` 是唯一权威（目标、相位、revisions、已接纳轮数跨轮累计；`defaultMaxGoalRounds=256`，README:28；`active + armed` 时拒绝新 goal，:318-327；`roundsStarted >= maxGoalRounds` 拒绝并提示增加预算，见 `packages/goal/goal/src/index.ts:318-327`）。但**激活（armed）从不持久化**（README:25-28）：每个新会话、每次 `agent/session-start` 都 disarm 它（index.ts:199），disarm 不写 revision、不发射 mutation（:236-240），seed 折叠时 `activation='disarmed'`（:420-428），只有显式的 resume 变更才 arm（:318-327）。原文："Activation is never persisted. A fresh cache and every `agent/session-start` edge disarm it even when replay finds an active durable phase. … Session resume, fork, and driver replacement therefore retain the objective, phase, revisions, and admitted-round count without initiating work; a later explicit resume mutation must arm continuation."

**异同**：

- **同**：都是"日志存、投影读"的跨轮状态（todo 从 `todo/write` 折叠、goal 从 `goal/change` 折叠）；都只经一条受控通道改写；都不依赖内存里的"当前值"。
- **异（本质）**：todo 是**显示性**状态（目的是让模型/UI 看见），清空语义跟着"模型现在该看什么"走——每轮重置，防的是**状态过期**（把旧进度当新承诺）；goal 是**权限性**状态（激活 = "可以自动发起工作"的授权），生命周期跟着"谁批准了什么"走——目标与轮数跨会话保留，但**激活**在恢复/分支/替换驱动器边界一律复位，防的是**授权静默延续**（恢复一个会话不该自动续跑目标；续跑必须由用户显式 resume 触发）。
- **一句话**：todo 怕"陈旧"，所以每轮刷新；goal 怕"越权"，所以边界复位。前者是"视图的时效性"，后者是"执行的授权性"——同一个"跨轮状态"因性质不同而选择了完全相反的生命周期策略。

## 第 15 章　持久化与设置

### 理解

**1. 一个会话创建后没有任何事件就退出。jsonl 与 SQLite 后端分别在磁盘上留下什么？为什么 `list` 可能看不到它？**

核心机制是**可延迟物化**：会话对象"创建"是内存动作，不等于磁盘写入。`create`（`packages/session/session-persistence/src/index.ts:133`）的语义允许后端"延迟物理写入直到首次 append"（:126-131 的注释正是讲这一点；`readRaw` 默认实现 :103-121 直接拒绝，`supportsRawArtifacts` :102）。

- **jsonl 后端**：磁盘上**什么都没有**——没有目录、没有文件。一个会话一个目录（`projectKey/session-<id>`，见 §15.3.1），目录与头行（`hl` header line）只在**第一次 append** 时 materialize（`packages/session/session-persistence-jsonl/src/index.ts:529-569` 的 `materializePosix`——mkdir 0700、rejectExistingLog、writeSyncedTempFile 'wx'+0600+fsync、link+unlink 发布）。没有任何事件 = 从未 append = 从未物化。
- **SQLite 后端**：**没有 `sessions` 行**（`packages/session/session-persistence-sqlite/src/schema.ts:26-31`：行存在即物化信号——"row existence is the materialization signal"；`created-but-never-appended` 的会话没有行）。`sessions` 行在 `appendBatch` 的同一事务里写（:284-302），事件行与 session 行同生共死。

**为什么 `list` 看不到**：两个后端的 `list` 都基于**盘上事实**——jsonl 的 list 扫目录 + 读头行（`SessionLogScanner`，`packages/session/session-persistence-jsonl/src/format.ts:272-378/:388`）；SQLite 的 list 走 SQL（`packages/session/session-persistence-sqlite/src/index.ts:341`）。没有物化就没有可列举的条目。注意：`list` 不查询内存中的 live registry——进程内该会话还活着时它可能"存在"，但重启后彻底消失（盘上无痕）。

设计含义：**"创建"不是持久化承诺**，只有**第一个事件**才是。这也解释了 `prepare` 的默认实现（session-persistence/index.ts:155-168：load → structuredClone → SessionStore.prepare，`seedSource: 'persistence'`）——恢复一个从未物化的会话无数据可载，等价于不存在。

**2. 协调器为什么在 `appendCore` 里拒绝 `event.seq !== state.cursor + i`？若去掉这个检查，哪个后端最容易出现什么坏数据？**

`append` 的 seq 连续性检查（`packages/session/session-persistence/src/coordinator.ts:697-702`）：第 i 个事件必须满足 `event.seq === state.cursor + i`，否则抛 `append seq mismatch`。这是"仅追加契约"（第 8 章）在**持久层**的落实：事件流必须是"从 0 连续、无重复、无间断"的序列——seq 不是装饰，它是下游一切机制的地基（`completedTurnPrefix` 靠 `seq === 下标` 的 `slice(0, lastEnd.seq + 1)`；表面定位靠 seq 找点；投影折叠按 seq 归并；checkpoint 识别靠 seq 区间）。

若去掉检查，**jsonl 后端最容易出坏数据，而且是静默的坏**：

1. **jsonl 的 append 是无约束追加**：`appendLines` 批量写行，没有事务、没有约束、没有"已存在性"检查。重复 seq（同一事件写两次）会被**静默写入**——追加语义下没有任何机制报错；间断（缺失 seq）也会**静默留下**（读端按行号顺序读，没有主键冲突可报）。
2. **后果是静默错位**：重复 → 回放时某事件被算两次（投影双倍计数、`slice` 越界、表面位置漂移）；间断 → "从第 K seq 读起"的后半段缺事件，且没有任何信号告诉调用方。错误不抛、日志照写，数据悄悄坏——最难查的一类故障。
3. **对照 SQLite**：`(session_id, seq)` 复合主键（`packages/session/session-persistence-sqlite/src/schema.ts:30-56`）+ 单事务 `appendBatch`（sqlite/src/index.ts:284-302，失败 ROLLBACK）——重复 seq 直接约束冲突 **fail loud**，批次原子；"洞"虽然也能入库，但 `scanRows` 有专门检查：已提交区内的洞 = 损坏，拒绝整会话（:257/:261）；尾部洞 = torn tail，记 `tornFrom`（:258/:262/:269），可经 `commitRepair` 同事务修复（:309-338：DELETE 洞区 + INSERT 闭包）。

结论：去掉连续性检查，jsonl 是"静默坏"（数据悄悄错、无信号、不可自愈），SQLite 是"响亮坏"（报约束冲突或判损坏，代价是整会话被拒，但可识别、尾部洞可修复）。jsonl 更危险，因为它把"契约"寄托在维护纪律上，而 SQLite 把契约写进了数据结构（主键 + 事务）。

**3. 说明 `SCHEMA_VERSION=15` 与 `SESSION_FORMAT_VERSION=0` 各管什么，为什么正交。**

（先勘误：正文 §15.4.1 将 `SCHEMA_VERSION=15` 出处标为 `packages/session/session-persistence-jsonl/src/index.ts:20`；实核正确出处是 `packages/session/session-persistence-sqlite/src/schema.ts:20`——`sqlite/src/index.ts:28` 仅 re-export。jsonl 后端根本没有 schema 版本概念，它用头行 + 文件布局表达自己。答案以下文实核位置为准。）

**`SCHEMA_VERSION = 15`**（`packages/session/session-persistence-sqlite/src/schema.ts:14-20`）：管**后端存储结构**——表布局（三张 STRICT 表：sessions/event_rows/chunks 之类）、行定义（`EventRow` 的 `(session_id, seq)` 复合主键、`source_event_seqs`/`surface_op`/`ignorable` 等列）、WAL 模式、读写语义。注释："Bumped only on a breaking change…orthogonal to a session's own version (which versions the EVENT vocabulary…)"。特征：**全局一个**（每个库一个版本）；只有破坏性变更才 bump；打开库时按版本**开门拒绝**（configureDatabase），**没有自动升级**（不做迁表）；`APPLICATION_ID = 0x44534850`（:23）作为库身份魔数。

**`SESSION_FORMAT_VERSION = 0`**（`packages/core/session/src/types.ts:56`）：管**事件词汇**——`SessionEventMap` 里有哪些事件类型（user/message、tool/result、…）、各自什么字段。特征：**每会话**一个（头行 `stamped`，:63 头行携带）；**新增事件类型不 bump**（向后兼容扩展——新类型只是新条目，旧解析器跳过未知项即可）。

**为什么正交**：

| 维度 | SCHEMA_VERSION | SESSION_FORMAT_VERSION |
|---|---|---|
| 管什么 | 存储结构（表/行/事务语义） | 事件词汇（领域数据语言） |
| 作用域 | 全局（一个库一个） | 每会话（头行 stamped，可不同） |
| 变更后果 | breaking 才升；打开即拒绝 | 新事件类型不升；只影响解析 |
| 关注者 | 后端（怎么存） | 领域层（写什么） |

一个管"文件长什么样"（数据库结构——后端关注），一个管"数据用什么语言写"（事件流——领域关注）；一个是"存储格式版本"，一个是"内容词汇版本"。这就像数据库文件格式版本与 SQL 方言版本的差别：前者变一次全库打不开，后者变一次只是新语句。

### 应用

**4. 给你一台 Windows 机器，用户想"把会话迁到新电脑"。按 §15.1.3/§15.3 写出最小迁移清单，并指出 `projectKey` 的 `\` → `-` 折叠对跨平台迁移的意义。**

**迁移清单**（§15.1.3"只有两样东西值得被带走"，数据面见 §15.3）：

| 数据 | 拷什么 | 说明 |
|---|---|---|
| 会话日志（jsonl 后端） | `$DSH_HOME/sessions/` **整棵树** | 一个会话一个目录，目录拷贝即迁移；无跨会话共享状态 |
| 会话日志（SQLite 后端） | 对应的 `.db` 文件 | 单库全量（含 sessions/event_rows/chunks + WAL） |
| settings | `$DSH_HOME/` 下设置文件（如 settings yaml） | "热、可展示、可合并"的配置，手动拷同名文件 |
| credentials | `.credentials.yaml` + `cwd/.env` + `$DSH_HOME/.env` | 冷秘密；解析顺序"环境 > `$DSH_HOME/.credentials.yaml` > `cwd/.env` > `$DSH_HOME/.env`"（§15.7.3） |
| 附件/spill、workspace 注册表 | `attachments/`、spill 文件、workspace 注册表文件 | 本地事实，手动拷同名文件 |

**不用拷**：`node_modules`、构建缓存、应用二进制等可再生物；以及任何"后端运行时状态"（缓存目录——投影检查点可重放，属"旧不错、可重放"，丢了会重建）。

**`projectKey` 折叠的意义**（`packages/session/session-persistence-jsonl/src/format.ts:147-167`）：`projectKey` 把路径编码成目录名——`/`、`\`、`:` 一律折叠为 `-`；非安全字符转义为 `~XXXX`；截断 251；用 `--…--` 包裹；空路径用 `'root'`。三个作用：

1. **Windows 文件名合法性**：Windows 路径含 `\` 与盘符 `:`（如 `C:\Users\...`），直接当目录名非法；折叠后 `C:\Users\alice` → `C-Users-alice`，合法且稳定。
2. **跨平台同键**：同一目录在 Windows（`C:\a\b`）与 POSIX（`/c/a/b`）编码出**同一个 projectKey**（分隔符被归一）——新电脑上按 header 里的 `cwd` 重新编码，能 `locate` 到同一个会话目录，这正是"拷目录即可迁移"的前提。
3. **防撞名与防穿越**：`--…--` 包裹避免与 `_no-cwd`、`session-*` 等保留目录相撞（format.ts:176-179 的 `_no-cwd` 兜底目录）；非安全字符 `~XXXX` 转义 + `encodeSegment`（`packages/bundle/base/cordis.patch.yml:121-136`：`[A-Za-z0-9._-]` 保留、`.`→`~002E`、`..`→`~002E~002E`）把路径类字符（含 `..`）变成不可解析为父目录的形态——恶意/异常路径不会把会话文件写出 `sessions/` 之外。

一句话：`\` → `-` 折叠同时解决了"Windows 非法字符"与"分隔符差异"，使**同逻辑路径跨平台稳定映射到同一目录**——迁移语义从"绝对路径搬家"变成"按 cwd 语义重建目录"。

**5. 用 patch 把产品切换到 SQLite 后端（§15.4.5 示例），并回答：切完后 `dsh` 的日志导出功能（依赖 `supportsRawArtifacts`）会怎样，为什么。**

**patch**（按 §15.4.5 取舍表与示例，15-持久化与设置.md:211-237，示例补丁 :232）：在 profile 的 `cordis.patch.yml`（或 overlay）里，把 `session-persistence` 实现行从 jsonl 包换成 sqlite 包（`session-persistence-sqlite`），例如对目标行做整行替换，注明后端 id 与库文件路径。**业务代码零改动**——`SessionPersistence` 是接口，协调器与 api-proxy 都依赖抽象。

**日志导出功能的结果**：`sessionLog` 导出会**直接返回 501**（`packages/host/apiproxy/src/api-proxy.ts:3643-3653`）：

```
session log export is unavailable: the persistence backend does not expose per-session raw artifacts
```

调用链：导出前先 `flushLiveSessionLog`；然后 `if (!deps.sessionPersistence.supportsRawArtifacts) return 501 <上述文案>`（:3643-3653；依赖 sessionQuery + sessionPersistence + attachments 三个服务）。

**为什么**：

- `supportsRawArtifacts` = "后端是否暴露每会话原始产物"。jsonl 后端 true（`session-persistence-jsonl/src/index.ts:122`）：每个会话目录就是一份可打包的原始日志（压缩原文保 chunk packing、key order、换行——导出相当于把 raw artifact 原样取出）。导出器的实现读的就是**后端原始产物**。
- SQLite 后端 false（`packages/session/session-persistence-sqlite/src/index.ts:100`）：单库文件，没有"每会话的原始文件"可读（`locate` 直接 undefined，:173-175）——它的原始形态是一个大库里的行，不是"一个会话一件货"。
- 于是导出**不是产出一个坏 zip，而是明确说"不可用"**（501，带原因文案）。

**取舍**：抽象层的收益（业务代码零改动、后端可切换）兑现了；代价是**功能可及性改变**——jsonl 有的"导出"在 SQLite 下消失（除非另写导出器：从库中按 `(session_id, seq)` 读行重组 raw artifact 格式，或让导出器支持"SQL → 事件流 → 重打包"）。这也是 §15.4.5 取舍表里"功能面"与"存储面"分离的典型例子：接口不变，能力集变。

### 综合

**6. 画出 `prepare → load → commitPrepared` 的状态流转图，标出三个"重来"分支。解释为什么"commitRepair 后直接采用旧视图"是错的。**

**状态流转**（`packages/session/session-persistence/src/coordinator.ts:720-775`）：

```
prepare(sessionId)
  ├─ waitForRetirement ──► 有在途写？等待其退休
  ├─ 会话 live（已在运行）？──► 拒绝（:940 的 owner 守卫；读侧走 loadLiveSnapshot）
  ├─ preparations.reserve(serialize) ──► 登记"读 + 提交"对，序列化并发
  ├─ prepareCore：读盘 + 修复（洞、torn tail、闭包合成）
  ├─ commitPrepared：== 检查 prepared 修订 == 是否仍 current（isPreparedSourceCurrent）
  │     ├─ 是 ──► 提交（发布 inspection / 返回会话）
  │     ├─ 否（修订不一致）──► 重来：丢弃本次准备，回到 prepareCore 重读重修（循环）
  │     └─ commitRepair 分支：本次准备包含了修复（洞删除/闭包插入）──► 修复提交成功后
  │           return undefined ──► 触发重载（:945-948 注释：用修复前的视图配修复后的
  │           磁盘"必然错位"），回到 prepare 重新走
  └─ 提交后：owner 守卫 / 修订核对通过 → 发布

load(sessionId)  ← 与 prepare 同构，但只返回 inspection、不发布 session
  ├─ live？──► 直接读 live 快照（loadLiveSnapshot）
  └─ 否则：同 prepare 流程，commit 后返回 inspection
```

**三个"重来"分支**：

1. **修订不一致**（isPreparedSourceCurrent 返回 undefined/false，:966-971）：准备期间磁盘被别的写者推进（revision 变了）→ 本次"读+修复"的产物已过期 → 循环重读重修（协调器保证最终收敛）。
2. **修复后重载**（:945-948）：如果本次 prepare 执行了 `commitRepair`（把洞删掉、把闭包补上），commitRepair 成功后**主动 `return undefined`** 触发调用方重载——不能让"用修复前的视图"继续。
3. **owner 存在**（:940）：目标会话已有 live owner（正在运行）→ 写侧拒绝（prepare 路径拒绝）；读侧（load）改走 `loadLiveSnapshot` 拿在役快照，不碰磁盘。

**为什么"commitRepair 后采用旧视图"是错的**：旧视图 = 修复**前**读出的状态（含洞、缺闭包事件、cursor/revision 是修复前的值）。而 commitRepair 在**同一个事务**里完成了：DELETE 洞区 + INSERT 合成闭包 + revision+1（sqlite 侧 :309-338；jsonl 侧 rollbackAppend/repair 同理）。此时磁盘上的真相已经变了，旧视图与之有三重错位：

1. **内容缺失**：旧视图没有修复产物（合成闭包事件、被删的洞行）——模型/回放会看到残缺事件流（洞区缺事件 = 投影断裂；缺闭包 = 工具配对悬空）；
2. **cursor/revision 过期**：旧视图的游标停在修复前的 seq，后续 `append` 会与磁盘错位（seq 连续性检查直接拒绝，或者更糟——跳过检查后写到错误位置）；
3. **语义矛盾**：旧视图宣称"该会话有洞"，而磁盘已无洞——重放同一个会话得到两种不同结果。

所以修复后的正确动作是**重读**：以修复后的磁盘状态为唯一真相，重新 prepare（读+修+核对），再做 commitPrepared。注释的表述正是这个意思："用修复前的视图配修复后的磁盘"必然错位——两阶段协议的全部意义就是保证"提交前读到的"与"提交时在盘的"一致。

**7. 设计一个"最近 10 轮工具结果摘要"功能：用投影还是查事件流？缓存策略如何选取 `writeEveryEvents`/`writeIntervalMs`？请用 §15.5.1 的四件套给出单元定义要点。**

**选投影**。判据（§15.5.1，"事件流 → 可读值"的纯折叠）：

- **读视角**：这个功能被高频读取（每轮结束时模型/UI 都要看"近况"），投影把 O(n) 的全量折叠摊薄为增量更新；
- **纯折叠**：`apply(acc, event)` 只依赖 (acc, event)，可重放、可验证——与事件流查询（每次从头扫）相比，投影是"常读视图"的正确形态；
- **缓存可增量**：事件流查询每次都全扫，投影检查点只需要在事件时增量更新；
- **后端无关**：投影定义只依赖事件流，不依赖 jsonl/sqlite。

事件流查询（corpus/filters/tracing，§15.5.2）适合**一次性**的审计/统计分析，不适合"每轮都读的仪表盘"。

**四件套要点**（`packages/session/session-projection/src/index.ts:42-74`）：

| 要素 | 本功能取值 | 要点 |
|---|---|---|
| `key` | `'recent-tool-results'` | 投影单元 id，注册表索引（:171-184） |
| `init()` | `null`（或 `{ turns: [] }`） | 初始值 |
| `apply(acc, event)` | 只处理 `tool/result`：按 turn 归组（`turn/start` 开新组、`turn/end` 收组），滚动保留最近 10 轮的 `tool/call` 名 + 结果摘要；**无关事件原引用返回** acc | 引用不变 = 零下游（:53-55：未变化的 acc 直接复用，避免无谓通知/写缓存）；同 key 不同 stateVersion 拒绝（:208-210） |
| `view(acc)` | 对外读数（{ turn, tool, result }[]，或带截断的纯文本） | 只读、不可变 |
| `stateVersion` | `1` | 语义变化时 bump，作废旧缓存（:65-71） |

**缓存策略**（`packages/session/session-projection-cache/src/index.ts`）：`writeEveryEvents`/`writeIntervalMs` 是**必填**配置（`z.natural().min(1)`，:50-51——不给默认值，强制显式决策）；默认值看部署：`packages/bundle/web-app/cordis.patch.yml:79-80` 配的是 `writeEveryEvents: 200`、`writeIntervalMs: 5000`。本功能的合理取值：

- `writeEveryEvents` 调小（≈50）："最近 10 轮"的窗口 10 轮 × 每轮若干工具结果 ≈ 数十个事件，50 个事件一档让缓存追得上窗口滑动（每档 <= 窗口大小的一半量级，避免"缓存比窗口旧一截"）；
- `writeIntervalMs` 取 2000–5000：轮中节流（:213/:219 的节流逻辑），靠 `turn/end` 强制写（:206-207——轮末必然落盘，UI 下一轮必可读）与 `session/disposed` 强制写（:226）兜底；这样"轮中读"可能稍旧、**轮末读必新**；
- `fail-soft`（:68）：缓存写失败/过期 → 退回事件流重放，**功能不破、只慢**——对本功能是纯性能调参，不需要可靠性保证。

### 挑战

**8. 阅读 `materializePosix` 与 `materializeWin32`，比较二者在"两步发布"上的等价性；然后论证：为什么 Windows 路径不能用 POSIX 的 `link+unlink`，而 POSIX 路径也不能直接用 `MoveFileExW` 方案。**

**两步发布**（`packages/session/session-persistence-jsonl/src/index.ts:529-591`）：两平台都把"写临时文件"与"发布到目标名"分成两步，且发布都是**不覆盖既有文件**的原子动作：

| 步骤 | POSIX（:529-569） | Windows（:573-591） |
|---|---|---|
| 准备 | `rejectExistingLog` :542（目标已存在 → 拒绝） | 同（:594） |
| 写 | `writeSyncedTempFile`：`'wx'` 独占创建 + 0600 + **fsync**（:543、:606-616） | staging 文件 + MoveFileExW 路径（:573-591） |
| 发布 | `link + unlink`（:544-556）：硬链接把临时文件挂上目标名（EEXIST 防并发覆盖——另一个进程抢先发布了就失败），再 unlink 临时名；**父目录 fsync**（:560） | `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)`：staging → 目标名；**不设 MOVEFILE_REPLACE_EXISTING**（:8/:30/:118 注释），目标存在即失败；移动本身带 WRITE_THROUGH 语义 |
| 失败回滚 | 临时文件残留可清理；目标名从未出现半成品 | 同：staging 残留，目标名从未出现半成品 |

等价性：两者都保证"**要么未发布（目标不存在），要么已发布（目标是完整文件）**"，且**都不覆盖**别人的成果（并发发布者只会有一个成功）。差异只在原语来源：POSIX 靠"link 的 EEXIST 语义 + 父目录 fsync 使目录项持久"；Windows 靠"MoveFileExW 不替换 + WRITE_THROUGH 使元数据与数据一起持久"。

**为什么 Windows 不能用 `link+unlink`**：

1. **`fs.link` 目标存在时的行为平台相关**（**推断**）：Node 文档未跨平台保证"目标存在即 EEXIST"——POSIX 上 `link(2)` 对已存在目标返回 EEXIST（这正是并发正确性的来源），而 Windows 上同样调用的行为可能不一致（覆盖/报错因文件系统而异）；把"并发唯一性"押在平台差异上不可靠。
2. **没有"fsync 父目录"的 Node 合约**（这正是 win32 侧的注释——`packages/session/session-persistence-jsonl/src/win32.ts:1-12` 明说 Windows 没有该 Node 合约）：`link+unlink` 的持久性依赖"目录项 fsync"，Windows 上无等价公开原语，发布可能"成功但未持久"——两次崩溃后目标名存在性不确定。

**为什么 POSIX 不能用 `MoveFileExW` 方案**：

1. **原语不存在**：`MoveFileExW` 是 Win32 API，POSIX/Node 没有绑定；而"rename 覆盖目标"的语义是**替换式**的（rename(2) 在目标存在时静默覆盖），丢掉了"并发时 EEXIST 即失败"的来源——两个进程同时发布，后者会把前者的成果悄悄覆盖（数据丢失）。
2. `renameat2(RENAME_NOREPLACE)` 虽有无覆盖语义，但**没有公开的 Node 绑定**（**推断**：Node 的 fs.rename 不暴露 flags），不能依赖。

**结论**：两平台各用自己的"唯一不覆盖 + 持久"组合（POSIX=link+unlink+父目录 fsync；Windows=staging+MoveFileExW WRITE_THROUGH），机制不同但达成同一条发布不变式——"目标名上要么没有、要么是完整文件，且并发只允许一个赢家"。

**9. `assertOwnerOnly` 在 Windows 上跳过。请基于 Windows ACL 与 POSIX mode 的差异，设计一个"跨平台等价检查"，并说明为什么宁可跳过也不给"看起来严格"的伪检查。**

**现状**（`packages/credentials/credentials-local/src/index.ts:103-122`）：`assertOwnerOnly` 在 POSIX 上 `stat` 后检查权限位，非仅 owner 可读（mode 含 group/other 读）即抛错，文案 `credentials-local: <file> is readable beyond its owner (mode …); run "chmod 600 <file>" before starting again`（:117-120）；**Windows 直接 `return`**（:113），因为——模块注释（:96-101）："POSIX only: Windows has no mode to inspect — its ACLs are not expressible here — so the check is skipped rather than faked, and the file's protection there is whatever the create and replace APIs express."

**跨平台等价检查设计**（基于 Windows DACL）：把"仅 owner 可读"翻译成 ACL 谓词：

1. 读文件/目录的 DACL，验证：① owner（或 creator owner）就是当前用户（`process.getuid` 无意义，用用户名/SID 比较）；② 授权 SID 集合中**没有** `Everyone`/`Users`/内置匿名等宽松 SID；③ 继承规则没有被放宽（无继承自父目录的宽 ACL 传递）；④ 必要的 ACE（如拒绝 ACE）优先级正确。
2. 等价"chmod 600"的操作是：`icacls <file> /inheritance:r /grant:r <user>:(F)` 之类——但这是**修复动作**，且破坏任何显式共享意图。

**为什么宁可跳过，不做这个伪等价**：

1. **翻译必然失真**：POSIX mode 只有 9 个位，Windows ACL 是 ACE 列表（用户/组/继承/拒绝/审计）。把 ACL 折叠成"是否宽松"的布尔必然有假阳性（审计 ACE、特殊组）与假阴性（翻译位看上去 0600 但 DACL 含继承的 User 读取）。**伪检查会把保护语义误判**——"看起来像 600"不等于"只有你能读"，这比不检查更危险（给人安全错觉）。
2. **检查与保护不一致**：真正的保护由"创建/替换 API 表达 + 目录 ACL"承担（credentials-local 的 `set` 写权限位 :383/:394、`set` 拒绝空值 :336-339——安全默认在**写路径**上）。如果检查说"严格通过"而实际 ACL 宽松，就是"检查合格"与"事实不安全"并存——伪检查正是这种错位。
3. **诚实比严格重要**：跳过检查 + 文档声明"Windows 上凭据保护依赖用户目录 ACL 与创建/替换 API 的表达"，是**不承诺超出实际**；伪检查则承诺了一件没做到的事。凭据是冷秘密（§15.7.3），对它的承诺必须逐字兑现。

**建议**：保持 Windows 跳过（创建/替换 API 已表达 0600 等价物，且用户目录 ACL 是默认保护），在文档里写明"Windows 不做 mode 等价检查，保护由 DACL 承担"；若将来要做，就把上面 1 的谓词做成**只读诊断**（示警不拦截），或者在安装/初始化时**主动收紧**目标目录 ACL（`/inheritance:r` + 仅 owner）——用行动而非检查达成等价。

## 第 16 章　Web 与远程协议

### 理解层

**1. 不看源码，写出浏览器侧一条 `session.prompt` 从键盘到 `agent.followup` 经过的 7 跳，标注每一跳所在文件。**

（七跳是正文 §16.3 的骨架，16-Web与远程协议.md:122-140；以下按题面要求复述并标注出处。）

1. **浏览器侧发起**：客户端运行时 `connection.rpc.call('/api', '<ns>/<method>', {args}, signal)`，浏览器载体把它翻译成 `fetch` POST，路径即方法——`packages/client/connection/src/client/web-api-client.ts:13-16`（`doFetch` 就是 `globalThis.fetch`）。
2. **webserver 收到**：唯一的 HTTP/WS 宿主设施 `WebServer` 建服务器并分发——`packages/host/webserver/src/index.ts:148-179`；接入方 `client-connection` 注册 `/api` 前缀路由 + 信任栅栏（`packages/client/connection/src/index.ts:161-173`）。信任栅栏先验：Host 头必须是 loopback 或声明的 trusted authority，否则 403（`packages/client/connection/src/api-request-trust.ts:96-108`；这是防 DNS rebinding 的可达性策略，不是认证，:76-83 注释"explicitly not authentication"）。
3. **桥接**：`bridge()` 把 node:http 请求完整读入内存（上限 160 MiB，`packages/client/connection/src/http-bridge.ts:12`；超限 413 并销毁连接，:47-65），翻译成 fetch `Request`；客户端断开时 abort（:44-46，注释解释了为什么挂在 response 而非 request 上）。
4. **进入纯 fetch 处理器**：`toFetchHandler(api)` 是 `ApiProxy` 的封装（`packages/host/apiproxy/src/fetch/handler.ts:243-319`）——只认 POST（:273-275）；只有 `application/json` 放行（:283-286，415 = 载体层；跨站简单 POST 被强制进"服务器从不应答的预检"）。
5. **方法查表**：`methodFor(path)` 用 `UNARY_ROUTES` 查表（:146-148；全表约五十行、与 `RpcMethodMap` 锁定，:90-143，`'session.prompt'` 一行在 :99）；信封校验（method 与路径一致，:305-317）后进 `handleUnary`：schema 解析 payload，失败 → 200 + `bad-request`（:178-192）。
6. **域方法实现**：`session.prompt`（`packages/host/apiproxy/src/api-proxy.ts:2461-2517`）：校验 `clientTimeZone` 是合法 IANA 名（:2462-2472）→ `turnAgentFor(request, sessionId)` 解析 live/cold agent（:2473；统一入口 :1850，live 复用、冷会话恢复、subagent 拥有权围栏，见第 13 章）→ 以 `{ kind:'user', rpcId: request.rpcId, ... }` 构造 `MessageSource`（RPC 身份骑在持久化用户消息上，:2476-2481）→ 图片能力检查（:2482-2495）→ `durablePromptContent` → `createUserMessage` → `mode === 'steer' ? agent.steer(m) : agent.followup(m)`（:2496-2499）→ 失败映射 `attachment-error`/`agent-busy`（:2500-2513）。
7. **响应回来**：域方法返回窄形态 `RpcResponse`，`fullResponse` 补全为 `ServerResponse`（`packages/host/apiproxy/src/fetch/handler.ts:163-167`），HTTP 200 出网；浏览器侧按 `rpcId` 配对上响应（`rpcId` 品牌类型与四象限消息模型在 `packages/host/apiproxy/src/api/rpc.ts:150-186`——`ClientRequest`/`ServerResponse`/`ServerRequest`/`ClientResponse`，判别键是 `type` 字面量）。

**2. 用三句话解释：为什么浏览器 GET `/api/events.mux` 得到 426，而同进程载体却用 SSE 读同一条流？**

1. **426 来自连接层的严格握手，先于 ApiProxy 处理**：HTTP 载体经 `client-connection` 的 fetchHandler，它把对 MUX/HOST_EVENTS_PATH 的 GET 直接判为"需要升级"——返回 `426 Upgrade Required` + `connection: Upgrade` + `upgrade: websocket`（`packages/client/connection/src/index.ts:150-155`），浏览器被**明确要求**换成 WebSocket。
2. **浏览器侧事件流的唯一推送通道就是 WS downlink**：下行是两条 downlink-only 流（`events.mux`/`events.host`），websocket-downlink 只允许服务端往客户端推（客户端发消息 → close 1008 "downlink only"，`packages/client/connection/src/websocket-downlink.ts:109-111`）；浏览器拿不到 WS 升级就等于拿不到事件流，所以 426 是"宁可显式失败"而不是降级。
3. **SSE GET 是宿主侧的无信封读通道，只服务同进程载体**：`toFetchHandler` 里对 MUX/HOST 的 GET 直答（`packages/host/apiproxy/src/fetch/handler.ts:248-259`），它绕开信封/校验，供 `InProcessApiClient` 之类同进程载体把同一条流当 SSE 读（:243 注释"hands this function to InProcessApiClient as its transport aspect"）——这是**同一进程内的本地传输**，没有跨源、没有认证问题，自然不需要 426 那种"强制升级"的纪律；而浏览器跨网络必须走 WS 握手（升级前还有 `isTrustedApiRequest` 信任检查，:176-205）。一句话：426 是"浏览器必须走 WS"的声明，SSE 是"同进程载体顺手读"的实现细节——两条路共享同一条事件流，但入口纪律不同。

### 应用层

**3. 一个恶意页面想通过 `<form method="POST" enctype="text/plain">` 触发 `session.cancel`，服务器在哪一层、用哪个状态码挡住它？如果它改用 `application/json` 发呢？**

**`text/plain` 方案**：`<form enctype="text/plain">` 发出的 POST 是 CORS 语境下的 **simple request**（无预检直达服务器）——所以它确实能到达服务器，挡它的是**第 4 跳 `toFetchHandler`**：只认 `application/json`，其余一律 **415**（`packages/host/apiproxy/src/fetch/handler.ts:283-286`，注释原文："Cross-site write fence: browsers send 'simple' POSTs (text/plain, form encodings) without a CORS preflight … Only the JSON media type is accepted; anything else is forced into a preflight this server never answers. 415 = carrier layer."）。

**`application/json` 方案**：跨源 `fetch` 带 `Content-Type: application/json` 会先触发 **CORS 预检**（`OPTIONS` 预检请求）——服务器从不应答预检（没有任何 OPTIONS 路由），浏览器收到预检失败后**根本不发实际 POST**。也就是说这个方向是"在到达服务器之前"就被浏览器 CORS 机制挡掉了，服务器无需出码。

**为什么 415 是主闸**：信任栅栏（Host 头，`packages/client/connection/src/api-request-trust.ts:96-108`）在这个场景**放行**——跨站页面发往 `http://127.0.0.1:3080` 的请求 Host 头就是 `127.0.0.1:3080`（合法 loopback），DNS-rebinding 围栏管的是"Host 是别人家的域名"，管不了"恶意页面故意打 localhost"。所以真正的闸门是载体层的"强制 JSON"：简单 POST 被 415 拒绝 = 即使页面看不到响应（浏览器不可读响应），**副作用也不会发生**。注意 415/400/404 只表达载体层错误；业务错误一律 HTTP 200 + `ServerResponse`（`packages/host/apiproxy/src/fetch/handler.ts:1-7` 的注释是规范）——这里是"载体拒绝"，所以用载体状态码 415，正确。

**4. 用户开着 Web UI 时断网 30 秒又恢复。结合 `events.mux` 基线与 `ConnectionController` 的严格握手，说明客户端靠哪些帧恢复视图；若断线期间恰好有一笔待审批，为什么重连后仍能作答？**

**恢复顺序**（`packages/host/apiproxy/src/api-proxy.ts:3429-3532` + `packages/client/connection/src/index.ts:176-205`）：

1. **重新握手**：升级前 `isTrustedApiRequest(req, trustedHosts)` 再次验证（非受信来源在协商前就被 403，`packages/client/connection/src/websocket-downlink.ts:144-153`——"forbidden"）；通过后走 WS 升级建立新的下行连接。
2. **`session/subscribed` 帧**：客户端重新 `subscribe` 后，mux 基线是"先快照、后监听"——`session/subscribed`（:3433-3435）先到达，宣告该会话已进入监听集合。
3. **`session/queue` 快照帧**（:3436-3447）：**快照**包括当前会话队列与 `pendingApprovals`，且以**稳定 rpcId** 重放——断线期间发生的排队/审批被一次性补齐，客户端不用逐帧猜。
4. **后续 `session/event` 帧**（:3475-3494）：每条帧**带 view**（`viewFor`，`packages/host/apiproxy/src/api-proxy.ts:744`——`presentCall`/`presentResult`、scope 解析、`JSON.parse` args、失败软降级），客户端拿到的是"可展示形态"，重放成本低。
5. **`openCalls` 表**（:3470-3473）：在途调用清单，配合 `created`/`disposed` 帧（:3495-3508）更新会话集合；`iterate` cleanup 处理会话销毁（:3528-3531）。

**断线期间那笔待审批**：`pendingApprovals` 的**生命周期独立于连接**——它以稳定 rpcId 存在（快照重放 :3436-3447），断线不会让它消失。重连后：

- 快照里含该审批 → 客户端把审批状态恢复给用户 → 用户作答走 `respond`；
- `respond` 的语义是"先 question 后"（`packages/host/apiproxy/src/api-proxy.ts:3696-3742`）：审批请求还没被答过就按审批处理；若在断线窗口已被别的路径处理，则回 `not-pending`——两种情况都不会"重复审批"或"丢失审批"。

要点：视图恢复不依赖"重放所有丢失帧"，而是"快照 + 增量帧"；而**审批是跨连接的持久语义**（存在队列/快照里，不是存在连接里），所以断线只断传输、不断待办。

### 综合层

**5. `UNARY_ROUTES` 里挑 5 个方法，往 `PRIVILEGED_METHODS` 的取舍逻辑上归类：为什么 `llm.discoverModels` 在而 `llm.models` 不在？为什么 `agentPreset.select` 不在而 `agentPreset.read` 在？**

先看取舍逻辑本身（`packages/client/connection/src/index.ts:89-119`）：`PRIVILEGED_METHODS` 是 16 项白名单——`agentPreset.read/copy/openDocument/remove`、`host.pickDirectory/openPath`、`settings.describe/openDocument/update/replace/mutate`、`credentials.describe/set/unset`、`llm.discoverModels`。它们的共同点：**读写宿主秘密/机器状态/驱动宿主**。这些方法即使 trustedHosts 声明了远程来源，也还会**再以空信任列表复核**（:119-124、:147 `isTrustedApiRequest(request, [])`）——即"无论谁声明，一律只接受回环"。

选 5 个方法归类：

| 方法 | 归类 | 理由 |
|---|---|---|
| `session.prompt` | 普通执行面（不在特权集） | 它只会"以进程身份发起对话/执行"——注释原文："any caller that may start a session at all can already run commands as this process"（:119-124）；会话控制与能力授予无关，不属于"宿主状态管理" |
| `llm.models` | 静态目录（不在特权集） | 无凭据、无 endpoints 的纯目录查询，是 LAN 模型选择器需要的（:85-88 注释"llm.providers/llm.models 故意不在——无 endpoints/keys"） |
| `llm.discoverModels` | 带凭据探测（在特权集） | 它接受 `apiKey`/`baseURL` 去**探查 adapter**（`packages/host/apiproxy/src/api-proxy.ts:3400-3414`）——会发网络请求、会用（或暴露）凭据，属于"驱动宿主/摸宿主口袋" |
| `agentPreset.read` | 读取部署面（在特权集） | 读 preset 组合 = 侦察部署可提供面/读本地文件内容；与 `copy/remove/openDocument` 同组（都是"动 preset 目录"） |
| `agentPreset.select` | 能力是创建时授予的（不在特权集） | 注释："CHOOSING one is not pinned…session.create already takes an agentPreset…pinning the switch would be a fence beside an open gate"（:89-119）——会话创建本来就可以带 agentPreset，钉死"切换"这个动作等于"在开着的门旁设栏"；capability 不是 preset 授予的（默认已带 bash+fs） |

**一句总结取舍标准**：能**改变/读取宿主机器状态或秘密**的方法进特权集（读=侦察、写=动宿主）；**纯目录/静态元数据**不进；**能力与会话创建同源**的不重复设栏（开了门就不必给门把手加锁）。

**6. 设计一个局域网部署：宿主要求同一台机器上的另一台设备（`192.168.1.50`）用浏览器访问。写出需要的最小配置组合（`--host`、`--trusted-host`、目录选择后端），并指出为什么不能直接 `--host 0.0.0.0`；再列出 3 个必须钉在回环的调用面。**

**最小配置组合**：`dsh --profile web --host 127.0.0.1 --trusted-host 192.168.1.50` **加上 SSH 端口转发**（宿主机上 `ssh -L 3080:127.0.0.1:3080 user@192.168.1.50`，或在 `192.168.1.50` 上建立到宿主机的反向隧道）——让那台设备通过**隧道的 localhost** 访问宿主的 3080。目录选择后端自动退为 `browse`（`directory-picker-auto` 的 resolve：`bindHost !== '127.0.0.1'` 即走浏览，`packages/bundle/web-app` 侧 `resolve.ts:40-53`）——SSH/非回环下没有 native 对话框可达，浏览（上传/手输路径）是唯一安全选择。

**为什么不能直接 `--host 0.0.0.0`**：

- **实现面**：webserver 的 `Config.host` 只有 `'127.0.0.1' | '0.0.0.0'` 两个字面量（`packages/host/webserver/src/index.ts:45-50`）；而 web 的启动器在 action 里**明确拒绝** `0.0.0.0`——`packages/bundle/web-app/src/startup.ts:69-71`："intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead"。CLI 层面就过不去（更别说 bind 到局域网接口的字符串，两个字面量之外都不接受）。
- **推理面**：能开会话 = 能以进程身份执行代码（默认就带 bash/fs 能力，见第 9/11 章工具面）；绑定 0.0.0.0 = 让**局域网任何设备**都能开会话 = 暴露远程代码执行。而 `--trusted-host` 只是 **DNS-rebinding 围栏**（`packages/client/connection/src/index.ts:76-83`："explicitly not authentication"），它管"Host 头是谁"，不管"连上来的是谁"——把 trustedHosts 当认证用是误解。
- （若用户愿意承担风险，可用 profile patch 把 `host: '0.0.0.0'` 写进 `cordis.patch.yml` 绕过 CLI 守卫——**推断**：CLI 拒绝发生在 startup 的 action，profile 层的宿主配置直接由 webserver 消费，可能绕过；但这是明确的自担风险操作，不推荐。）

**3 个必须钉在回环的调用面**（都以 `PRIVILEGED_METHODS` 为边界，见 `packages/client/connection/src/index.ts:89-124`，连接层对它们以空信任列表复核 `isTrustedApiRequest(request, [])`）：

1. **特权方法全集（16 项）**：`agentPreset.read/copy/openDocument/remove`、`host.pickDirectory/openPath`、`settings.describe/openDocument/update/replace/mutate`、`credentials.describe/set/unset`、`llm.discoverModels`——读写宿主秘密（凭据）、宿主配置（settings）、宿主机器状态（目录对话框/打开路径）；
2. **宿主操作子集（host.\*）**：`host.pickDirectory`/`host.openPath` 直接操作用户机器；且 native 后端在非回环/SSH 下被强制降级为 browse——"够不着"不是"被允许"，物理不可达 + 特权复查双保险；
3. **设置/凭据写面（settings.\*、credentials.\*）**：`settings.update/replace/mutate` 与 `credentials.set/unset` 写的是 `$DSH_HOME` 下的配置文件与凭据文件——即宿主文件系统；远程设备一旦摸到，等于拿到了宿主配置与秘密的写权限。

注意区分：426/415 是**载体层纪律**（任何客户端、任何连接方式都得遵守），与回环无关；**无条件回环**只属于特权方法集——整个信任模型是"能连接 ≠ 能读写宿主状态"。

### 挑战层

**7. 假设你想给 ACP 加 `session/load`（恢复既有会话）。对照 `packages/acp/acp/README.md` 的限制清单与 `packages/api/gateway/src/index.ts:251-275` 的 `newSession` 实现，指出：它需要复用哪些宿主设施（提示：冷恢复、`turnAgentFor` 的围栏语义），会破坏 ACP 的哪条现存承诺（"连接生命周期=会话生命周期"），并给出你的取舍论证。**

（先勘误：题面所引 `packages/api/gateway/src/index.ts:251-275` 的 `newSession` 实核不在该处——gateway 该区间是 `resolveSrcDescriptor`/`srcDescriptor` 相关代码；ACP 的 `newSession` 实际在 `packages/acp/acp/src/index.ts:251-277`，以下按实核位置作答。）

**现实现的骨架**（`packages/acp/acp/src/index.ts:251-277`）：`assertOpen` → `validateSessionParams` → `randomUUID` 造 SessionId → **`agents.create({ sessionId, meta: { cwd }, agentOptions })`**（注释 :257-259："No preset composition…"——ACP 侧没有 preset/roster 组合，只能给 agentOptions）→ closed 竞态时 `dispose` → `sessions.set`（连 dispose/inflight 一起登记）。ACP 的承诺在 README:22-30（方法表）与 :78-80："Fresh sessions only — load, list, resume, delete, fork are unsupported"、"Connection-owned lifetime — one connection releases all of its sessions; per-session close is not implemented"。

**`session/load` 需要复用的宿主设施**：

1. **冷恢复（两阶段）**：`SessionPersistence.prepare/load` 两阶段（§15.2.5：waitForRetirement → live 拒 → reserve → prepareCore 读+修 → commitPrepared 修订核对/修复后重载/owner 守卫）——load 不是"造新会话"，而是"把磁盘日志恢复成 live agent"，必须按**持久化种子**（会话头里的 cwd/header）而不是"新 cwd 种子"创建；
2. **`turnAgentFor` 的围栏语义**（`packages/host/apiproxy/src/api-proxy.ts:1850`：live/cold 解析、"This is `session.prompt`'s enforcement boundary"）——load 恢复出的 agent 用哪个 provider/model 配置，必须在加载时明确（ACP 侧没有 preset 组合可提供默认），并且 live 复用/冷恢复/subagent 拥有权围栏（"refusing here names the model…while the draft is still in the composer"，:1850 语境）要同样生效：恢复前先判断该会话是否已 live（双活 owner 围栏，§15.2.5 的 owner 守卫）。

**会破坏哪条现存承诺**：

1. **"Fresh sessions only"**：load 直接与 unsupported 清单冲突。更重要的是 ACP 的 `authenticate` 是无操作（一次性权限模型）——load = **恢复既有会话的执行权** = 把"新会话初始化"升级成"任意会话接管"，谁的会话都能加载，权限语义必须重定义；
2. **"Connection-owned lifetime"（连接生命周期 = 会话生命周期）**：newSession 的会话是连接拥有的（连接关闭 → 全部释放；`sessions.set` 登记 dispose/inflight，:251-277）。loaded 会话的生命周期归属不明：随连接销毁 → 误杀其他来源的会话；不随连接销毁 → 破坏"one connection releases all of its sessions"；这正是题面点名的破坏点；
3. **（附）"No preset composition"**：load 恢复的会话需要模型/配置路由决定，ACP 无 preset/roster 组合，得在 load 参数里显式带（或拒绝恢复需要自定义组合的会话）。

**取舍论证（推荐方案）**：先加认证，或把 load 收窄为 **"own sessions only"**——即"fresh + own"：只允许加载"本连接先前创建、且当前无他人持有"的会话。具体做法：新增 `session/load { id }`：先 `prepare`（读+修）→ `agents.create({ sessionId, seed })` 冷恢复 → 成功后**该连接成为唯一新 owner**（把"连接生命周期=会话激活生命周期"收窄为"连接生命周期=其激活的会话的生命周期"）；协议表加一行、客户端状态机加 loaded 态。在 `authenticate` 仍是 no-op 的现阶段，**不建议做通用 load**（恢复任意会话 = 权限提升）；若一定做，先给 ACP 加认证或强制回环。取舍核心：load 的收益（承接长会话工作）vs 代价（打破"即开即用、即断即弃"的一次性模型 + 权限语义重定义）——在认证补上之前，收益小于风险。

**8. 对比 SDK 的 `session.event` 通知与浏览器 `events.mux` 的 `session/event` 帧：二者同源于 `session/event` 事件，但一个带 view、一个不带。从"消费方是谁、渲染需要什么"出发，论证这种分叉是否合理，以及如果让 SDK 也带 view 会引入什么协议负担。**

**同源**：都源于宿主会话的 `session/event` 事件——SDK 侧由 `packages/sdk/server/src/server.ts:71-74` 把它转成 `session.event` 通知；浏览器侧由 `packages/host/apiproxy/src/api-proxy.ts:3475-3494` 把它包成 `session/event` 帧（带 view）。

**消费方与渲染需求**：

| | SDK（`session.event`） | 浏览器（`session/event` 帧） |
|---|---|---|
| 消费方 | **机器/程序**：有自己的处理逻辑（统计、转发、驱动子流程、审计） | **人**：要"立即可展示"的 UI |
| 需要什么 | **原始事件**（自己决定怎么折叠/投影/丢弃） | **渲染就绪的视图**：`presentCall`/`presentResult`（工具调用展示文案）、args 解析（`JSON.parse` 成可读结构）、scope 语义（哪个 agent/会话）、失败软降级（坏 JSON 降级显示原文，`viewFor`，api-proxy.ts:744） |
| 分叉合理性 | 原始事件 = 数据，SDK 拿它是为了**计算** | view = 显示件，浏览器拿它是为了**展示**；把"展示计算"放在离上下文最近的服务端（api-proxy 有完整 scope/agent 语境） |

**分叉是合理的**：同源不同形——同一个底层事实，两种消费方各取所需。SDK 若拿到 view，还得剥掉展示层再找原始字段（丢弃信息）；浏览器若只有原始事件，得自己实现 scope 解析与展示归约（重复劳动）。责任切分线是"展示责任在服务端、数据责任在协议"。

**若让 SDK 也带 view，协议负担有四条**：

1. **帧体积 + 每事件计算成本**：`session/event` 是高频流（chunk 事件），每帧都要跑一次 `viewFor`（present 归约、args 解析、scope 解析、软降级），SDK 用不上的展示数据全被计算 + 传输——带宽与 CPU 双向浪费；
2. **SDK 被迫处理第三态**：view 可能缺失/降级（`viewFor` 失败时降级），SDK 得定义"无 view 怎么办"——协议多了一个"展示件可能不存在"的状态；
3. **展示语义泄漏进协议**：presentation 约定（present 文案、prompt 的展示形式）若成为协议字段，那"展示内容变更"就成了协议变更——协议稳定性被 UI 需求绑架；
4. **诱导 SDK 弃用原始事件**：一旦 SDK 有了顺手可用的 view，写手很容易直接消费 view（图省事）——但 view 是投影/快照（不是完整事件），丢字段、非原始，SDK 依赖它等于失去重放/审计/自定义投影的能力，数据面被悄悄降级。

结论：分叉合理，且是"展示归服务端、数据归协议"的正确切分；SDK 保持原始事件是对"机器消费者"的正确服务。

## 第 17 章　扩展实战

### 理解

**1. 用你自己的话写出六动词的生命周期图，并解释"define 返回后为什么还不能调用"。**

六动词（`packages/extensions/tool-cordis/README.md:5-23`）：

```
inspect（list/query/self）──► 只读报告，任意时刻可调
        │
define ──► 只记录：登记插件定义（包不可变、id 稳定、语法预检编译但不运行）
        │
run ────► 评估 + 投递：评估授权与配置 → 激活（宿主半区立即可用；有 browser 半区则
        │           round trip 等人批准）→ 插件进入 live
        │
live ───► 运行中：可再次 run（已运行则重新投递、不失败）
        │
stop ───► 解绑一次 live dispatch：handlers 丢弃、fiber 到 quiescence、retract 广播；
        │          定义存活，可再 run
        │
undefine ──► 先 stop 再忘：定义从注册表消失（卡片留作 unloaded record）
```

**"define 返回后为什么还不能调用"**——因为 `define` 只有**记录**语义，一切"有效果"的动作都挂在 `run` 上（`packages/extensions/cordis-host-runner/README.md` "Two phases"："`define` only records, and everything with an effect hangs off a run"）。具体有三层理由：

1. **define 无可回滚的 effect**：它只做 trim/校验/预检（`precheckCode` 编译但不运行，`packages/extensions/cordis-host-runner/src/index.ts:150-200`），所以"定义完整但未激活"是安全的中间态；若 define 就装配，出错的装配没法回滚，还会留下半激活的插件；
2. **run 才有授权语义**：运行插件 = 让其代码在宿主侧执行，需要授权（browser 半区包要 `cordis/request-run` → suspend → 批准/AbortSignal）；define 绝不触碰授权；
3. **run 才有生命周期**：stop/undefine 都作用于"被 run 过的实例"；define 后的定义只是注册表里的一条记录（`registry.add`，`cordis-host-runner/src/index.ts:150-200`），调用它没有任何装配发生。

一句话：define 是"写意愿"，run 是"执行意愿"；二者之间隔着授权与装配两道门。

**2. 解释 `cordis_stop` 与 `cordis_undefine` 的差异；`mintPluginId` 为什么用 `do-while` 而不是直接 `+1`。**

**差异**（`packages/extensions/cordis-host-runner/README.md`）：`stop` = **解绑一次 live dispatch**——handlers 被丢弃、fiber 退到 quiescence、retract 广播，但**定义存活**（注册表里的记录还在，可以再 run）；`undefine` = **先 stop 再忘**——把定义从注册表移除（工具卡片变成 unloaded record，不可再 run）。类比：stop 是"停机不卸载"，undefine 是"卸载并注销"。

**`mintPluginId` 为什么用 `do-while`**（`packages/extensions/cordis-host-runner/src/registry.ts:145-167`）：

```ts
private mintPluginId(prefix: string): string {
  let id: string
  do {
    id = `${prefix}-${this.nextPlugin++}`
  } while (this.plugins.has(id))
  return id
}
```

三个原因（JSDoc："mint a semantic plugin ID without reusing a prior suffix"）：

1. **计数器单调不等价于 id 唯一**：`nextPlugin` 是进程内单调递增的计数器，但 id 的海峡是 `plugins` map——模型可控的前缀（plugin.idPrefix 必须 `/^[a-z]{3,6}$/`，`index.ts:150-200`）矿出的 id 可能与**已存在**的 id 相撞（例如 `dyn` 前缀 + 序号，而某插件名就叫 `dyn-3`）；`do-while` 的 `has` 查重保证"不重用已有后缀"；
2. **计数器被其他路径消耗**：`nextPlugin` 在别的调用里也会 +1（比如失败的定义尝试），直接 `+1` 会产生"跳过号"，虽然不影响正确性，但 `do-while` 让"查重"成为唯一权威；
3. **`do-while` 保证至少分配一次**：即使空 map（没有任何插件），循环体也要执行一次才返回——这是"先做后判"语义，`while` 先判的话，空 map 下第一次就退出、返回一个未定义 id。

对照 `mintPackageId`（直接 `pkg-${nextPackage++}`，无查重）：包 id 没有语义前缀（模型不可控）、没有复用需求，计数器单调即唯一（**推断**：包名既不被外部引用也不可被用户指定，所以无需查重）——二者不对称恰好说明 `do-while` 的查重不是普遍需要，而是专门保护"模型可控前缀"的 id 空间。

**3. 说出 `deny > ask > allow` 与"首个 continue:false 粘滞"分别解决什么问题。**

头注释（`packages/hooks/hook-protocol/src/merge.ts:3-6`）："Permission precedence is `deny > ask > allow`; the first `continue:false` stop is sticky; reasons for the winning rank are joined; and context and system messages accumulate in hook order."

- **`deny > ask > allow` 解决的问题**：多个钩子（可能来自不同插件/不同配置）对同一事件给出不同决策时，**最严格者胜**，且**决策顺序无关**——先输出的 `allow` 不会被后输出的 `deny` 覆盖，反之亦然。实现：rank 打分（`deny`/`block`=3、`ask`=2、`approve`/`allow`=1，:37-50），只保留**胜出秩**一档（`reasonsByRank` 只留胜出秩的理由并合并，:63-99）。若没有优先级，任何钩子都能"放宽"别人的决定——安全策略会被最宽松的钩子击穿。
- **"首个 `continue:false` 粘滞"解决的问题**：`mergeHookOutputs` 按钩子顺序累积，一旦遇到第一个 `continue:false`（停止），之后**再宽松的输出也不能停止单向的闩**——即"停止"是单向闩（latch）：先说不继续，后面谁说继续都不算。这防止"钩子 A 说 stop、钩子 B 说 go"时最终变成 go（若允许后者覆盖，停止语义被稀释）。

两者合起来是同一原则的两半：**决策向最严收敛（横向）、停止向首次收敛（纵向）**；而 `additionalContext`/`systemMessages` 则**按钩子顺序累积**（不取最严，全收）——决策收紧、内容累加，两者方向相反但互不干扰。

### 应用

**4. 给 `dsh-audit-cat` 加第二个工具 `audit_ls`（列目录，`ctx.fs.listDir`，`packages/fs/fs/src/index.ts:208`）：只读、可并发、也进审计；写出它的 `defineTool` 参数与一个测试用例。**

**`defineTool` 参数**（对照正文 17.6 的 `audit_cat` 模式，17-扩展实战.md:203-299）：

```ts
ctx.tools.register(defineTool({
  name: 'audit_ls',
  description: '只读列出指定目录的第一层条目（名称、类型、大小），写入审计日志。',
  parameters: {
    dir: { type: 'string', required: true, description: '要列出的目录路径（绝对或相对会话 cwd）' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['file', 'directory', 'other'] },
              size: { type: 'number' },
            },
            required: ['name', 'type'],
          },
        },
      },
      required: ['path', 'entries'],
    },
    render: result => JSON.stringify(result),
  },
  isConcurrencySafe: () => true,   // 只读，可与其他工具并行
  async execute(exec) {
    const cwd = exec.agent?.session.header.cwd ?? '.'
    const target = resolvePath(cwd, exec.arguments.dir)          // 解析到绝对路径
    const entries = await ctx.fs.listDir(target)                 // packages/fs/fs/src/index.ts:208
    const result = {
      path: target,
      entries: entries.map(e => ({
        name: e.name,
        type: e.type,          // FsDirEntry：name/type/target/version?/size?（types.ts:104-119）
        ...(e.size !== undefined ? { size: e.size } : {}),
      })),
    }
    await this.audit('audit_ls', { dir: target, entries: result.entries.length })  // 复用审计写入
    return result
  },
}))
```

要点：`ctx.fs.listDir(target)` 返回 `FsDirEntry[]`（`packages/fs/fs/src/index.ts:208`；`FsDirEntry` 字段在 `packages/fs/fs/src/types.ts:104-119`：`name`、`type: 'file'|'directory'|'other'`、`target`、`version?`、`size?`）；`resolvePath`/`resolve` 在 fs 抽象内（fs/src/index.ts:116 `resolve`）；只读工具 `isConcurrencySafe: () => true` 允许并行执行（`packages/core/tools/src/schema.ts:594-615` 软验证）；同时把调用写进审计（沿用 `audit-cat.guidance` 里的审计约定，并在系统提示段加一句："`audit_ls` 会记录每次目录查看"——与 audit_cat 的说明并列）。

**测试用例**（沿用 17.8 的 FakeFs 范式——`tool-fs/tests/tools.spec.ts:38/:102-108/:113-118/:123-125`）：

```ts
it('audit_ls 列出目录并带 size/type', async () => {
  const fs = new FakeFs({ cwd: '/proj' })
  fs.mkdir('/proj/src', { mode: 0o755 })
  fs.writeFile('/proj/README.md', 'hello')          // 预置目录与文件
  const seen: FsDirEntry[][] = []
  fs.listDir = async (target: string) => {          // 覆写抽象方法（原引用存起来）
    const entries = await listDirImpl(target)
    seen.push(entries)
    return entries
  }
  const ctx = new Context()                          // 排插件：fs/session/systemPrompt/audit 依赖
  ctx.provide(sessionSvc, fakeSession)
  ctx.provide(fsSvc, fs)
  ctx.provide(auditSvc, fakeAudit)
  const tool = registerAuditTools(ctx)               // 插件注册 audit_cat + audit_ls
  const result = await ctx.tools.execute('audit_ls', { dir: 'src' }, { agent: fakeAgent })
  expect(result).toMatchObject({ path: '/proj/src' })
  expect(result.entries.map(e => e.name)).toContain('index.ts')
  expect(result.entries.every(e => e.type !== undefined)).toBe(true)
  expect(fakeAudit.calls).toContainEqual(expect.objectContaining({ tool: 'audit_ls' }))
})
```

要点：**FakeFs 预置目录**——用内存假件（Map 存文件树）代替真实磁盘，`listDir` 以重写抽象方法的方式捕获调用（同步断言）；**`ctx.tools.execute` 直调**工具；**无 mock、无网络**（第 17 章测试范式：FakeFs 假件 + `new Context()` 排插件 + execute 直调，:349-377）。

**5. 用 `dsh --profile tui --patch` 挂载你的插件，验证 audit 日志生成；把插件行挪进 profile 的 `cordis.patch.yml` 再热改一次，对比两次的"改代码到生效"时延差异。**

（题面用 `--profile tui`；正文 17.7.1 的示例是 `--profile web`，`--patch` 机制与 profile 无关，二者等价。）

**第一次：`--patch` overlay**。命令形如 `pnpm dsh --profile tui --patch ./dsh-audit-cat/cordis.patch.yml`（`--patch <path>` 走 `loadOverlayPatches`——`packages/boot/app-boot/src/index.ts:268-296`，与 profile/home 的 optional 层是**两条路径**；patch 文件须顶层 YAML 数组；单条缺目标行只是 per-entry 警告，:330 错误文案带 label；`--patch` 的绝对路径约束见 17.7.1，:307-324；CLI 侧 `apps/cli/src/args.ts:51-61/:84-102`）。验证：调用 `audit_cat` 后检查审计日志文件出现新行。

**生效时延（第一次）**：`--patch` overlay 递进来的文件**不在热重载监视清单里**（**推断**——`watchUserPatches` 的 `UserPatchWatchOptions.filename` JSDoc 明确是"profile 的 `cordis.patch.yml`"：`packages/boot/app-boot/src/index.ts:213-215`；监视路径是 `hmr.registerConfig(filename, …)` 对 **user layer 的 patch 文件**做的，:226-263；而 `--patch` overlay 走的是 `loadOverlayPatches` 另一条路径 :268-296；正文 17.9 坑 3 亦指出"热重载只监视 profile 的 cordis.patch.yml 与 home 层补丁"，17-扩展实战.md:404）。因此：**改插件源码 → 必须重启进程**（改代码生效 = 重新加载 JS；进程状态全丢）——分钟级、且丢失当前会话/内存状态（**未验证**：具体时长依赖启动开销，本机无构建产物）。

**第二次：挪进 profile 的 `cordis.patch.yml`**。把插件行写进 `$DSH_HOME`/profile 的 `cordis.patch.yml`（user layer），重启后热重载接管——`watchUserPatches` 经 Cordis HMR `hmr.registerConfig(filename, …)` 对 user layer **事务性重放**（:226-263；无 HMR 或无 root Include 抛错；INACTIVE_EFFECT 返回 no-op disposer）。

**生效时延（第二次）**：

- 改 **patch 文件**（调整插件行、参数）→ 热重载监视到变更 → 事务性重放 user layer → **秒级**生效、进程状态保留（**未验证**：重放耗时依赖 profile 规模）；
- 改**插件源码文件** → **不在监视清单内**（**推断**：监视对象是配置文件的 config 注册路径，不是插件 JS 源码）——仍需重启或触发 HMR 重载，与第一次相同。

**对比结论**：`--patch` overlay 适合**临时分发**（一次性验证、临时覆盖），改代码必须重启，分钟级 + 进程状态丢失；profile `cordis.patch.yml` 是**开发期常态**——配置层热改秒级生效（会话状态保留），但插件代码变更同样需要重启。所以开发期把插件行放 profile 的 `cordis.patch.yml`（配置热改），源码迭代时接受"改源码→重启"；`--patch` 留给"不污染 profile 的临时挂载/分发验证"。

### 综合

（题面为二选一；下面对第 6、7 题都给出完整方案与论证。）

**6.（方案一）把审计日志改成"按会话的增量订阅流"：`session/event` → 队列 → 每 500ms 批量写一次。论证批量对 O(n²) 的改善、进程崩溃时最多丢多少行、以及为什么仍要保留 `callId` 匹配。**

**现状的 O(n²)**（正文 17.6 性能注记，17-扩展实战.md:297）：`audit_cat` 每次调用都是"读-拼-写"——把整份审计文件读到内存、追加一行、全文重写；n 次调用下来总代价 O(n²)。

**方案**：插件监听 `session/event`（`packages/sdk/server/src/server.ts:71-74` 的同源宿主事件；宿主侧由 `api-proxy.ts:3475-3494` 下发），把与本会话相关的 `tool/call`/`tool/result` 事件对放进**内存队列**；每 500ms 批量 `append` 一次（一次打开文件、把队列里所有行一次性写出），并在 `turn/end`/`session/disposed` 时强制 flush。写路径从"每次调用读-拼-写全量"变成"每 500ms 追加批量行"——磁盘 I/O 次数从 O(n) 降到 O(n/批)，且**不再重写旧内容**（追加语义 + 每会话一个文件），总代价降到 O(n)，即"每次批量写 = 常数因子 × 每批条数"。

**崩溃最多丢多少行**：**最多丢最后一次 flush 之后、崩溃前入队的行**——即 ≤ 一个批量间隔（500ms）内累积的未落地行数（**未验证**：上限 = 间隔内事件条数，本机无构建产物；但推演链成立——事件先入内存队列、后落盘，`write-behind` 同思路，§15.2.6 的 write-behind：`:30 DEFAULT_WRITE_BATCH_MAX_DELAY_MS=200`，协调器也是批量延迟写）。注意：**审计文件是派生数据**——会话事件本身已由 `session.append` 持久化（第 8 章事件日志），崩溃丢的只是"审计文件的增量"，不等于丢会话事实；若审计的完整性要求高于此，可在 `turn/end` 强制 flush（把丢失窗口压到单轮内）或改由事件重放重建。

**为什么仍要保留 `callId` 匹配**：

1. **事件天然成对**：`tool/call` 与 `tool/result` 都携带 `turn/step/callId`（第 8/9 章事件载荷），审计行要记录"哪个调用、结果如何"，必须用 `callId` 把二者配对——没有它，审计只能记"发生了什么"，不能记"完成与否"；
2. **跨会话/未知 callId 忽略**：批量流里混有其他会话、其他 turn 的事件，`callId` 是过滤与归属的键（匹配失败的行丢弃，不污染审计）；
3. **防重放/乱序重复记账**：断线重连后同一事件可能被重复投递（快照 + 增量），`callId` 让审计写入幂等（已见过的 callId 跳过），乱序到达的 result 也能靠 callId 找到挂起的 call 记账。

**7.（方案二）用 `hooks-claude-code` 的配置，为 `PostToolUse` 写一个脚本：把工具调用的 stdout 摘要追加进同一个审计文件。论证：桥路径与原生插件路径在这个需求上的四个差异。**

**配置**（`packages/hooks/hooks-claude-code/README.md`：configPath 必填、pluginRoot/projectDir、defaultTimeoutMs=600_000、stderrSummaryMaxChars=500；仅 shell form 运行，`http/mcp_tool/prompt/agent` 解析即跳过；hook 映射表：PostToolUse → tools/post-execute）：

```json
{
  "configPath": "/abs/path/to/hooks.json",
  "hooks": {
    "PostToolUse": [
      { "matcher": "audit_cat", "type": "command",
        "command": "/abs/path/to/audit-append.sh", "timeout": 30 }
    ]
  }
}
```

`hooks.json` 里 `PostToolUse` 的 matcher 选中 `audit_cat`；`audit-append.sh` 从 stdin 读 payload（`tool_name`/`tool_input`/`tool_use_id`/`tool_response`——`postToolPayload`，`packages/hooks/hooks-claude-code/src/index.ts:322-343`），把 `tool_response` 的 stdout 摘要追加进审计文件。桥在 `runPoint('PostToolUse', …, postToolPayload)`（:244-266）：deny → `{ kind:'block', feedback: [reason ?? 'blocked by PostToolUse hook'], additionalContexts }`；否则 `next()` 后 prependContext（PostToolUse 的上下文在 **post-execute** 投递给下游决策）。

**四个差异**（对照 README:7 的定位句："A native cordis plugin could do everything this bridge does — more powerfully, with typed returns and no serialization boundary. The bridge exists only as a compatibility path for the mapped CC command-hook subset"）：

| 维度 | 桥路径（hooks-claude-code） | 原生插件路径 |
|---|---|---|
| **类型安全** | 无类型：脚本读 stdin JSON、写 stdout JSON；`parseHookOutput` 以**退出码 2 = block 且 stderr 为 reason**、exit 0 且 stdout 以 `{` 开头才尝试解析 JSON、malformed 宽松为无结构化输出（`packages/hooks/hook-protocol/src/codec.ts:55-85`）——字段拼写/类型错误只能运行时发现 | `PostToolDecision` 是 TypeScript 类型，编译期检查字段与分支；监听器签名即契约 |
| **序列化边界** | 脚本经 **stdin/stdout JSON** 传递；payload 是**文档化快照**`postToolPayload`（`packages/hooks/hooks-claude-code/src/index.ts:322-343`：session_id/transcript_path/cwd/hook_event_name/tool_name/tool_input/tool_use_id/tool_response），且 `content` 被降为文本——`blocksToText` 取 `content.filter(b => b.type === 'text').map(b => b.text).join('')`（:318）——**原内容块的结构（类型、嵌套、非文本块）丢失** | 原生监听器拿 `tool/result` 原始载荷（结构化 content blocks），字段无损 |
| **提示段** | CC 的 `systemMessage`/`updatedInput` **未实现**：`packages/hooks/hooks-claude-code/src/index.ts:170-183` 仅 warn 忽略（"systemMessage and updatedInput are logged or warned but are not model-visible in this implementation"，README）——**无法经桥注册持久提示段**；审计提醒只能塞进 stderr/上下文 | 原生可 `systemPrompt.section` 注册提示段，且每次组装时求值（正文 10.2 的 section 机制）——审计说明持久可见 |
| **错误可见性** | `runHook` **永不 throw**（故障 = 非阻塞）：错误以 `hook/invoked` + `hook/result` 事件 + stderr 摘要呈现，`summarizeStderr` 截断 500 字符加 `…`（`packages/hooks/hook-protocol/src/events.ts:53`）——脚本崩了宿主只记一条事件 | 原生插件的异常在监听器上下文里抛出、测试可断言（`assert.rejects`），故障显式、可恢复 |

**结论**：针对"把工具 stdout 摘要追加进审计文件"这类需要**结构化写入 + 持久提示 + 故障可见**的需求，原生插件路径完胜——桥只在"必须复用现有 CC command-hook 脚本、且只做兼容映射"时才有价值（README:7）。若你已经在 17.6 写了 `dsh-audit-cat` 原生插件，PostToolUse 桥不应作为第二实现，而应该直接给插件加监听器（如 `ctx.on('tool/result', …)` 或工具内自审计）——差别不是"能不能"，而是"类型、结构、提示、错误"四处都更可控。

### 挑战

**8. 给"动态插件"设计一个**白名单守卫**：模型经 `cordis_define` 提交的 host 代码，在你自己的 `agent/pre-step` 钩子里被静态扫描（禁止 `require`、禁止 `fetch`），不通过则拒绝 run。说明你的守卫与 `guard.ts` 的 façade 各自防住什么、共同缺口是什么。**

**守卫设计**（先例：`packages/extensions/tool-cordis/src/index.ts:381-398`——agent/pre-step 注入 `@pluginId` 上下文：`next()` 后若 reject 原样返回；`referencedPluginIds(messages)` → refuse 时 `renderUnavailableReference`；`createUserMessage` source `{kind:'plugin', plugin:name, form:'instructions'}` → `{kind:'enter', messages:[...decision.messages, ...contexts]}`）：

1. **挂载点**：`agent/pre-step` 钩子（或 `cordis_run` 工具执行前），从消息里解析出 `cordis_define` 提交的 host 代码（define 参数中的 `code`/`file` 字段，参考 `plugin.idPrefix` 校验与 `precheckCode`，`packages/extensions/cordis-host-runner/src/index.ts:150-200`）；
2. **静态扫描**：对代码文本做 AST/正则扫描——禁止 `require`、`import`、`fetch`、`child_process`、`eval`/`Function` 构造、`process`/`globalThis` 逃逸模式；**白名单 API** 只允许 `ctx.fs.readText/listDir/stat`、`ctx.web.fetch?`（按部署决定）、`ctx.bash`（若声明）；扫描不通过 → 在 run 前拦截：要么拒绝 `cordis_run` 工具调用（模型看到明确错误），要么让插件进入 `refused` 状态（参考 `renderUnavailableReference` 的拒绝渲染）；
3. **与 define 的配合**：define 只登记、run 才评估——守卫的拦截点应在 **run**（授权 + 装配之前），与"Two phases"一致；define 阶段只做语法预检（已有 `precheckCode`）。

**与 `guard.ts` façade 各自防住什么**（`packages/extensions/cordis-host-runner/src/guard.ts:1-30`，模块注释：注册边界 = ParameterSchemaSpec 规范化 + 教学错误、`harness.defineTool/registerTool` 标记对、SANDBOX CONTEXT FAÇADE——运行插件 `apply` 收到的是**白名单生命周期安全动词 + 声明服务的白名单 façade**，框架内部与 context 值服务返回被拒；VM-realm schema 重建；JSON 同构检查 `isPlainRecord`/`hasIntrinsicConstructor`）：

- **我的守卫（静态度）**：防的是"**代码文本层面**的越界"——模型能不能在提交的代码里**直接写** `require('fs')`/`fetch('http://…')` 这类不安全调用；它守卫的是"**入口文本**"；
- **guard.ts façade（运行态面）**：防的是"**哪怕文本没被禁、运行起来也只能碰到白名单**"——插件 `apply` 拿到的 `ctx` 是白名单构造的 façade，`defineTool/registerTool` 被标记、schema 被重建、值服务拒绝——它守卫的是"**运行时接触面**"；
- 两者互补：静态守卫拦"显式危险文本"，façade 拦"运行时越权访问"，构成"入口 + 接触面"两道。

**共同缺口**：

1. **vm 隔离不是安全边界**（README "Trust stance"：服务声明可达 live runtime、host-realm helpers 可逃逸——"像信任 bash 一样信任它"）：动态包 = **bash 同级信任**；守卫与 façade 都不是安全边界，只是"护栏"——真正信任决定在部署层（谁允许模型提交并运行动态包）；
2. **静态扫描可被绕过**（**推断**）：字符串拼接 `globalThis['re'+'quire']`、`eval`、`import('xxx')`、`process.mainModule`、`Reflect.construct` 等动态构造都可能穿透文本扫描——AST 静态分析只能抓"字面量"；
3. **façade 不防"合法面滥用"**：若插件声明了 `ctx.bash`，它就可以跑任意命令（bash 本身就是能力面）——守卫管不了"用合法 API 做越权的事"（沙箱隔离 globals 但非安全边界）；
4. **守卫只覆盖"请求时机"**：pre-step 拦截的是"模型提交的请求"，不防运行期注入（动态 `require` 拉入的模块、运行中改写行为——**推断**）。

**结论**：信任决策是**部署级**的（把动态包当 bash 访问）；你的守卫 + guard.ts façade 是"习惯性护栏"——提高攻击成本、拦截最粗的越界，但不提供安全保证。若产品要求"模型生成的插件绝不能危害宿主"，当前架构做不到，需要真正的进程隔离（子进程/容器）而非 vm。

**9. 阅读 `ensureStanding` 的 `TODO`（`packages/preset/agent-presets/src/index.ts:491-534` 附近与 `packages/preset/agent-presets/README.md:150`）：为 standing 挂载实现"最后一位加入者离开即回收"，给出需要新增的计数与回收时机，并指出它为什么比现在的"超代不回收"更难。**

**TODO 原文**（`packages/preset/agent-presets/src/index.ts:501-507`）："reclaim the superseded generation once the last agent joined to it is gone. The subtree is not inert — `dsh-skill-filesystem` watches its roots — and the settings-page authoring flow turns 'a composition changed' into a per-save event. This needs a joined-agent count on StandingMount, incremented in `mount`/`composeFrom`/`recompose` and decremented when the agent's scope key dies."

**现状**（`ensureStanding`，:492-534）：单飞（single-flight）——`standings` map 按 preset id 存一次挂载；`compositionStamp = mtime + size` 作为代际；文件变更 → 生成下一代会挂载（`if (this.standing.get(preset.id) === pending) this.standing.delete(preset.id); return this.ensureStanding(preset)`，:509-511 的 "Guarded delete"）；**超代不回收**（README:150）——旧的 standing 子树（fiber 与作用域）永远留在内存。

**需要的计数与回收时机**：

1. **新增 `joinedAgents` 计数**：`StandingMount` 上新增 `joinedAgents: number`；在 `mount`/`composeFrom`/`recompose`（代理加入 standing 的每个动作）**递增**，在"agent 作用域键消亡"时**递减**（agent scope key 死 = 该代理不再引用这个 standing——需要可靠的作用域消亡钩子）；
2. **回收时机**：`joinedAgents` 归零 **且** 存在更新代际（`compositionStamp` 判断——当前 standing 不是最新代）→ 对该代际执行 `stop`/`dispose`（解绑 fiber 到 quiescence、卸载视野），再做"Guarded delete"式的指针清理（与 `ensureStanding` 的竞态保护一致）；
3. **回收动作**：先 stop 再隐去（避免在役引用被拆——与 `cordis_stop` 的"解绑一次 dispatch"语义一致），再删 `standings` 条目/释放 scope（`scope.dispose()`，:521-523 的错误路径已有先例）。

**为什么比"超代不回收"更难**：

1. **"作用域键消亡"没有现成信号**：scope 是纤维/作用域机制（第 2/11 章），"agent 作用域键死"需要精确的销毁/恢复/替换钩子（agent 销毁、session 恢复、子代理替换时都要递减），而且要与 `ensureStanding` 的**单飞竞态**协同——TODO 明确提到 "needs a joined-agent count on StandingMount" 而不仅仅是计时器；
2. **被监视的子树不是惰性的**：`dsh-skill-filesystem` 监视 standing 的根目录——回收不能破坏监视把柄（监视器可能还引用旧代际的路径），回收与监视生命周期要协商；
3. **settings 页按保存事件驱动**：组合文件变更 → `recompose` 是在"per-save"事件上触发的——计数的增减必须与该动作**同事务**（同一次异步动作里完成递增 + 生成新代，避免计数与代际错位）；
4. **泄露 vs 误杀的取舍**：现在"超代不回收"虽然泄漏（内存 + 陈旧 fiber），但**绝无误杀**——新会话加入时走 `standingKeyFor` 的 `ensureStanding`，单飞保证 join 的是最新代；一旦引入回收，"最后一位离开"的判定若出错（计数漏减/多减），就会把**正在被引用的** standing 拆掉——这是比泄漏严重得多的事故。现状的取舍是"用可控泄漏换绝对安全"，回收则是"用复杂度换内存"，必须在正确性证明充分后才值得。

（补充：若坚持回收，最小可行方案是"回收只做 fiber quiescence、保留目录监视把柄"，把"销毁监视根"从回收动作里排除——宁可让 skill 目录多活一会，也不拆引用。）

---

## 附：第 1–4 章练习答案的核验说明

- 本部分所有"文件:行号"均在仓库 `C:/Users/yq/Desktop/develop/deepseek-harness`（HEAD `47f943859b`）实读核实。
- 与正文标注存在 1–2 行偏差、以本部分实核行号为准的引用：`apps/cli/src/bin.ts:36`（正文引 bin.ts:34 处为 `invocation.args` 的实际行号）、`apps/cli/src/dump-config.ts:1-7`（正文引 1-6，`@module` 在 6）。
- 正文与本部分一致、但容易读错的精确行号（已逐行 grep 核对）：`agent-loop/src/agent.ts:438-441`（`agent/request` 分发点，`:440` 默认行为 `seedConfig`，`:443-445` 校验）、`vendor/cordis/src/context.ts:115`（isolate 同 label 合并作用域注释）、`vendor/cordis/src/logger.ts:251`（`[symbols.invoke]` 定义）、`vendor/cordis/src/fiber.ts:620`（epoch 的 `':' + uid` 拼接）、`fiber.ts:746/:749`（`internal/update` waterfall 与 `restart()`）、`packages/bundle/base/cordis.patch.yml:16-17/19-22/24-25/27-28/436-439`（timer/hmr/llm/session/agent-loop 行，正文 1.4.3 标注略偏 ±1-2 行）。
- 标注**（未验证）**的题目：第 1 章应用层 3、4——需构建后的 `dsh` 二进制；已按题面要求以源码阅读与 `apps/cli/tests/built-bin.e2e.ts:724-761` 测试断言推演代替，推演所依据的测试行已逐条核实。

