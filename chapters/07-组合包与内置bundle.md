# 第 7 章　组合包与内置 bundle：base / headless / web-app

## 本章学习目标

1. 给出组合包（bundle）与配置档案（profile）的规范定义，并能说清它们的区别与关系（发布单元 vs 运行入口）；
2. 说出 base 组合包按主题装了哪些插件行（定时器/llm 路由/会话/typert/设置/凭据/持久化/沙箱/工具/审批/遥测……），以及 headless 与 web-app 各追加了什么；
3. 读懂 `standard` agent preset 的 group + isolate + 嵌套 config 写法，并解释"服务行必须放进带 isolate realm 的组"的原因；
4. 知道"bundle 之上永远还能 patch"，能写出一个覆盖 bundle 行的用户 patch。

**本章讲法**：演进/对比型——从"一份超大 cordis.yml"到"可复用组合包 + package.json 的 dsh 声明"的演进叙事；三份内置 bundle 的 patch 文件并列对照；agent preset 作为"配置即代码"的样板。

---

## 7.1 反事实：假如整个 dsh 只有一份 cordis.yml

第 5 章我们学会了用 cordis.yml 声明一棵插件树，第 6 章得知一次 `dsh --profile` 启动本质是"在空根上按顺序铺 patch 层"。现在把问题推向极端：**如果没有组合包这一层，dsh 的全部插件行都写进一份文件，会怎样？**

1. **行数失控**。bundle 目录的 patch 文件里，base 一份就含 78 个条目（见 7.3.1），web-app 再叠 78 个（见 7.3.3），headless 又叠 6 个。合在一份文件里既难审阅，也无法回答"这一行属于谁"。
2. **模式差异无法表达**。web 与 headless 的差别不过几行，却必须在同一份文件里写两遍；而 patch 语义是 **config 整行替换、不合并**（第 5 章）：把"某个模式的值"直接写在共享行上，另一个模式就要整行覆盖、重述全部字段。
3. **升级冲突没有缓冲层**。设计者改进某个默认值，与该行上用户覆盖的旧值"谁最后写谁赢"，中间没有任何分层。

base 组合包 patch 文件的开头注释（`packages/bundle/base/cordis.patch.yml:1-13`）把这三条约束直接写成了设计规则：

```yaml
# A patch replaces the targeted row's whole `config` rather than merging into
# it, so a row whose value differs by mode does NOT live here: it belongs to
# each mode bundle, keeping any single row down to one bundle layer plus the
# user's. Mode-specific rows appear below only with shared plugin identity and
# neutral defaults; each mode bundle restates its complete configuration.
#
# Row order carries no load semantics (activation is service-availability
# driven); the grouping is for readers.
```

提炼出三条设计准则：① 值随模式而异的行不放进共享层；② 任何一行最多由"一个 bundle 层 + 用户层"书写，行归属可追；③ 行序无语义（激活由服务可用性驱动，见第 3 章的 epoch 依赖），分组只是为读者。

演进给出的答案是**三层拆分**：`dsh-base`（共享核心）→ 模式 bundle（`dsh-headless` / `dsh-web-app` 表层）→ 用户层。这引出本章的两个新概念：组合包与配置档案。

## 7.2 两个新概念：组合包与配置档案

### 7.2.1 组合包（bundle）

**① 类比建立直觉**：搭木屋时，你有若干"通用零件盒"和"样式盒"（阳台盒、阁楼盒），每个盒子贴一张清单说明含哪些零件；用户只需按顺序选盒子叠放，而不是把整栋楼的零件清单抄一遍。组合包就是这样的盒子——它的"实体"是自己盒内的那张清单（patch 列表），盒子上"贴的标签"是 package.json 里的 dsh 字段。

**② 精确定义**：组合包（bundle）是一个 npm 包，在其 package.json 的 `dsh.bundle.patch` 字段中声明一份 patch 文件的相对路径；这份 patch 文件（一份顶层 YAML 数组）就是组合包的实体。官方文档的原话是"组合包的实体是它的 patch 列表；有些组合包还附带由其 patch 挂载的运行时粘合插件"（`packages/bundle/README.zh.md:5`）。

**③ 最小示例**——`@deepseek-ai/dsh-base` 的 package.json 中与此相关的全部实质内容（`packages/bundle/base/package.json:36-40`，其余字段省略）：

```json
{
  "name": "@deepseek-ai/dsh-base",
  "version": "0.1.0-rc.5",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "dependencies": {
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^"
  }
}
```

注意两点：其一，组合包**没有运行时 API**——组合器只读 manifest 字段、解析 patch 文件，从不 import 包代码（`packages/bundle/base/README.md`："the profile composer resolves the patch through the dsh.bundle.patch manifest field, never through code"）；其二，`dependencies` 里列的包，正是 patch 文件里各行的 `name:` 标识符所引用的插件——**Patch 是声明，依赖才是安装**。

### 7.2.2 配置档案（profile）

**① 类比**：bundle 是"零件盒"，profile 是"操作台"——一张图纸声明"按什么顺序叠哪些盒子"（`dsh.profile.bundles`），外加一块用户自己的补丁区（`cordis.patch.yml`）。

**② 精确定义**：配置档案（profile）是 `$DSH_HOME/profiles/<name>` 目录，内含两份关键文件：`package.json`（`dsh.profile.bundles`——有序的 bundle 包名列表，以及树外插件的依赖）与 `cordis.patch.yml`（用户自己的 patch 层，应用在每一个 bundle 层之后）（`packages/boot/app-boot/src/profile.ts:5-13`）。

