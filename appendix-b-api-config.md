# 附录 B　API 与配置速查

> 本附录把第 1、6、7、15、16 章涉及的 `dsh` 命令行与配置事实汇集为速查表，行号对应教程写作时的仓库状态（v0.1.0-rc.5，提交 `47f943859b`）。
>
> **事实来源**：CLI 行为以仓库内行为标准 `apps/cli/reference/README.md` 为准（该文件由实现同步维护，中文版见 `apps/cli/reference/README.zh.md`），源码事实以 `apps/cli/src/` 下的实现为准；配置默认值以 `packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml` 为准。
>
> **诚实性说明**：本环境未构建 `dsh` 且无 `DEEPSEEK_API_KEY`，下列命令的**实际运行效果**均未在本机验证（凡涉及真实模型调用、构建产物或网络监听的行为，均视为（未验证））；但每条规则都有源码或仓库内文档出处，可以作为阅读上层代码的可靠索引。

## B.1　命令面：三种调用模式

`dsh` 的 argv 只在 `apps/cli/src/args.ts:112-191` 被解析一次，`apps/cli/src/bin.ts:29-53` 按解析结果动态 import 对应入口（三种模式互不载入，`bin.ts:3-6`）。

| 模式 | 触发形式 | 入口（`bin.ts`） | 作用 |
|---|---|---|---|
| profile（启动） | `dsh --profile <name> [--patch <path>]… [app 参数…]`；`dsh web` 是 `--profile web` 的别名 | `runProfile`（:30-38，实现 `profile-boot.ts`） | 组装补丁栈、挂载插件树、把剩余参数交给被启动的应用 |
| plugin（管理） | `dsh plugin --profile <name> <pnpm 动词>…` | `runPlugin`（:40-44，实现 `plugin.ts`） | 以 profile 目录为 cwd 把参数转发给 pnpm，装完再协调 `dsh.profile.bundles` |
| dump-config（检查） | `dsh --profile <name> --dump-config` ／`--dump-default-config` | `runDumpConfig`（:45-49，实现 `dump-config.ts`） | 不启动、按补丁算法打印组合树（`!!js` 不求值） |

启动器自身选项（`args.ts:130-134`）：

| 选项 | 含义 |
|---|---|
| `--profile <name>` | 要启动的档案（profile），必填；空串报错（`args.ts:143`） |
| `--patch <path>` | 追加一层补丁 overlay，**可重复**（`collect`，`args.ts:61`）；单值收集器刻意不做变长参数，否则会吞掉后面的 app 参数（`args.ts:57-60`） |
| `--dump-config` | 打印含用户层与 `--patch` 的组合树后退出 |
| `--dump-default-config` | 只打印 bundle 层后退出；与 `--dump-config` 互斥（`args.ts:89-91`），且不接受 `--patch`（`args.ts:99-101`） |
| `-V, --version` | 打印启动器版本（出现在 app 参数边界之前时；`apps/cli/reference/README.md:17`） |

`dsh -h`（无 profile 可交付）打印启动器自己的帮助（`args.ts:136-141`）；校验规则本身在 `<args.ts>:112-191`，帮助与版本在解析期内就打印退出，不会进入上面的 switch（`bin.ts:4-5`）。

## B.2　档案（profile）与补丁栈

### B.2.1　档案目录与初始化

- 档案位于 `$DSH_HOME/profiles/<name>`（`apps/cli/reference/README.md:9`；`resolveProfileDir` 见 `packages/boot/app-boot/src/profile.ts:104`）。
- `web`、`headless` 两个档案首次使用自动按内置模板初始化（`web`：base + web-app；`headless`：base + headless）；其他缺失的档案直接报错，并提示用 `dsh plugin --profile <name> add <package>`（`apps/cli/reference/README.md:13`）。
- 每次启动都会**重写**档案目录里的空根配置 `cordis.yml`（`packages/boot/app-boot` 的 Loader 需要一个真实 include 根来锚定 `baseUrl`；同时防止 Loader 的树写回把组合行固化进根文件，造成下次启动重复插入——见 `apps/cli/src/profile-boot.ts:85-103`，根文件内容 `:60-64`）。
- bundle 名先按 dsh 安装解析、再按档案目录解析：内置 bundle（`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless`）永远来自当前 dsh 安装；仓库外 bundle 来自档案的 pnpm 管理 `node_modules`（`apps/cli/reference/README.md:11`）。
- 补丁行里的裸插件名沿档案目录做 Node 父级游走解析，最终落到维护安装回退 `$DSH_HOME/profiles/node_modules`（每次启动愈合；`profile-boot.ts:99`、`apps/cli/reference/README.md:11`）。