**③ 最小示例**——首次运行 `dsh --profile headless` 时按模板自动生成的 profile manifest（`initProfile` 的结构见 `packages/boot/app-boot/src/profile.ts:152-168`，模板值见 `:114-117`）：

```json
{
  "name": "dsh-profile-headless",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } }
}
```

### 7.2.3 bundle 与 profile 的关系：发布单元 vs 运行入口

`profile.ts` 把 package.json 的 `dsh` 段拆成两个 half（`packages/boot/app-boot/src/profile.ts:41-70`）：

```ts
/** The bundle half of the `dsh` manifest section: what a bundle package exports. */
export interface DshBundleManifest {
  /** The patch layer this bundle exports, relative to its package root. */
  patch: string
}

/** The profile half of the `dsh` manifest section: what a profile directory composes. */
export interface DshProfileManifest {
  /** Ordered bundle layer list (package names). */
  bundles?: string[]
}

/**
 * The profile-launcher slice of the `dsh`-owned package.json section. A
 * manifest may declare both roles; other consumers own additional keys.
 */
export interface DshManifestSection {
  /** Bundle metadata consumed by the profile launcher. */
  bundle?: DshBundleManifest
  /** Profile metadata consumed by the profile launcher. */
  profile?: DshProfileManifest
}
```

- `dsh.bundle`（bundle half）回答"我这个包贡献哪份 patch"——**发布单元**；
- `dsh.profile`（profile half）回答"这个目录按什么顺序叠哪些 bundle"——**运行入口**；
- 同一份 manifest 允许同时声明两个角色（`packages/boot/app-boot/src/profile.ts:53-55` 注释），所以第三方包可以是 bundle 也可以是 profile。

内置的三个 bundle（base / headless / web-app）是发布单元；`dsh web` 与 `dsh --profile headless` 是模板化的运行入口。树外（out-of-tree）bundle 通过 `dsh plugin --profile <name> add <package>` 安装进 profile（`packages/bundle/README.zh.md:13`）。

### 7.2.4 入口自动初始化与"安装所有权"

`loadProfile`（`packages/boot/app-boot/src/profile.ts:371-403`）的装载流程值得逐条看：

- 目录不存在且名字是模板名（`web` / `headless`）→ 调 `initProfile` 按模板写入（`packages/boot/app-boot/src/profile.ts:376-384`）；
- 目录不存在且不是模板名 → 抛错，提示用 `dsh plugin --profile <name> add` 创建（`:378-382`）；
- bundles 列出的包解析到之后，若其 manifest 没有 `dsh.bundle` 声明 → **直接抛错**："naming a bundle-less package as a layer is a misconfiguration, not 'no patches'"（`:388-394`）。这是"loud"设计：把不是一个组合包的包放进层列表是配置错误，而不是"没有 patch 而已"。

`PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:114-117`）给出模板：`web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`，`headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']`；没有模板的其他名字用 `DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']`（`:125`）。

还有一条容易被忽略的"**安装所有权**"规则：`INSTALLATION_OWNED_PROFILE_TUPLES.headless` 是三元组（base + web-app + headless，`packages/boot/app-boot/src/profile.ts:120-122`）。若某个 headless profile 的 bundles 恰好等于这个三元组（说明它是 `dsh plugin` 流程装出来的原样拷贝），`normalizeShippedProfile` 会把它**改回发布模板的二元组**（`:297-312`）；任何其他列表视为用户自有、原样不动。这样升级 dsh 后模板若变化，安装自带的 profile 会被归一，而用户定制列表不受影响。

## 7.3 三个内置 bundle：并列对照

先说总量——按 patch 文件中的条目（id 行）统计：base 78 条、headless 6 条、web-app 78 条。