### B.2.2　补丁栈顺序（后层胜）

一次启动的有效组合是：**空根配置 + 按序应用的补丁层**（`profile-boot.ts:121-129` 的 `allPatches`；`composeProfile` 组装 `:142-171`）：

```
1. bundle 层    —— 按档案 package.json 中 dsh.profile.bundles 的列表顺序，每个 bundle 一张补丁
2. 档案用户层   —— <profile>/cordis.patch.yml
3. 主目录用户层 —— $DSH_HOME/cordis.patch.yml（机器本地偏好，对所有档案生效，故排序高于档案层）
4. --patch 覆盖 —— 按 argv 顺序，每出现一次追加一层
5. 遥测开关层   —— DSH_TELEMETRY_DISABLED 非空且组合含遥测行时追加禁用补丁（profile-boot.ts:80-83、:168-169）
```

合并语义（`apps/cli/reference/README.md:9`）：

- **后层胜是逐行（per-row）的**：补丁替换目标行的**整个 `config` 值**，不做键级深合并；补丁还可以插入新行。
- 因此同名行的高层配置若想保留低层的某个键，必须在自己的 `config` 里完整写出——这是第 6 章"整行替换"结论的 CLI 侧印证。
- 解析、schema、解析依赖、插件启动任一失败都会报告并**非零退出**；SIGINT/SIGTERM 先 dispose 挂载根再退出（`apps/cli/reference/README.md:9`；信号处理 `profile-boot.ts:221-222`）。

### B.2.3　两个用户层的热重载

启动后若组合里没有 HMR 服务，会补挂一个 watch-only 实例（`profile-boot.ts:271-284`），然后分别监视档案层与主目录层两个 `cordis.patch.yml`（`watchUserPatches`，`:285-294`）：合法编辑会被事务式重新应用；每次重组都**重新读取**两份用户文件并用 `structuredClone` 克隆补丁对象——include 插件按引用把 `insert` 行塞进挂载树，后续 id 定向补丁会原地修改这些对象，复用解析对象会把用户覆盖层烤进 bundle 的 insert 行（`profile-boot.ts:227-245`）。一次性任务（headless）走有限关闭退出，监视器随树一起释放。

### B.2.4　组合树检查（dump-config）

```sh
dsh --profile web --dump-default-config   # 只打印 bundle 层
dsh --profile web --patch ./extra.yml --dump-config   # bundle 层 + 档案层 + 主目录层 + --patch
```

输出带注释，逐行标明来源文件与每次改写的覆盖层；`!!js` 表达式**保持未求值**；无法匹配的补丁目标在 stderr 报告（`apps/cli/reference/README.md:39`）。dump 是免启动的：它不运行任何应用命令行提供方，因此**不接受 app 参数**（带了就报错，`args.ts:92-97`；实现 `dump-config.ts:31-51`），打印的树也不会反映 app 参数解析出的值——这与"参数优先于写死值"的启动语义是两回事（见 B.3）。

## B.3　应用参数边界与"参数优先"机制

**边界规则**：启动器的旗标必须在前，解析器遇到**第一个不认识的 token** 即认为 app 参数开始，此后全部原样交给被启动的应用（`args.ts:8-11`、`:123-129`）。举例（`args.ts:64-72` 帮助文本）：

```sh
dsh --profile tui --resume abc        # tui 应用收到 --resume abc
dsh --profile web -h                  # 打印 web 应用的帮助，而非启动器的
dsh --profile headless "run the tests" # 任务文本作为位置参数
```

- `dsh --help`（没有 profile 可交付）打印启动器自己的帮助；`-V/--version` 在边界前属于启动器（`apps/cli/reference/README.md:17`）。
- 启动器的解析器会**消费一个 `--`**：app 参数若必须以字面 `--` 形式到达，需要写 `-- --`（`apps/cli/reference/README.md:21`）。
- 第一个 app 参数如果是 `web` 或 `plugin`，会先选中相应子命令——即它们保留为启动器词汇（`apps/cli/reference/README.md:21`）。