| 包名 | `dsh.bundle.patch` | 条目数 | 角色一句话 | 增量内容 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-base` | `./cordis.patch.yml` | 78 | 每个 profile 的第一层：共享 dsh 核心 | 见 7.3.1 |
| `@deepseek-ai/dsh-headless` | `./cordis.patch.yml` | 6（3 覆盖 + 3 插入） | 一次性任务模式 | persona、工具 mode、关 hmr、code-runtime、headless-runner |
| `@deepseek-ai/dsh-web-app` | `./cordis.patch.yml` | 78（4 覆盖 + 50 插入 + 23 禁用 + 1 预设行） | 浏览器表层 | host 行、传输层、UI 名录、agent plane 移入 preset |

### 7.3.1 `dsh-base`：78 条"共享核心"

base 的 patch 是一个 `- insert:` 块（`packages/bundle/base/cordis.patch.yml:15` 起），一次插入全部 78 条（按 `- id:` 行计；文件共 451 行，没有顶层行）。按主题分组走读（行号均为该文件）：

**（1）基础设施**（`packages/bundle/base/cordis.patch.yml:16-22`）：`timer`（定时器服务——第 3 章讲过的 HMR、轮询都依赖它）、`hmr`（模块热重载，`root: ['.']`）。

**（2）模型与会话主干**（`packages/bundle/base/cordis.patch.yml:24-73`）：`llm`（适配器路由）、`session`、`typert` / `typert-loader` / `typert-gateway`（远程协议类型图三件套，第 16 章）、`session-title`（`fallbackMaxWords: 5` 等一组回退标题参数）、`session-title-llm`（LLM 起标题：`targetWords: 5`、`targetCjkCharacters: 10`、`timeoutMs: 60000`）、`user-questions`（向用户提问通道）、`agent`、`jobs`、`llm-retry`、以及 `agent-default-model`——注意它的注释（`:61-62`）："传输无关的默认入口点用默认值；设置可提供已保存的选择，消费方在创建时读取"，配置为 `provider: deepseek-official, model: deepseek-v4-flash`（`:63-67`）。

**（3）用户配置面**（`packages/bundle/base/cordis.patch.yml:78-96`）：`settings`（`$DSH_HOME/settings.yaml` 热重载文档，Web Models 页写的就是它）、`credentials`（优先级链：进程环境 > `$DSH_HOME/.credentials.yaml` > 项目与用户 `.env` 回退，第 15 章详述）、`llm-pi-ai`——**休眠挂载**的孪生适配器：没有 `llm-pi-ai:` 设置节时零路由、不出现在模型选择器，设置节一出现路由就现场注册，节一清空又消失（`:88-96` 注释）。

**（4）持久化与投影**（`packages/bundle/base/cordis.patch.yml:98-161`）：`session-persistence-jsonl`（`root: !!js dshHomePath('sessions')`）；`attachment-local`（图片字节内容寻址，不进入仅追加的会话日志）；`session-query-sqlite`（`:117-121`）——默认 `path: ':memory:'` 且 **`openAt: never`**：`ctx.sessionQuery` 保持挂载（精确读取、标题、血统追踪可用），但内容检索调用直接报 `SESSION_QUERY_SEARCH_DISABLED`，SQLite 永远不打开；部署要开全文检索就在更晚的层覆盖 `openAt`（注释 `:109-116`）；`session-projection`（子代理目录身份投影的共享注册表）；`session-telemetry-otel`（`:148-161`）——`mode: !!js process.env.DSH_TELEMETRY_MODE || 'DISABLED'`，即遥测**默认关闭**、只显式 opt-in；注释（`:129-147`）还约定：`DSH_TELEMETRY_DISABLED` 任何非空值（含 `'0'`/`'false'`）都硬禁用，且"config 不能禁用一行"——禁用只能靠启动器加 patch（第 6 章的 telemetry 开关就是这么做的：`apps/cli/src/profile-boot.ts:168-169`）。

**（5）沙箱与安全栈**（`packages/bundle/base/cordis.patch.yml:163-205`）：`subprocess`、`sandbox`、`sandbox-policy`（`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`，`workspaceRoot: !!js process.cwd()`，`:172-176`）、`bash-sandbox` / `pwsh-sandbox`（平台门控，见下）、`approval`（`policy` 一行脚本：权限模式是 `danger-full-access` 就 `never`，否则 `ask`，`:188-191`）、`permission`（三预设：`read-only` / `workspace-write` / `danger-full-access`，各配对 sandbox 模式与 approval 策略，`:193-205`）。

**（6）工具与 agent 面**（`packages/bundle/base/cordis.patch.yml:207-394`）：`shell-env`（`:207-208`，发布 `DSH_WEB_URL`/`DSH_WEB_MODE` 的 host 行——7.4.3 注入标准的案例）、`tool-bash` / `tool-pwsh`（平台门控）、`tool-jobs`、`fs-observation-policy`（读后写策略）、`tool-fs`、`tool-fs-search`、`agent-instructions`（`maxBytes: 65536`）、`skill` / `skill-filesystem` / `skill-badge`（**disabled: true**——徽章默认关）/ `tool-skill`、`commands` / `command-feedback` / `goal` / `goal-round-driver` / `command-goal`、`plan-mode`（config 是一整段计划模式提示词，`:267-279`）、`token-meter`、`compaction-basic`、`command-compact`、子代理家族（`subagent` 注册表、`subagent-spawn-in-process`、`subagent-fork-in-process`、`tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`（spawn / continuable，`:313-318`）、`tool-subagent-fork`（**fork 保持 one-shot**：continuable 子代理的 `report` 工具会排在 fork 想复用的继承历史之前，`:320-329` 注释）、`tool-subagent-report`）、`workflow-worker-thread`、`tool-workflow`、`timeout-policy`、`spill-local` / `spill-policy`、`session-checkpoint-policy`、`tool-result-pruner`（`thresholdChars: 8192`）、`tool-todo`、`tool-goal`、`tool-ralph`、`tool-str-replace-editor`、`repeat-tool-reminder`（`thresholds: [3, 5, 8]`）。

**（7）模型面 web 能力**（`packages/bundle/base/cordis.patch.yml:396-418`）：`web`（`searchProvider: deepseek-official`）、`web-search-deepseek`（`apiKeyEnv: DEEPSEEK_API_KEY`）、`tool-web`——**`fetch: false`**。注释（`:396-403`）讲清了取舍：每个模式都启用稳定的 `web_search` 工具；fetch 提供方被刻意不挂载，因为它延后了 SSRF 防护、且请求目标由模型选择；搜索是一次带服务端检索的完整辅助模型请求，所以这条 DeepSeek 路由给 60s，而提供方无关的工具默认只有 30s。

**（8）"每个模式都挂载"的中性行**（`packages/bundle/base/cordis.patch.yml:420-451`）：base 只给中性默认——`tools`（不留 presentation mode）、`system-prompt`（`persona: ''`）、`agent-loop`（`agents: []`，注释"base 保持空；原始 overlay 可创建 agent"）、`fs-sandbox`（`cwd` 默认 `process.cwd()`）、`llm-deepseek`（**不内联 key 和 endpoint**：两者都在请求时从 `llm-deepseek:` 设置节与凭据存储解析，thinking 默认是部署选择，`:446-449` 注释）。这正是 7.1 准则②的落地：这些行的"值随模式不同"，由各模式 bundle 用自己的行重新声明。

**平台门控**是 base 里"一份文件、两种宿主机"的机智做法（`packages/bundle/base/cordis.patch.yml:178-186`）：

```yaml
- id: bash-sandbox
  name: '@deepseek-ai/dsh-bash-sandbox'
  disabled: !!js process.platform === 'win32'
  config:
    timeoutMs: 60000

- id: pwsh-sandbox
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  disabled: !!js process.platform !== 'win32'
```

`tool-bash` / `tool-pwsh` 用同样的互补表达式（`packages/bundle/base/cordis.patch.yml:210-216`）。README 补充了完整配方警告：Windows 上想恢复 bash，必须**同时**禁用 `pwsh-sandbox`/`tool-pwsh` 两行**并**启用 `bash-sandbox`/`tool-bash` 两行——两个执行器家族注册同一个 `bash` 服务，残缺的配方会在加载时报错（`packages/bundle/base/README.md`）。

### 7.3.2 `dsh-headless`：6 条的一次性模式

headless 的 patch 全文只有 35 行（`packages/bundle/headless/cordis.patch.yml:1-35`）：先覆盖 3 行、再插入 3 行。

```yaml
- id: system-prompt
  config:
    persona: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

# The shared module-reload HMR row stays off; the launcher's watch-only
# fallback still keeps the user patch layers live until the run exits.
- id: hmr
  disabled: true

- id: tools
  config:
    mode: !!js process.env.DSH_TOOLS_MODE

- insert:
    # Code Mode is a core execution capability, not a Web component.
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'

    - id: headless-startup
      name: '@deepseek-ai/dsh-headless/startup'

    # Reads its task from the ordinary headlessStartup provider.
    - id: headless-runner
      name: '@deepseek-ai/dsh-headless'
      inject: [headlessStartup]
      config:
        task: !!js ctx.headlessStartup.task
```

逐行走读：

- **`system-prompt` 整行覆盖**：persona 从空串换成 coding agent 模板。`{{model}}` 与 `{{cwd}}` 不是拼好的字符串，而是在该 agent 自己的路由与工作区解析（第 10 章的渲染机制）；
- **`hmr` disabled**：runner 是一次性的（跑完即退），模块热重载没有意义。注释说启动器的 watch-only 回退仍然让用户 patch 层保持实时（第 6 章 `watchUserPatches`）。**web-app 也禁用了 hmr，但理由不同**——"共享 HMR 的 Web 重载生命周期尚未测试"（web-app `packages/bundle/headless/cordis.patch.yml:21-23` 注释）：同名动作、两种动机，这是对照阅读的价值点；
- **`tools` 的 `mode`** 从 `DSH_TOOLS_MODE` 环境变量取：Code Mode 是核心执行能力、不是 Web 组件（`:23` 注释）；
- **`code-runtime` 插入**：base 里没有它，headless 与 web-app 各插一份（web-app `:48-49`）；
- **`headless-startup`**：一个"普通提供方"——注入 `ctx.cmdlineArgs`，解析 `dsh --profile headless "<task>"` 的位置参数并处理 `--help`，提供 `headlessStartup` 服务（`packages/bundle/headless/README.md`）；
- **`headless-runner`**：`inject: [headlessStartup]`，task 用 `!!js ctx.headlessStartup.task` **懒表达式**——在提供方出现之前不求值，这正是第 5 章"`internal/config` 瀑布在激活后解析"的应用：参数解析完成前 runner 不激活，没有 task 时直接拒绝（README 的"missing or whitespace-only task is rejected before the runner activates"）。

headless 的**语义增量只有这 6 条**：它挂载 Host、HTTP 服务器、Web 运行时或浏览器插件中的任何一样（patch 头注释 `packages/bundle/headless/cordis.patch.yml:1-5`）。

### 7.3.3 `dsh-web-app`：浏览器表层 + agent plane 迁移

web-app 的 patch 共 78 条 id：4 条顶层覆盖（`packages/bundle/web-app/cordis.patch.yml:16-41`）+ 50 条插入（`:47-273`）+ 23 条顶层禁用（`:293-408`）+ 1 条预设插入（`:420-424`）。按主题分六段走读：

**（1）表层值**（`packages/bundle/web-app/cordis.patch.yml:16-41`）：`system-prompt`（与 headless 相同的 persona 模板）、`hmr` disabled、`session-query-sqlite` **重述**（与 base 相同的 `:memory:` + `openAt: never`——注释说明：重述让 Web 值留在单一临时内存索引上，部署改 `openAt` 后 `node:sqlite` 的导入与句柄被推迟到首次搜索，Node 22 启动保持安静）、`tools` 的 `mode`（`DSH_TOOLS_MODE`——注释明确这是"per-session tool-presentation 设计完成前的 **TEMPORARY workaround**"）。

**（2）web-only host 行**（`packages/bundle/web-app/cordis.patch.yml:47-108`，14 条）：`code-runtime`、存储三件（`storage` / `storage-json`（`root: !!js dshHomePath('storages')`）/ `storage-domain`（`backend: json`））、`message-feedback`、`session-log-download`（浏览器会话导出：`/export` 命令 + 共享下载对话框）、`workspace`、`session-projection-cache`（`writeEveryEvents: 200, writeIntervalMs: 5000`）、`session-stats`（聊天统计条）、`directory-picker`（启动时按宿主机事实在 native / browse 后端间自适应，第 16 章）、`plugin-inventory`（Loader 条目的只读投影，供可信客户端 RPC）、`api-gateway`、`cordis-host-runner`、`web-startup`。

**（3）传输层**（`packages/bundle/web-app/cordis.patch.yml:110-143`，3 条）：

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
```