**交接机制**：启动前 `provideCmdline` 把不可变的参数快照放进 `ctx.cmdlineArgs`，并附带 `ctx.appExit`（`profile-boot.ts:255-258`）；任何普通应用插件都可以注入该快照并自行解析，再把结果作为应用自有服务提供（`@deepseek-ai/dsh-cmdline`）。由旗标赋值的行会在配置里写惰性表达式，例如（`apps/cli/reference/README.md:19`）：

```yaml
port: !!js ctx.webStartup.port ?? 3080
```

Loader 等到该服务激活后才对行值求值，所以**旗标优先于写在旁边的字面值**；但如果某层补丁把整个 `config` 换成字面量，这个运行时读取就消失了。帮助与被拒绝的参数会请求退出（帮助 0、拒绝非 0），且不会激活依赖该服务的行。在线编辑 `cordis.patch.yml` 时表达式会针对仍在运行的服务重新求值，因此**不会重置正在服务的端口**（`apps/cli/reference/README.md:19`）。

各内置应用的命令行（`apps/cli/reference/README.md:23-28`）：

| 档案 | 参数 |
|---|---|
| `web` | `--host`、`--port`、可重复 `--trusted-host` |
| `headless` | 任务文本（位置参数） |

## B.4　web 别名与网络面

- `dsh web` 是写死的 `--profile web` 别名（`args.ts:156-169`）；别名后的旗标属于 web 应用（`apps/cli/reference/README.md:55`）。别名同样接受 `--patch`、`--dump-config`、`--dump-default-config`，且拒绝父级选项（`args.ts:167`）。
- 生产 Web 运行器需要已构建的包与前端产物（`pnpm run build`）；默认服务地址 `http://127.0.0.1:3080`（`apps/cli/reference/README.md:64`）。
- CLI **有意暂不支持 `--host 0.0.0.0`**，会以用法错误退出；可重复的 `--trusted-host` 把具名 authority 加入 `/api` 浏览器信任围栏的接受名单（`apps/cli/reference/README.md:64`；`--trusted-host` 经 `ctx.webRuntime.trustedHosts` 汇集，`:55`）。
- 客户端插件 HMR 接收端总是挂载，但保持空闲，直到单独的 `pnpm run dev:web` 监视器重建客户端包（`apps/cli/reference/README.md:55`）。

## B.5　headless：一次性任务

`dsh --profile headless "run the tests"` 的完整行为（`apps/cli/reference/README.md:30`）：

1. 通过核心注册表创建一个新的持久化 Agent，提交任务，等待静默（quiescence）；
2. flush 会话后，从持久化区间派生**最后一段非空 assistant 文本**与最终 `turn/end` 原因；
3. 文本打到 stdout；`completed` 退出码 0，否则 1；
4. 不挂 ApiProxy、Host、HTTP 服务器、Web 运行时或浏览器客户端；成功运行 stderr 无输出、不监听任何端口；
5. 不带任务调用是按该应用的用法错误。

（以上为行为标准所载；本环境未构建、未实际运行——（未验证）。）

## B.6　plugin：档案插件管理

`dsh plugin --profile <name> <args...>`（`apps/cli/reference/README.md:41-51`；实现 `apps/cli/src/plugin.ts:120-158`）：

1. **首次使用初始化**：档案缺 `package.json` 时按模板（内置档案）或仅 `@deepseek-ai/dsh-base`（其他名字）初始化，并提示（`plugin.ts:122-125`）；
2. **转发 pnpm**：以档案目录为 cwd 运行 `pnpm <args...>`，`add`/`remove`/`why`/`update` 等动词原样可用，pnpm 必须在 PATH 上（`plugin.ts:129-133`；找不到返回 127 并给出提示 `:136-139`）；
3. **相对路径锚定**：`.`、`../plugin` 及 `file:`/`link:` 形态先按**调用者目录**解析（`plugin.ts:104-112`），避免 `add .` 把档案自身自链接；
4. **成功后协调层列表**（`plugin.ts:59-91`）：解析为声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的依赖加入 `dsh.profile.bundles`（按依赖序追加）；无 bundle 声明的新依赖保持普通依赖并警告一次；被移除或失去声明的依赖离开层栈。按**已安装状态**而非依赖 diff 协调，所以 `update` 拿到新增声明的包也会自动激活；模板自带 bundle 不是依赖、永不动它。
5. git 托管的插件在安装时经 `prepare` 脚本构建，pnpm ≥10 默认阻止，首次 `add` 会失败并给出 `allowBuilds` 提示；把打印的键复制进档案的 `pnpm-workspace.yaml` 后可重跑（`apps/cli/reference/README.md:51`；`plugin.ts:149-155`）。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