- `webserver`：默认 **127.0.0.1:3080**；host/port 从 `webStartup` 服务取，带部署回退。而 `web-startup` 在发布该服务**之前**拒绝 `--host 0.0.0.0`——"CLI 目前有意不支持绑定所有网络接口"（`packages/bundle/web-app/README.zh.md:5`）。这是第 16 章安全考量在组合层的证据：bundle 的 patch 不只是声明行，还可以约束行为（`--help` 时两个服务都不提供，所以 `dsh --profile web --help` 根本不绑定端口，`:8-12` 注释）；
- `web-runtime`：本 bundle 的粘合插件——解析已构建的前端 dist（装配事实，非用户配置）、挂 frontend-static 回退席位、注册 web-surface 提示词段与 `DSH_WEB_URL` bash 变量、打印 URL 行（`:122-136` 注释）；
- `client-hmr`：**始终挂载**但空闲，直到开发 watcher（`pnpm run dev:web`）改写客户端 bundle；注释（`:138-141`）说明它必须独立成行而非 web-runtime 的子行——它的 Node 半是 client 侧包，host 侧 bundle 无法 import。

传输层还有一条双面行 `connection`，但它列在名录段（下段）——它同时持传输两端，名录与传输在它这里合体。

**（4）浏览器插件名录 `dsh.client`**（`packages/bundle/web-app/cordis.patch.yml:145-273`，5 条机制行 + 28 条 UI 行）：`modules`（`dsh-client-modules`——Node 半扫描声明 `dsh.client` 的包、组合出 `window.__DSH_BOOT__` 清单、serve `/plugins/<id>/client.js`；浏览器半是壳内核在 cordis 存在前就构建的模块表，`:147-152` 注释）、`connection`（`:154-163` 注释：同持传输两端——node 半把 gateway 绑到 webserver 的 `/api`，浏览器半是 fetch/SSE 客户端；`trustedHosts: !!js ctx.webRuntime.trustedHosts` 是 LAN 信任栅栏的数据源，第 16 章）、`api-remotes`、`client-runtime`、`cordis-client-runner`，随后是 28 个 `ui-*` 包（`ui-theme`、`locale`、`ui-layout`、`ui-sidebar`、`ui-settings`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugin-inventory`、`ui-conversation`、`ui-tool`、`ui-cordis`、`ui-workflow-run`、`ui-deliverables`、`ui-workspace`、`ui-input-trigger`、`ui-commands`、`ui-skill`、`ui-subagent`、`ui-jobs`、`ui-goal`、`ui-message-feedback`、`ui-model-selection`、`ui-permission`、`ui-agent-preset`、`ui-settings-plugins`、`ui-plan`、`ui-user-questions`、`ui-trajectory`）。这些行让各自包的 `dsh.client` 声明进入名录，构成浏览器侧的模块图；注释（`:45-46`）说得很直接："`dsh.client` 行是浏览器名录，modules 节点半把它扫进 `window.__DSH_BOOT__`；modules 这一行同时是 host 行。"

**（5）agent plane 移入 preset**（段首注释 `packages/bundle/web-app/cordis.patch.yml:276-285`；23 条 `disabled: true` 行 `:293-408`）——这是 web-app 最有信息量的一段。段首注释：

```text
Every row below composes what ONE agent contributes to the host registries:
its tools, its prompt sections, its delegation backends. The base keeps them
for the TUI, which is single-session and composes its agent process-wide; the
Web surface disables them here and lets each session mount a preset instead.

Disabling rather than deleting is deliberate: the base is shared, and a row
absent from a surface overlay would silently reappear the day someone reorders
the composition.
```

逐条被禁的行分别是：`tool-bash`、`tool-pwsh`、`tool-jobs`、`tool-fs`、`tool-fs-search`、`tool-str-replace-editor`、`skill-filesystem`、`tool-skill`、`tool-goal`、`plan-mode`、`compaction-basic`、`command-compact`、`tool-result-pruner`、`tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`、`tool-subagent-fork`、`workflow-worker-thread`、`tool-workflow`、`tool-ralph`、`agent-instructions`、`tool-todo`、`tool-web`——正是段首注释定义的"一个 agent 向 host 注册表贡献什么"：它的工具行、提示词段行与委托后端行。而 host 的注册表、计量与策略行（`subagent` 注册表、`token-meter`、`fs-observation-policy`、`goal` 服务与 `/goal` 命令、`commands`、skill 注册表等）不在其中、仍留在 base；standard preset 自己重挂其中多数工具行（7.4.2 走读），个别如 `tool-str-replace-editor` 则未重挂——preset 的清单就是"这个 agent 有什么"的最终决定。它们不为 Web 服务，因为 Web 是"每个会话挂一个 preset"，而 TUI 是单会话、进程级组装。

**（6）`agent-presets` 行**（`packages/bundle/web-app/cordis.patch.yml:420-424`）：`default: standard`。注释（`:410-419`）交代了两个根：`config/agent-presets/` 随部署发布、只读、条目带 `system` 信任；`$DSH_HOME/.agent-presets` 是人（或 agent）创作自己的预设的地方，"因为 preset 就是一份组合"——它持有与 shell 访问同等的信任。

## 7.4 agent preset：配置即代码的样板

### 7.4.1 概念三步讲

**① 类比**：preset 是"装配图纸模板"——文档描述"一个 agent 应有哪些工具、哪些提示词段"；roster（`dsh-agent-presets`）按图纸装配一次，多个会话（工人）通过认父加入同一份常驻装配（车间）。

**② 精确定义**：agent preset 是一个目录（id = 目录名），内含 `agent.cordis.yml`（插件行列表）与可选的 `preset.yml`（仅展示用元信息）。roster 在整个进程内把每个 preset **只挂载一次**（常驻 scope，见下文），命名它的每个会话通过把自己 agent 的 scope key 认父到该挂载来加入；挂载的工具、提示词段落与投影单元只存在一份，插件各自按 Session/Agent 分键存状态，因此会话间互不串扰（`packages/preset/agent-presets/README.zh.md:1-5`）。

**③ 最小示例**——standard preset 的两个文件（`apps/cli/config/agent-presets/standard/`）：

```yaml
# preset.yml —— 只承载展示文本；id 是目录名、trust 来自所在根目录，都不可写在这里
name: 标准模式
description: 功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。
order: 1
```

（`apps/cli/config/agent-presets/standard/preset.yml:1-3`；"只承载展示文本"的理由见 `packages/preset/agent-presets/README.zh.md`——这是 YAML 无法在插件行列表旁携带同级键的直接后果。）

### 7.4.2 走读 `apps/cli/config/agent-presets/standard/agent.cordis.yml`：group + isolate + 嵌套 config

文件头注释（`apps/cli/config/agent-presets/standard/agent.cordis.yml:1-18`）是权威设计说明：

- 这是 **agent 平面**组合：roster 只挂载一次到常驻 scope；每个会话经 scope 父链加入（`apps/cli/config/agent-presets/standard/agent.cordis.yml:3-6`）；
- host 组合（base + web）保留 preset **不该拥有**的一切——注册表本身、沙箱与审批栈、持久化、模型路由（`:6-9`）；
- **服务行必须位于携带 `isolate` realm 的 group 内**：没有 realm 就发布进根 realm——进程全局；另一个 preset 发布同名服务直接冲突，host 读取方会为每个会话解析到同一实例；`dsh-agent-presets` 在挂载时拒绝这类行（`:11-18`）。

现在走读 planning 组（`apps/cli/config/agent-presets/standard/agent.cordis.yml:104-124`）：

```yaml
- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
      config:
        section: |
          You are in plan mode. Stay in plan mode until exit_plan_mode succeeds ...
```

三层结构逐层拆：

1. **外层 `planning` 行**：`name: cordis:group` 是第 5 章讲过的内置组插件；`group: true` 告诉 loader 该行的 `config` 是**子行列表**而非插件配置；
2. **`isolate: { planMode: true }`**：给本组一个 **entry-local realm**——组内所有行提供的服务（这里是 `planMode`）都锁在私有作用域里，对兄弟 preset、对 host 都不可见。isolate 的机制第 2 章讲过（同名服务按 isolate 符号分 store）；此处故意用 `true` 而非字符串 label，注释（`apps/cli/config/agent-presets/standard/agent.cordis.yml:15-18`）说得明白："共享 label **不汇集实例**——`provide()` 在同一个 realm 符号下第二次注册会抛错；label 联合的是 realm，本文件不需要"；
3. **嵌套的子行 `plan-mode`**：config 是一整段计划模式提示词（与 base 中 `plan-mode` 行的 section 内容相同——base :267-279 与 preset :113-124 是同一段文本的两份副本，值随模式而异的行确实没有住在共享层）。

为什么 planning 必须私有？组前注释（`apps/cli/config/agent-presets/standard/agent.cordis.yml:100-103`）直接回答："Plan state is per-agent by nature, so an entry-local realm is not a workaround here — it is the correct lifetime." 计划状态天然归属某个 agent；若 `planMode` 服务是进程全局，A 会话进入计划模式，B 会话也会看到。

preset 里还有两个 group，快读要点：

- **compaction 组**（`apps/cli/config/agent-presets/standard/agent.cordis.yml:137-155`）：isolate 两个键（`compaction` + `toolResultPruner`）——因为 `compaction-basic` 通过 `ctx.get` 读 `toolResultPruner`，二者必须共享同一 realm（`:128-129`）；`tokenMeter` 则**刻意留在 host**（`:130-136`：meter 按 Session 分键、拥有浏览器要读的 context-meter 投影单元，放进 realm 会随挂载的 preset 而来去）；
- **delegation 组**（`:174-233`）：isolate `workflowEngine`。这里挂 `tool-subagent-control` / `tool-subagent`（spawn/continuable）/ `tool-subagent-fork`——注意与 base 的差异：**preset 里 fork 是 continuable**（`:193-198`），base 里是 one-shot（base `:324-329`），因为 Web 的 preset 组合不需要 fork 的 one-shot 约束；还有两个默认 disabled 的外部产品提供方行（`tool-subagent-codex` / `tool-subagent-claude-code`，`:203-219`）——复制本 preset、去掉 `disabled`，该产品就只暴露给由该副本组装的 agent，这是"配置即代码"的直接体现；以及 `tool-workflow` / `tool-ralph`。

不在 group 里的行（`tool-bash`、`tool-fs`、`tool-todo` 等工具行）没有 isolate——因为"两者都注册进 host `tools` 注册表且不提供任何服务，所以不需要 realm"（`apps/cli/config/agent-presets/standard/agent.cordis.yml:52-55` 注释）。平台门控在 preset 里重现（`tool-bash:46`、`tool-pwsh:50`，与 base 的表达式一模一样）。

### 7.4.3 host plane 与 agent plane 的划分标准

web-app 的禁用注释与 preset 的头部注释互为镜像，可以提炼出三条可复述的判定标准（全部出自源码注释）：

1. **注入标准**（web-app `packages/bundle/web-app/cordis.patch.yml:287-291`）：某行注入的服务必须在任何会话存在之前解析——它属于 host。例子是 `shell-env`：它发布 `DSH_WEB_URL`/`DSH_WEB_MODE` 给"模型的 shell"；放进 preset realm，"这些变量永远到不了模型的 shell"。
2. **注册表/单例标准**（web-app `:299-307`、`:367-372`）：进程级单例（任务注册表、子代理注册表）必须留 host。子代理注册表有跨会话查询面（`listChildren`、`followup`）且 provider 名全局唯一——每会话一份会饿死 host 行、第二个会话直接冲突；而任务注册表按 owning agent 分键，一个 host 实例服务所有会话。
3. **读取方标准**（反方向，web-app `:336-343`、`:351-356`）：被组外行 `ctx.get` 读取的服务（goal 服务被 Gateway 的 Remote 描述符解析、token-meter 的投影单元被浏览器读取）必须留 host——放进 entry-local realm 会让远程调用得 `service-unavailable`，或让计量单位随预设挂载而来去。

结论一句话：**注册表与服务留在 host，模型可见的工具与提示词段由 preset 选择**。

## 7.5 手写组合的例子：examples 对照

examples 目录是"单文件组合"的教材样本：所有行手写在一份 `cordis.yml` 里，看得到全貌——与 bundle 组合互为对照。

`examples/headless-agent/cordis.yml`（165 行）是一次性编码 agent：`settings` / `credentials`（`:9-16`，key 不内联）、`llm-deepseek`（**自带完整 config**：`thinking: enabled`、`reasoningEffort: max`、两个模型各 `contextWindow: 128000`，`:23-32`——base 中同一行不带 config，这里是示例自述全部值）、`subprocess` + `bash`（**`dsh-bash-local`**：本地执行器，非沙箱壳，`:35-41`）、`agent-spine`（`dsh-agent-spine-demo`：预创建 `main` agent + persona + `workspaceContext`，`:44-61`）、持久化（`'./.sessions'`，压缩按 `DSH_SNAPSHOT` 切换，`:63-67`）、compaction（`thresholdRatio: 0.8 / retainRatio: 0.16`，`:76-82`）、子代理家族、**`fs-local`**（`cwd: !!js process.cwd()`）+ `fs-observation-policy` + `tool-fs`（`:156-165`）。

`examples/acp-agent/cordis.yml`（192 行）是 ACP 自动化服务。两者共享同一批基础插件行，差异集中在三处：

| 行 | headless-agent | acp-agent | 说明 |
|---|---|---|---|
| app 行 | `agent-spine`（`dsh-agent-spine-demo`，预创建 main agent） | `acp-agent`（`dsh-acp-demo`：agent spine + 持久化 + ACP 桥，`examples/acp-agent/cordis.yml:51-65`） | 一个是一次性 CLI 驱动、一个是协议服务器 |
| 执行器 | `bash` = `dsh-bash-local`（`examples/headless-agent/cordis.yml:38-41`） | `bash` = `dsh-bash-sandbox`（`examples/acp-agent/cordis.yml:37-40`） | acp 把 bash 也放进沙箱壳 |
| 文件系统 | `dsh-fs-local`（`examples/headless-agent/cordis.yml:156-159`） | `dsh-fs-sandbox`（`examples/acp-agent/cordis.yml:165-168`）+ `approval`（`examples/acp-agent/cordis.yml:42-45`）+ hooks（`examples/acp-agent/cordis.yml:181-192`） | acp 用 fs 沙箱替换本地 fs，并挂审批通道与 Claude Code/Codex 桥 |

关键观察：**换掉一个提供方，就把示例从"信任本地"换到"沙箱内"**——这两份例子使用完全相同语义的插件行，差异全部集中在执行链（bash/fs/sandbox/approval）与 app 行。acp 的 fs-sandbox 注释（`examples/acp-agent/cordis.yml:160-164`）点破了第 12 章 seam 思想的组合面："dsh-fs-sandbox 替换 dsh-fs-local 于 ctx.fs 之后按有效模式围栏写/编辑……fs-observation-policy 正交叠加在上。"——同一份组合里，**提供方可换、策略可叠加**。

变体例子——`examples/headless-agent/e2b.cordis.yml`（POC overlay，`:1-57`）演示"在组合之上再组合"：

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

它先 `disabled` 两个本地提供方行，再 `insert` 三个远程提供方行（`e2b` 沙箱、`subprocess-e2b`、`fs-e2b`），同时把 `sandbox-policy` 覆盖为 `danger-full-access`（远程沙箱内本地目录限制不适用）并补上 `pty`/`terminal-bash`/`tool-terminal`/`lsp` 等消费方。头注释的"**one-world invariant**"（`examples/headless-agent/e2b.cordis.yml:5-9`）值得划重点：`e2b.cwd`、`sandbox-policy.workspaceRoot`、bash 默认工作目录必须指向同一个远程目录——漏掉一行，所有工具调用都会以"远程 spawn 错误"失败。`examples/acp-agent/pty.cordis.yml`（`:1-21`）同理：一个 `include` + insert `pty`/`terminal-bash`/`tool-terminal` 三行的 opt-in 组合。

examples 与 bundle 的关系：前者是"学习版本"——全貌在一份文件里；后者是"产品版本"——共享核心抽成可安装、可复用的层。**两者的 patch 语义完全相同**（都走 `applyEntryPatches`），所以从 examples 迁到 bundle 的成本是"复制 + 分层"，而非换机制。

## 7.6 bundle 之上永远还能 patch

第 6 章已铺好补丁栈全序，这里只做复述与收束：bundles（按 `dsh.profile.bundles` 顺序）→ profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays → agent-presets 行 patch → telemetry 开关（`apps/cli/src/profile-boot.ts:121-129`、`:159-169`、`:240-245`）。bundle 层只是这条栈的最底层几块；**任何一层都可以按 id 覆盖 bundle 的行、按 id+insert 在 bundle 的组里插入行**（第 5 章：插入行立即建索引，后续 patch 可继续命中）。

最小示例——给 headless profile 写用户层（可放在 `$DSH_HOME/profiles/headless/cordis.patch.yml`）：

```yaml
# 用户层：覆盖 base 的默认模型与 todo 行为，再插入一行自己的插件
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-v4-pro