## B.7　环境变量速查

| 变量 | 效果 | 出处 |
|---|---|---|
| `DSH_HOME` | 覆盖默认主目录（默认 `~/.dsh`）；空串/纯空白视为未设置；显式配置路径 > `$DSH_HOME` > `~/.dsh` | `packages/util/home-paths/src/index.ts:18`、`:87-91`（默认 `:61-63`；`dshHomePath` 拼接 `:98-100`） |
| `DEEPSEEK_API_KEY` | 原生 DeepSeek 适配器进行搜索（`web_search`）用的密钥；`web_fetch` 默认禁用，除非补丁层插入提供方并启用 | `apps/cli/reference/README.md:76` |
| 凭证四层解析 | ① 继承的进程环境（只读、**胜出**）→ ② `$DSH_HOME/.credentials.yaml`（托管可写）→ ③ 调用目录 `.env`（只读回退）→ ④ `$DSH_HOME/.env`（只读回退） | `packages/credentials/credentials-local/src/index.ts:5-17`；`resolve` 实现 `:309-317` |
| `DSH_PERMISSION_MODE` | 沙箱/审批模式回退：`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`；`danger-full-access` 时审批策略为 `never`，否则 `ask` | `packages/bundle/base/cordis.patch.yml:172-176`、`:188-192`（预设表 `:196-207`） |
| `DSH_TELEMETRY_MODE` | `FULL` 把所有投影会话事件以 OTLP/HTTP 日志流出；`FEEDBACK_ONLY` 仅在记录反馈时上传会话日志后缀；默认 `DISABLED` | `apps/cli/reference/README.md:78`；默认表达式 `packages/bundle/base/cordis.patch.yml:151` |
| `DSH_TELEMETRY_OTLP_URL` | 选择其他收集器（默认 `https://harness-telemetry.deepseeksvc.com/v1/logs`） | `packages/bundle/base/cordis.patch.yml:154` |
| `DSH_TELEMETRY_DISABLED` | **任意非空值**（含 `'0'`/`'false'`）为权威硬关闭；组合无遥测行时不生成补丁 | `apps/cli/src/profile-boot.ts:80-83` |
| `DSH_TOOLS_MODE` | 选择 `native`、`code` 或 `both`；其他值启动即失败 | `apps/cli/reference/README.md:72` |
| `NODE_USE_ENV_PROXY=1` | 支持的 Node 版本需要时，使 `HTTP_PROXY`/`HTTPS_PROXY` 生效 | `apps/cli/reference/README.md:84` |

**凭证层的三条推论**（均可由源码直接读出）：

1. 进程环境层**只读且胜出**：它"不可从内部编辑，所以必须可见地只读，而不是静默遮蔽写入"（`credentials-local/src/index.ts:12-17`）；对已被进程环境供应的引用执行 `set`/`unset` 会直接抛错（`assertUnshadowed`，`:410-417`）。`DEEPSEEK_API_KEY=… dsh`、CI 密钥、容器 `-e` 都属于这一层。
2. 调用目录 `.env` 排在托管文件之下：Models 页写入的密钥立即生效，即使旧密钥还躺在 checkout 的 `.env` 里（`:15-21`）。项目层级高于用户主目录的 `.env`，与环境分层"越具体越优先"一致（`:255-263`）。
3. 托管文档是**严格**的 `CredentialRef → 非空字符串` 映射，不是 dotenv：键必须符合 POSIX 标识符，非映射根/非字符串值/空串都拒绝而非跳过（`parseCredentialsDocument`，`:142-186`）；文件以 `0600` 创建，POSIX 上启动前检查任何组/其他位并提示 `chmod 600`（`:87-122`），且**从不物化进 `process.env`**——一个 dsh 拥有的、只放凭据的存储不能兼作环境层（`:29-34`、`apps/cli/reference/README.md:76`）。