- id: tool-todo
  config:
    allowParallelInProgress: false

- insert:
    - id: my-logger
      name: '@deepseek-ai/cordis-plugin-logger-console'
```

验证方式：`dsh --profile headless --dump-config`——dump 与挂载共用**同一个** `applyEntryPatches`（`packages/boot/app-boot/src/profile.ts:405-412` 注释："the same single `applyEntryPatches` call the boot include makes, so flag derivation and config dumps see exactly what mounts"），所以配置树打印即组合事实；`--dump-default-config` 跳过用户层，可对照观察 bundle 默认值（`packages/boot/app-boot/src/profile.ts:366-368`）。（未验证：本环境未构建 dsh，`--dump-config` 未实际运行，以上按源码推演。）

把它与 7.1 的准则②连起来看：因为 patch 是整行替换，**"随模式而异的值"才必须从 base 挪到各模式 bundle**——web-app 重述 `session-query-sqlite` 两行相同键（`packages/bundle/web-app/cordis.patch.yml:30-33`）正是这条规则的直接证据；而用户永远拥有一切的最终覆盖权，这就是插件化架构的"最后一层是用户"。

至此本章的三步演进闭环：① 一份 cordis.yml 手写整棵树（examples 形态，学习友好）→ ② 组合包 + profile（可复用、可安装、可分层，产品形态）→ ③ 补丁栈上永远还能 patch（用户总有最终发言权）。

## 7.7 本章小结

1. **bundle 是发布单元**（npm 包 + `dsh.bundle.patch`），**profile 是运行入口**（`dsh.profile.bundles` 有序层列表 + 用户 `cordis.patch.yml`）；同一 manifest 可同时声明两角色。
2. **base 是 78 条的共享核心**：平台门控（bash/pwsh 互补 `!!js` 表达式）、中性默认（`tools`/`system-prompt`/`agent-loop`/`fs-sandbox`/`llm-deepseek`）、默认关闭（sqlite 检索、遥测、`skill-badge`、pi-ai 休眠）。
3. **headless 增量 6 条、web-app 增量 78 条**——web 的体量主要在传输层 + 28 个 `dsh.client` UI 行 + 把 23 条模型面向行移入 preset。
4. **agent preset 把"一个 agent 有什么"从进程级组合变成会话级组合**；服务行必须待在带 isolate realm 的组里；host plane 判定三标准：注入标准、注册表/单例标准、读取方标准。
5. **换提供方是 seam 思想（第 12 章）在组合层的体现**：examples 从 `fs-local` 换 `fs-sandbox`、从本地 bash 换 e2b 远程沙箱，都是同一批行的重组合。
6. **bundle 是补丁栈的底段**：任何一层都可覆盖 bundle 行，用户层永远最后写；`--dump-config` 与挂载共用同一拍平函数，故可验证。

## 7.8 练习

**理解**：
1. 用三句话分别定义 bundle、profile、preset，并指出三者最重要的一个区别维度（发布 / 运行 / 会话级）。
2. 为什么 base 用互补的 `!!js` 表达式做 shell 栈平台门控，而不是维护两份文件？Windows 用户想改用 bash 时，为什么必须"禁 pwsh 两行 + 启 bash 两行"成对完成？

**应用**：
3. 在 base 的 78 条中找出所有带 `disabled:` 的行，按"平台门控"与"默认关闭"两类列清单（可从 `cordis.patch.yml` 直接 grep）。
4. headless 与 web-app 都禁用了 `hmr`，但注释给出不同理由——说出两者的区别，并说明这说明了 bundle 注释的价值。

**综合**：
5. 写一个 `--patch` overlay：把 headless profile 的 `agent-default-model` 换成 pi-ai 路由，并给 `tool-web` 打开 `fetch: true`（提示：以 `packages/bundle/base/cordis.patch.yml:396-403` 注释为据说明 fetch 的 SSRF 顾虑与需要的提供方行）。能构建时用 `dsh --profile headless --patch … --dump-config` 验证；否则文本推演并标注。

**挑战**：
6. 推演：如果把 standard preset 的 `tool-subagent-control` 移进 delegation 组的 entry-local realm 会发生什么？（提示：结合 `packages/bundle/web-app/cordis.patch.yml:385-390` 注释——它注册的是子代理单例上的 continuable setup 而非本 agent 的工具；以及 `apps/cli/config/agent-presets/standard/agent.cordis.yml:11-18` 的服务行 MUST 规则。）

## 延伸阅读

- `packages/bundle/README.zh.md`（组合包总述与三者定位表）
- `packages/bundle/base/README.md`、`packages/bundle/headless/README.md`、`packages/bundle/web-app/README.zh.md`（各 bundle 的模型体验、已知限制；web-app 的 `--host 0.0.0.0` 拒绝）
- `packages/boot/app-boot/src/profile.ts`（profile 解析、模板、归一化、`composeEntries`）
- `apps/cli/src/profile-boot.ts`（补丁栈全序、预设根注入、watchUserPatches）
- `packages/preset/agent-presets/README.zh.md`（roster 常驻挂载、`mount`/`composeFrom`/`recompose`、信任级别）
- `docs/subsystems/client-modules.zh.md`（`dsh.client` 声明与 `window.__DSH_BOOT__`）
- `examples/headless-agent/{cordis.yml,e2b.cordis.yml}`、`examples/acp-agent/{cordis.yml,pty.cordis.yml}`（手写组合对照样本）
- 架构笔记（web-app `:353-356` 引用）：`.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md`