## B.8　运行行为速查

| 行为 | 事实 | 出处 |
|---|---|---|
| 新会话权限预设 | 默认 `workspace-write`（沙箱限定工作区、审批 `ask`）；bash 与文件系统变更限制在会话工作区与平台临时根；读取、网络访问、进程可见性不受限 | `apps/cli/reference/README.md:70`；预设定义 `packages/bundle/base/cordis.patch.yml:196-207` |
| 权限作用的窗口 | 已存储的 General 设置权限影响**后续** Web 会话，不改变已打开的会话 | `apps/cli/reference/README.md:70` |
| 指令文件渲染预算 | 所有模式把调用目录当默认工作区根，加载适用的 `AGENTS.md`/`CLAUDE.md`，**渲染预算 65,536 字节**；单一文件读取上限默认 1 MiB（`maxSourceBytes`） | `apps/cli/reference/README.md:68`；`packages/bundle/base/cordis.patch.yml:232-235`；`packages/context/agent-instructions/src/config.ts:14`、`:42-43` |
| 会话内容索引 | 使用**内存 SQLite** 会话内容索引（`node:sqlite`），web 组合里 `session-query-sqlite` 行被补丁延后导入 | `apps/cli/reference/README.md:68`；`packages/bundle/web-app/cordis.patch.yml:28-30` |
| 信号退出码 | 优雅关闭最多给插件树 5 秒；首个 `SIGTERM`（监管者的普通停止请求）在所有面都退出 0、`SIGINT` 报 130；第二次信号立即强制退出 | `apps/cli/reference/README.md:66`；`profile-boot.ts:216-222` |
| 会话日志位置 | 会话追加日志默认在 `$DSH_HOME/sessions`（`root: !!js dshHomePath('sessions')`） | `packages/bundle/base/cordis.patch.yml:98-101` |
| 构建要求 | 源树运行需 `pnpm run build` 生产宿主产物（Typert 等）；缺失前端/客户端插件 bundle 在启动时报错并提示构建；启动器不检查陈旧性 | `apps/cli/reference/README.md:82-84` |
| 源树直跑 | 仓库根 `pnpm dsh <args...>`：`package.json` 脚本以 `node --import tsx/esm` 直跑 `apps/cli/src/bin.ts` 并转发全部参数，无需构建 | `apps/cli/reference/README.md:83-84` |

## B.9　补丁文件里可用的表达式

补丁与配置行支持 `!!js` 惰性表达式（第 5、6 章有完整讲解）。本附录列出 CLI 侧常见写法：

```yaml
mode:        !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
workspaceRoot: !!js process.cwd()
port:        !!js ctx.webStartup.port ?? 3080
root:        !!js dshHomePath('sessions')
```

注意三点：`??` 只对 `null`/`undefined` 回退（环境变量传了空串不会回退）；`process.cwd()` 的默认工作区根在**启动进程的调用目录**；表达式在每次（重）组合时对**当时仍在运行的服务**求值，所以热重载不会重置已服务的端口（`apps/cli/reference/README.md:19`）。

## B.10　延伸阅读

- **行为标准**：`apps/cli/reference/README.md`（英文）/ `README.zh.md`（中文）——本文档即 CLI 契约，本章各节均与其对齐。
- **插件配置目录**：`docs/config-catalog.zh.md`——按包名列出所有内置插件的配置 schema（`agent-instructions` 在 `:109`、`credentials-local` 在 `:554`、`session-persistence-jsonl` 在 `:1551` 等）。
- **子系统文档**：`docs/subsystems/credentials.zh.md`（凭据标识/解析/描述）、`docs/subsystems/settings.zh.md`（用户设置）、`docs/subsystems/session.zh.md`（会话事件词表与会话 API）。
- **正文章节**：第 6 章（补丁栈与组合语义）、第 15 章（持久化与设置、凭证）、第 16 章（Web 面与 `--trusted-host` 信任围栏）。
