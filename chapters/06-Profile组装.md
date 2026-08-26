# 第 6 章　Profile 组装：从 `dsh` 命令到插件树

> **本章讲法**：流程/算法型——一次启动跟到底。输入是命令行与 `$DSH_HOME` 目录，输出是**一棵已挂载的根 Context**；每个关键函数给出签名、行为与行号，把第 5 章的 patch 语义与第 3 章的 fiber 机制串成一条可复述的主线。
>
> **学习目标**（可测）：
> 1. 画出补丁栈：空根 → bundle 层（按序）→ profile.patches → homePatches → `--patch` → agent-presets → telemetry，并说出每一层在你机器上的真实文件路径；
> 2. 解释 `composeEntries` 为什么复用 `applyEntryPatches`——"单次拍平"如何保证 dump 与挂载不漂移；
> 3. 说清 404 fallback（profile 不存在时的模板初始化）与 healed 模块（`$DSH_HOME/profiles/node_modules` 自愈目录）的语义；
> 4. 能解释 HMR（`watchUserPatches`）与 SIGTERM/SIGINT 的收尾行为。

## 6.1 一次启动跟到底：输入、输出与路线图

第 5 章回答了"一份 cordis.yml 如何变成插件实例"。这一章把镜头拉远：**你敲下 `dsh --profile headless "run the tests"`，到根 Context 挂载完成，中间发生了什么**。

输入：命令行参数（argv）、当前工作目录、`$DSH_HOME`。`resolveDshHome`（`packages/util/home-paths/src/index.ts:87-91`）按三级优先级解析：**显式配置路径 > 环境变量 `DSH_HOME` > 默认 `~/.dsh`**；其中空或全空白的 `DSH_HOME` 视为"未设置"，避免一个空覆盖把 home 解析到当前工作目录（注释 `:79-82`）。
输出：一个挂载完成的根 `Context`——`ctx.loader` 可用、每个启用的 Entry 都有 ACTIVE 的 fiber（`assertEntriesActivated` 或抛错，`packages/boot/app-boot/src/index.ts:692-725`）。

函数路线图（本章按此顺序逐一走读，行号均为本次源码复核所得）：

```
parseDshArgs(过程.argv[2:])            apps/cli/src/args.ts:112-145
  └─ runProfile(...)                  apps/cli/src/profile-boot.ts:207-300
       ├─ composeProfile(name, patches)  profile-boot.ts:142-171   ← 组装补丁栈
       │    ├─ prepareProfile(name)      profile-boot.ts:98-103    ← 重写空根 cordis.yml
       │    │    └─ loadProfile(...)     packages/boot/app-boot/src/profile.ts:371-403
       │    └─ composeEntries(layers)    profile.ts:413-420        ← 单次拍平（rows 索引）
       ├─ boot(name, rootConfig, patches, prepare)  app-boot/src/index.ts:757-802
       │    ├─ mountRootInclude(ctx, ...) index.ts:486-529
       │    ├─ loader.await()             vendor/loader/src/config/tree.ts:46-64
       │    └─ assertEntriesActivated     index.ts:692-725
       └─ watchUserPatches(...)         index.ts:232-265           ← HMR（长生命周期 surface）
```

## 6.2 起点：`apps/cli/src/bin.ts` 三模式与 `apps/cli/src/args.ts` 的拉线

`apps/cli/src/bin.ts:27-52` 只有一段 `switch (invocation.mode)`，三个模式：

- **profile**：真正的启动。动态导入 `profile-boot.ts` 执行 `runProfile`，把环境快照、profile 名、`--patch` 文件列表、剩余参数全部交给它（`apps/cli/src/bin.ts:30-39`）；
- **plugin**：把参数**原样转发给 pnpm**，在 profile 目录里装/卸插件（`apps/cli/src/bin.ts:40-44` → `plugin.ts`）；
- **dump-config**：不启动、只打印组合树（`apps/cli/src/bin.ts:45-49` → `dump-config.ts`）。

这个"三模式"划分是刻意的：启动与诊断（dump）分离、依赖管理（plugin）与运行分离，三者共享同一个 profile 解析底座。版本号也来自同一份清单：`readVersion`（`apps/cli/src/bin.ts:20-25`）读 **checked-in 的 `apps/cli/package.json`**（源码树与打包后的 `lib/` 都相对它一跳，注释 `:16-18`），字段非字符串时回退 `'0.0.0'`——`--version` 打印的就是它（`apps/cli/src/args.ts:119`）。

参数解析在 `apps/cli/src/args.ts` 的 `parseDshArgs`（`:112-145`），用 Commander 适配。四个对本章至关重要的设计：

1. **`--patch` 是"单值可重复"收集器**（`apps/cli/src/args.ts:61`）：

```ts
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]
```

注释（`apps/cli/src/args.ts:58-60`）点明：**绝不使用 variadic**（变长参数），否则 `--patch a.yml --patch b.yml` 会把后面的内层参数一并吞掉。收集顺序 = argv 顺序（`[...previous, value]`），这就是补丁栈里 `--patch` 层的顺序来源。收完之后 `resolveBoot` 立刻做一次卫生检查：**空字符串路径（`--patch ''`）直接报错** `error: --patch needs a path`（`:84-85`）——一个空路径会在 `resolve()` 后变成当前目录/根目录这类荒谬目标，与其在文件加载时才炸出难以定位的错误，不如在解析层就拒绝。

2. **启动器只解析自己的旗标，其余参数直通**：`allowUnknownOption() + passThroughOptions() + enablePositionalOptions()` 的组合（`apps/cli/src/args.ts:126-129`），第一个不被认识的 token 开始就是"内层参数"。于是 `dsh --profile tui --resume abc` 里 `--resume abc` 原样进入 `invocation.args`，由被挂载的 app 插件（`@deepseek-ai/dsh-cmdline`，见 `apps/cli/src/profile-boot.ts:255-258` 的 `provideCmdline`）解析；`dsh --profile web -h` 打印的是 **web app 自己的帮助**（`apps/cli/src/args.ts:9-11` 注释）。反过来，**裸 `dsh -h`（没有 `--profile` 可交给谁）打印的是启动器自己的帮助**：`.action` 入口里先查 `profile === undefined` 且参数含 `-h/--help`，就调 `program.help()`（`:135-141`）——"帮助归谁"由"app 存不存在"决定。`web` 是 `--profile web` 的硬编码别名（`apps/cli/src/args.ts:156-169`），它作为子命令有自己的 `.action`，其父选项同样被 `rejectParentOptions`（`:148-154`）盯住：在 `dsh web` 前面出现 `--profile`/`--patch`/`--dump-config` 等**父级旗标**（如 `dsh --patch x.yml web`）会直接报错——子命令与父旗标混用是配置错误，不是"帮你转发"。

3. **dump 校验**：`--dump-config` 与 `--dump-default-config` 互斥、dump 不接受任何 app 参数（`apps/cli/src/args.ts:89-97`），因为 dump 不启动树，打印结果必须与该调用的 boot 所见一致，否则误导用户（`apps/cli/src/args.ts:92-94`）。

`runProfile` 收到的东西（`apps/cli/src/profile-boot.ts:174-183`）：环境快照（`loadLayeredEnv` 结果）、profile 名、`patchFiles`（`--patch` 路径数组）、`args`（直通参数）。

## 6.3 组装补丁栈：composeProfile

`composeProfile(name, patchFiles)`（`apps/cli/src/profile-boot.ts:142-171`）是本章的心脏，签名与行为：

```ts
function composeProfile(name: string, patchFiles: readonly string[]): ComposedProfile
```

按源码顺序逐步展开（每一步都给出行为与行号）：

1. **`prepareProfile(name)`**（`apps/cli/src/profile-boot.ts:146`，函数 `:98-103`）：先 `healProfilesModuleFallback(INSTALL_ANCHOR)`（自愈回退目录，6.8 详述），再 `loadProfile(...)`，最后**把 `<profile>/cordis.yml` 重写为一个空列表**：

```ts
writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
```

`PROFILE_ROOT_CONFIG` 的内容（`apps/cli/src/profile-boot.ts:60-64`）就是注解 + `[]`。为什么要"重写空根"？注释（`:88-93`）说得很清楚：**整棵组合都是 patch 层**——vendored Loader 的树写回（某插件自卸载会把当前树持久化回 include 文件，见 `vendor/loader/src/index.ts:103-109` 的 `internal/update` 写回钩子：`next()` 之后把 `this.entry.options.config` 经 `Config.simplify` 写回 `tree.write()`，第 5 章 5.2.2 已提到）可能把"组合好的行"烤进这个文件，下一次启动就会把每个 bundle 的 insert 再插一遍（重复覆盖）。所以每次启动都把它重置为 `[]`。这个文件存在的唯一理由是：Loader 需要一个**真实存在的 include 根**来锚定 `baseUrl`（profile 目录），dump 也锚定同一文件（`apps/cli/src/profile-boot.ts:92-93` 注释 "both compose over the identical base"）。

2. **`homePatches`**：`loadOptionalPatches(NAME, homePatchPath()) ?? []`（`apps/cli/src/profile-boot.ts:147`）。`homePatchPath()` = `join(resolveDshHome(), 'cordis.patch.yml')`（`apps/cli/src/profile-boot.ts:49-51`）。**机器级用户层**：位于 `$DSH_HOME` 根下，对所有 profile 生效，故其优先级高于某个 profile 自己的层（`apps/cli/src/profile-boot.ts:134-137` 注释）。`loadOptionalPatches` 语义：**文件缺失 = "没有这一层"**（返回 undefined），存在但读/解析失败 = 抛错（`packages/boot/app-boot/src/index.ts:278-287`）。

3. **`overlays`**：`patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))`（`apps/cli/src/profile-boot.ts:148`）。`loadOverlayPatches` 与上面的区别：**缺失即抛错**（`vendor/include/src/index.ts:298-306`）——因为调用者指名道姓给了这个文件（`--patch ./x.yml`），它不在就是配置错误。这一对函数分别对应"可选层"与"必选层"，是 dsh 一致的错误哲学：**"缺席"与"坏了"是两种病**。

4. **`bundlePatches`**：`profile.layers.flatMap(layer => layer.patches)`（`apps/cli/src/profile-boot.ts:149`）。各 bundle 层的补丁按 `dsh.profile.bundles` 的数组顺序连接（顺序在 6.4 的 `loadProfile` 里确定）。

5. **`rows` 索引**：`composeEntries([bundlePatches, profile.patches, homePatches, overlays])` 建 `id → row` 映射（`apps/cli/src/profile-boot.ts:151-153`）。这就是 6.4 要讲的"单次拍平"——**现在只是预组合**，用于后面两个决定：agent-presets 行是否存在、telemetry 行是否存在。

6. **agent-presets 覆盖**（`apps/cli/src/profile-boot.ts:159-167`）：如果组合里有 `id: agent-presets` 的行，就追加一条覆盖它的 patch，把 `roots` 换成"发货自带的 preset 根 + 原配置里的其他键"：

```ts
composedOverlays.push({
  id: 'agent-presets',
  config: {
    ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
    roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
  },
})
```

`SHIPPED_PRESET_ROOT` 指向 CLI 自带配置目录 `apps/cli/config/agent-presets/`（`apps/cli/src/profile-boot.ts:35`，源码布局与打包布局各一跳，注释 :155-158 说明"只有本 app 能解析它"，且清单追加的可写根指向 `dsh-agent-presets` 自己，别的启动器即使没走到这条 patch 也找得到用户的 presets）。**注意这是"追加到 overlays 的一组新 patch"，不是文件**——第 7 章讲 agent preset 时再展开。

7. **telemetry 开关**（`apps/cli/src/profile-boot.ts:168-169`）：`resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has('session-telemetry-otel'))`（`:80-83`）：

```ts
if ((disabledEnv ?? '') === '' || !hasRow) return undefined
return { id: 'session-telemetry-otel', disabled: true }
```

要点：**任何非空值（包括 `'0'`、`'false'`）都视为禁用**——隐私开关宁错勿漏（`apps/cli/src/profile-boot.ts:70-75` 注释写明"a privacy switch prefers off-by-mistake over on-by-mistake"）；组合里没有 telemetry 行时，"开关"自然满足，不生成 patch（自定义 profile 不必装遥测）；目标行 id `session-telemetry-otel` 来自 base bundle（`packages/bundle/base/cordis.patch.yml:148-149`）。

最终补丁栈 = `allPatches(composed)`（`apps/cli/src/profile-boot.ts:122-129`）：

```ts
return [
  ...composed.bundlePatches,     // 1. bundle 层（按 bundles 顺序）
  ...composed.profile.patches,   // 2. profile 用户层
  ...composed.homePatches,       // 3. 机器级 home 层
  ...composed.overlays,          // 4. --patch + agent-presets + telemetry
]
```

### 6.3.1 composeEntries：单次拍平为什么"不漂移"

`composeEntries`（`packages/boot/app-boot/src/profile.ts:413-420`）全文只有 8 行：

```ts
export function composeEntries(
  layers: readonly PatchOptions[][], warn: (message: string) => void = () => {},
): EntryOptions[] {
  return applyEntryPatches([], structuredClone(layers.flat()), (message: string, ...args: unknown[]) => {
    let index = 0
    warn(message.replace(/%C/g, () => JSON.stringify(args[index++])))
  })
}
```

三个要点：

- **`layers.flat()`**：不分层、一次性全部拍平为一个大列表，然后**一次** `applyEntryPatches([], …)` 调用——空根、单项调用。这正是第 5 章那个纯函数；`[]` 就是"空根"，与 `boot` 挂载时 Include 读到的空 `cordis.yml` 一致。
- **为什么"单次"重要**：`applyEntryPatches` 内部只建**一个** id 索引，且插入行即时进索引（第 5 章 5.4.2 的 ★）。如果把多层两遍应用（先 bundle 后用户层），第二遍应用时"第一遍插入的行"是否可见、边界语义就取决于实现细节；更糟的是 dump 与挂载若用不同实现，看到的树会漂移。**所有使用方（`rows` 预组合、`--dump-config`、boot 挂载）都调用同一个函数**，因此"打印什么、就挂载什么"（`packages/boot/app-boot/src/profile.ts:406-408` 注释点明"the same single `applyEntryPatches` call the boot include makes"）。第 5 章 5.6 实验的"插入行立即建索引"在此升级为**跨层可见**：bundle 插入的行，用户层可以按 id 覆盖/禁用——这正是 dsh 修改上游行为（本地修改第 11 条）的动机（`vendor/include/src/index.ts:96-101` 注释）。
- **`warn` 适配**：`applyEntryPatches` 的告警是 printf 风格（`%C` = 代码占位符），dsh 侧把它换成内联函数展开成普通字符串（`:416-419`），boot 时会重复这些告警（`packages/boot/app-boot/src/profile.ts:411` "boot repeats them"）。

> 注（**未验证**）：`--dump-config` 的实际输出（`renderConfigDump` 的分段注释与 `!!js` 原样打印）本机未构建 dsh，无法实测；正文以源码 `packages/boot/app-boot/src/index.ts:379-473` 为准。

## 6.4 逐层走到文件：loadProfile

`loadProfile(binName, name, installAnchor, home, options)`（`packages/boot/app-boot/src/profile.ts:371-403`）把一个 profile 名变成**所有层的文件路径与解析后的补丁**。逐段走读：

1. **目录解析**：`resolveProfileDir(name, home)`（`packages/boot/app-boot/src/profile.ts:104-111`）——拒绝空名、含 `/` 或 `\`、`.`、`..`、`node_modules`（因为 `$DSH_HOME/profiles/node_modules` 是自愈回退目录的地盘，6.8），返回 `$DSH_HOME/profiles/<name>`。

2. **404 fallback：模板初始化**（`packages/boot/app-boot/src/profile.ts:376-384`）：

```ts
if (!existsSync(join(dir, 'package.json'))) {
  const template = PROFILE_TEMPLATES[name]
  if (template === undefined) {
    throw new Error(`${binName}: profile ${JSON.stringify(name)} does not exist; create it with 'dsh plugin --profile ${name} add <package>'`)
  }
  initProfile(dir, template)
}
```

语义：profile 不存在**不是错误**，而是"首次使用"——从**发货模板**初始化。`PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:114-117`）：`web → [base, web-app]`，`headless → [base, headless]`。但注意：**模板不是一整份目录拷贝，而是三个文件的生成**（`initProfile`，`packages/boot/app-boot/src/profile.ts:152-168`）：

- `package.json`：`{ name: 'dsh-profile-<name>', private: true, dependencies: {}, dsh: { profile: { bundles: [...] } } }`（`packages/boot/app-boot/src/profile.ts:155-163`）；
- `cordis.patch.yml`：注释 + `[]` 模板（`PROFILE_PATCH_TEMPLATE`，`:127-131`）；
- `pnpm-workspace.yaml`：`nodeLinker: hoisted; autoInstallPeers: false`（`:138-143`；pnpm ≥10 读它而不是 .npmrc，hoisted 让 out-of-tree 插件的缺失 peer 落回自愈目录，见 :133-137 注释）。

未知名字（`dsh --profile foo` 而 foo 不在模板表）→ **明确报错**并提示 `dsh plugin --profile foo add <package>`。这就是"404 有三种结局"：**认识的名字自动初始化；不认识的名字经 `dsh plugin` 也可初始化，但只有一层**——`initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)`（`apps/cli/src/plugin.ts:123`），`DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']`（`packages/boot/app-boot/src/profile.ts:124-125`）注释写明"无发货模板的名字由 `dsh plugin` 初始化时使用的 bundle 列表"，即一个只有 base 的最小 profile；**裸启动不认识的名字则拒绝启动**。

3. **归一化发货清单**：`normalizeShippedProfile`（`packages/boot/app-boot/src/profile.ts:297-312`）——若 bundle 列表**恰好等于**"安装所有权元组"（`INSTALLATION_OWNED_PROFILE_TUPLES`，`:120-122`：headless 的三元组 `[base, web-app, headless]`——安装时 web-app 被加入以便 Web 组件可解析），把它改回发货模板二元组并**写回**（`:303-311`）；其余任何列表视为用户自有，不动（`:301-302`）。这是"升级后可撤销"的装置：发布模板说的就是用户最初看到的两层，其余是安装注入的。

4. **逐 bundle 解析**：`bundles.map(...)`（`packages/boot/app-boot/src/profile.ts:388-397`）：

```ts
const packageDir = resolveBundleDir(binName, packageName, installAnchor, dir)   // 双锚
const bundleManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const declared = bundleManifest.dsh?.bundle?.patch
if (declared === undefined) throw new Error(`${binName}: profile bundle ... declares no dsh.bundle in its package.json`)
const patchPath = join(packageDir, declared)
return { packageName, packageDir, patchPath, patches: loadOverlayPatches(binName, patchPath) }
```

- `resolveBundleDir`（`packages/boot/app-boot/src/profile.ts:344-355`）：**双锚解析**——先安装锚（dsh 自己 package.json 的目录），后 profile 目录；两处都找不到 → 抛错并提示 `dsh plugin --profile <name> install`。安装优先是有意的契约：`@deepseek-ai/dsh-base` 必须来自**正在运行的这次安装**，而不是 profile 里的本地副本（`:332-337` 注释）。
- bundle 的 `package.json` 里必须声明 `dsh.bundle.patch`（指向它的 `cordis.patch.yml`）；**列了 bundle 却没有该声明 = 直接抛错**（`:391-394`，注释 :360-361："命名一个无 patch 的包作为层是配置错误，不是'没有补丁'"）——与 `loadOverlayPatches` 的"缺失即抛错"同一哲学。
- 解析后的补丁经 `loadOverlayPatches` 读出（bundle 的 patch 文件是"层"的必选部分）。

注意 bundle 列表读取的一处宽容：`manifest.dsh?.profile?.bundles ?? []`（`packages/boot/app-boot/src/profile.ts:386-387`，注释 "A hand-written profile manifest may omit the dsh section entirely"）——**手写的 `package.json` 可以完全没有 `dsh` 段**，此时该 profile 的 bundle 层为空，组合退化为"空根 + 用户层 + home 层 + `--patch`"。这不是报错，而是与"声明了 bundle 却缺 `dsh.bundle.patch` 就抛错"（`:391-394`）形成对比：**声明了什么就要完整，没声明就不构成约束**——manifest 的"dsh 段"整体是可选的，但一旦写了，内部字段就必须齐全。

5. **用户层**（`packages/boot/app-boot/src/profile.ts:398-401`）：

```ts
const patches = options.userLayer !== false && existsSync(patchPath)
  ? loadOverlayPatches(binName, patchPath)
  : []
```

`options.userLayer: false` 跳过用户 `cordis.patch.yml`——`--dump-default-config` 就是用它做"修复诊断"：用户层坏了也能打出 bundle 层（`packages/boot/app-boot/src/profile.ts:366-369` 注释）。

## 6.5 补丁栈叠层图：一页看清"谁盖住谁"

把 6.3 的结论画成一页图（自上而下为应用顺序，**下层被上层覆盖**；同层内按数组顺序）：

```
┌─ 7. telemetry 开关        DSH_TELEMETRY_DISABLED（非空即禁用）→ { id: session-telemetry-otel, disabled: true }
│                            （无独立文件；由环境变量派生，见 profile-boot.ts:80-83）
├─ 6. agent-presets         覆盖 agent-presets 行：config.roots += SHIPPED_PRESET_ROOT（trust: system）
│                            （无独立文件；由 composeProfile 派生，见 profile-boot.ts:159-167）
├─ 5. --patch <file>        argv 序，可多个；缺文件=抛错（loadOverlayPatches 必选语义）
├─ 4. $DSH_HOME/cordis.patch.yml   机器级用户层（homePatches）；缺文件=无层（loadOptionalPatches 可选语义）
├─ 3. <profile>/cordis.patch.yml   该 profile 的用户层；缺文件=无层
├─ 2. bundle 层 2           dsh.web-app / dsh.headless（按 dsh.profile.bundles[1]）
├─ 1. bundle 层 1           @deepseek-ai/dsh-base（bundle 层按数组顺序，后层可覆盖前层插入的行）
└─ 0. 空根                  <profile>/cordis.yml = []   （每次启动被 prepareProfile 重写）
```

**每层在你机器上的真实位置**（本章练习的核心材料）：

| 层 | 定位方法 |
|---|---|
| 0 空根 | `$DSH_HOME/profiles/<name>/cordis.yml`（内容恒为 `[]`，见 `apps/cli/src/profile-boot.ts:60-64`） |
| 1-2 bundle | 读 `$DSH_HOME/profiles/<name>/package.json` 的 `dsh.profile.bundles` 数组（顺序即层序）；每个包经双锚解析到磁盘（安装目录或 profile 的 node_modules），它的 patch 文件路径 = 该包 `package.json` 的 `dsh.bundle.patch`（默认 `./cordis.patch.yml`） |
| 3 profile 层 | `$DSH_HOME/profiles/<name>/cordis.patch.yml` |
| 4 home 层 | `$DSH_HOME/cordis.patch.yml`（`apps/cli/src/profile-boot.ts:49-51`） |
| 5 `--patch` | 命令行给出的文件，`argv` 序；被 `resolve(file)` 转绝对路径（`apps/cli/src/profile-boot.ts:148`） |
| 6 agent-presets | 无文件：composeProfile 派生（roots 指向 `apps/cli/config/agent-presets/`） |
| 7 telemetry | 无文件：环境变量派生 |

**验证手段**：`dsh --profile <name> --dump-config`（`apps/cli/src/dump-config.ts:30-52`）打印组合树并按来源分段注释。`# == <文件>` 与 `patched by <层>` 不是装饰，而是 `renderConfigDump` 用**逐层快照 diff** 算出来的（`packages/boot/app-boot/src/index.ts:404-441`）：对第 1..k 层各做一次 `applyEntryPatches`（补丁按调用克隆，注释 :407-410 说明 clone 原因与 6.6.1 相同），把结果逐行 `JSON.stringify` 与上一层快照比较——**新出现的行记 origin 为该层，内容变化的行在 `patchedBy` 数组里追加该层**（`:433-437`）；然后 `groupedDump`（`:444-464`）把连续同标签的行合并成一段，段首写 `# == origin, patched by ...`（`:453` 与 `:461-463`）。所以 dump 的注释精确回答"这行是谁插入的、被谁改过"——前提是**层间逐次比较**，这正是"单次拍平"在诊断侧的镜像。注意：**dump 只覆盖第 0-5 层**——`runDumpConfig` 的层序是 bundle → profile → home → `--patch`（`apps/cli/src/dump-config.ts:32-48`），**不含 agent-presets 与 telemetry 派生层**；且 `--dump-default-config` 连用户层与 `--patch` 都不含（`apps/cli/src/dump-config.ts:36-49`）。所以拿 dump 核对 6/7 层时要心里有数（**该差异已从源码确认**，dump 产物本机未实测，见 6.3.1 注）。

## 6.6 挂载：boot → mountRootInclude → 树 settle

### 6.6.1 runProfile 与 boot

`runProfile`（`apps/cli/src/profile-boot.ts:207-300`）拿到组合后：建 `createProcessShutdown`（6.8）、挂信号、装 fail-loud（`:221-225`），然后调 `boot`：

```ts
const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
  app.current = hostCtx
  hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
  provideCmdline(hostCtx, { args: options.args, exit: code => void shutdown.shutdown(code) })
})
```

注意两点：`structuredClone(allPatches(composed))`（`apps/cli/src/profile-boot.ts:246-247` 注释）——**补丁必须克隆**：include 会把 `insert` 的行**按引用**推进挂载树，后续按 id 命中并原地修改（第 5 章 3d）；若不克隆，某次挂载会把用户覆盖"烤进" bundle 的插入行对象，未来重载再也撤不掉。`prepare` 回调在**任何配置树的 entry 挂载之前**运行（`packages/boot/app-boot/src/index.ts:747` 注释），所以环境快照与命令行参数是"启动事实"，先于一切插件。

`boot`（`packages/boot/app-boot/src/index.ts:757-802`）：

```ts
const ctx = new Context()                                   // ① 根 Context（根 fiber 永不清空 disposables）
ctx.baseUrl = pathToFileURL(dirname(absoluteConfigPath)).href + '/'
ctx.provide('dshHomePath', dshHomePath)                     // ② !!js 表达式可用的路径解析器
await ctx.plugin(Loader)                                    // ③ 挂 Loader 服务
await prepare?.(ctx)                                        // ④ host 准备（cli 注入 cmdline/env）
await mountRootInclude(ctx, absoluteConfigPath, patches, bareModuleBaseUrl)  // ⑤ 根 include
await ctx.get('loader')?.await()                            // ⑥ 等整棵树 settle
if (ctx.get('loader') === undefined) return ctx             //    （surface 可能已自行退出）
await assertEntriesActivated(ctx, binName)                  // ⑦ 最终审计
return ctx
```

失败路径（`packages/boot/app-boot/src/index.ts:786-801`）：`await ctx.fiber.dispose()` 回滚整棵树，然后抛出带**最深层 cause** 的诊断错误（`{ cause }` 链沿到插件自己的 stack，`:797-799`）——所以启动失败时你看到的是原始插件报错，而不只是包装层。`ctx.baseUrl` 指向 profile 目录（`rootConfig` 所在目录），bare 模块名（`@deepseek-ai/dsh-*`）就从这里解析（`packages/boot/app-boot/src/index.ts:769`）。

### 6.6.2 mountRootInclude：把补丁栈交给 Include

`mountRootInclude`（`packages/boot/app-boot/src/index.ts:486-529`）做的事：

1. 注册 builtins：`ctx.loader.builtins.include = Include`、`ctx.loader.builtins.group = Group`（`packages/boot/app-boot/src/index.ts:492-510`）——`cordis:include` / `cordis:group` 两个内置名字由这里注册，走环境模块管线而不依赖被挂树的解析规则（注释 :505-509：agent preset 可能住在工作区之外，无法按名字解析 `@deepseek-ai/cordis-plugin-group`，而 group 行就是"给 provider 和它的消费方同一个 isolate 领域"的机制）。注意第一个注册是**条件子类**：`bareModuleBaseUrl` 未提供时注册原版 `Include`；提供时注册 `HostResolvedRootInclude`（`:494-504`）——它重写 `import`：裸模块名（`@deepseek-ai/dsh-*`，不以 `.`/`/`/`cordis:` 开头）交给 `this.ctx.loader.internal.import(specifier, bareModuleBaseUrl, {})`，**以 dsh 安装为本位、按 Node 原生 ESM 规则从 `bareModuleBaseUrl` 解析**（`boot` 传入的就是 profile 目录的 file URL，`packages/boot/app-boot/src/index.ts:769`）；而相对路径、绝对路径与 `cordis:` 前缀仍走 `super.import`（`:495-503`）。这解释了 6.6.1 里 `ctx.baseUrl` 的用途：用户 patch 里写 bare 名（如 `@deepseek-ai/dsh-base` 的行）能被根 include 解析，靠的正是这个子类把"查找基点"锚定在 profile 目录，而不是 Node 进程自身的 cwd 链；
2. 构造**固定 id 为 `include`** 的根条目（`:511-522`）：固定 id 是为了启动诊断链稳定（随机 id 会让报错每次不同，注释 :511-513）；`config.patches` 就是第 5 章 5.4.4 的内联形态——**dsh 的"多层 patch 文件"最终全部以"根 include 的内联 patches"形式登场**；
3. `await ctx.loader.create(rootInclude)` 并记入 `bootstrapIncludes`（`:523-527`）——第 6.7 的 HMR 靠这个 WeakMap 找到根 include。

Include 挂载后（第 5 章的链路）：读空 `cordis.yml` → `_apply`：`applyEntryPatches([], patches)` → `root.update(data)`（`vendor/include/src/index.ts:315-321`）→ `EntryGroup.update`（`vendor/loader/src/config/group.ts:59-106`）逐行 `create` → 每个 Entry import 模块 / `registry.plugin` / `fiber.await()`。

### 6.6.3 让树 settle：loader.await 与最终审计

`EntryTree.await`（`vendor/loader/src/config/tree.ts:46-64`）：轮询 `getTasks()`（每个 entry 的 `_initTask` 或 `fiber.inertia`，`:36-40`），直到无在途任务，然后逐个 `entry._await()` 取出失败（单个失败抛单错、多个抛 AggregateError），最后 `ctx.reflect.notify(['loader'])`（唤醒等待 loader 的插件，见第 2 章 `Service[check]` 的 `await: true` 用法）。

`assertEntriesActivated`（`packages/boot/app-boot/src/index.ts:692-725`）：一个条目激活才算启动完成——`FiberState.ACTIVE` 通过；`FAILED` 重新 `await` 取回原始 stack；`PENDING` 列出缺失的服务名（`fiber.inject` 里有、`ctx.get` 拿不到的，`:710-713`）。**"挂上了"≠"起来了"**：这一步把"模块解析失败但被 logger 吞掉"的静默失败变成启动失败（`packages/boot/app-boot/src/index.ts:658-664` 的先手检查 `assertEntriesLoaded`）。

## 6.7 热重载：watchUserPatches 与 HMR

`boot` 返回后树已稳定；对长生命周期 surface（web 等），cli 还要让**用户层补丁热生效**。`apps/cli/src/profile-boot.ts:268-298`：

```ts
if (!signalShutdown.signal.aborted && ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
  try {
    // 组合里没有 HMR 服务（headless bundle 把 hmr 行 disabled，见 packages/bundle/headless/cordis.patch.yml:14-15）
    // 就补挂一个"只监视、不重载模块"的 hmr：root: []，再加 timer（hmr 依赖它）
    if (ctx.get('hmr') === undefined) {
      if (ctx.get('timer') === undefined) await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
      await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
    }
    await watchUserPatches(ctx, { binName: NAME, filename: composed.profile.patchPath, compose: composeLive })
    await watchUserPatches(ctx, { binName: NAME, filename: homePatchPath(), compose: composeLive })
  } catch (error) { suppressShutdownError(ctx, signalShutdown.signal, error) }
}
```

两个关键设计：

- **兜底 HMR**：`hmr` 行在 headless bundle 里被禁用（`packages/bundle/headless/cordis.patch.yml:14-15`，注释 :12-13："The shared module-reload HMR row stays off"），但**用户 patch 层仍然要热**——所以缺 HMR 时补挂一个 `root: []` 的"纯监视"HMR（没有模块根，只盯配置文件）＋它依赖的 timer。注释（`apps/cli/src/profile-boot.ts:272-278`）明说：静默跳过会破坏文档化的热重载契约。
- **两处监视，都用 `composeLive`**：

```ts
const composeLive = (): PatchOptions[] => structuredClone([
  ...composed.bundlePatches,
  ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
  ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
  ...composed.overlays,
])
```

（`apps/cli/src/profile-boot.ts:240-245`）。为什么**每次生成都要重读两个文件**：两个 watcher 谁触发都只拿到"自己那个文件的补丁"，如果各自把另一份用昨天的内存值拼接，就会互相喂旧数据（`apps/cli/src/profile-boot.ts:230-234` 注释）。为什么**又克隆**：同 6.6.1 的插入行别名问题——"把用户覆盖烤进 bundle 插入行"后，删掉覆盖就回不去了（`:235-239` 注释）。

`watchUserPatches`（`packages/boot/app-boot/src/index.ts:232-265`）本身很薄：它要求 HMR 服务与根 include entry（`bootstrapIncludes` 里取），然后 `hmr.registerConfig(filename, callback)`。刷新触发时：重读用户层（`loadOptionalPatches ?? []`）→ `compose(userPatches)` 重组完整列表 → `entry.update({ config: { ...includeConfig, patches } })`（`:241-254`）。这一步走第 5 章 Entry.update 的"仅 config 变化"路径：Include 的 `internal/update` 钩子（`vendor/include/src/index.ts:206-213`）把新补丁 `enqueue` 进串行队列 → `_apply` → `root.update(data)` → `EntryGroup.update` 事务性重建（`vendor/loader/src/config/group.ts:59-106`：先并发 create 全部、再删缺失、失败整体回滚）——**改坏一次，回滚到最后一棵好树**（`vendor/include/src/index.ts:296-300` 的 `refresh` JSDoc，关键句在 :299："the last good tree remains active when rollback succeeds"）。

## 6.8 收尾：SIGTERM/SIGINT 与有界退出

`runProfile` 在启动窗口内就接管了信号（`apps/cli/src/profile-boot.ts:216-225`）：

```ts
process.on('SIGTERM', () => { interrupt(0) })    // 监督者的常规停止：正常退出码 0
process.on('SIGINT', () => { interrupt(130) })   // 用户中断：报告 130
installFailLoud(NAME, process, async () => { await app.current?.fiber.dispose() })
```

`interrupt` 里先 `signalShutdown.abort()` 再 `shutdown.interrupt(code)`（`apps/cli/src/profile-boot.ts:212-215`）——注意**信号在启动窗口内就生效**（注释 :216-218：已挂载的 provider 可能在兄弟行完成前就发布，若只等 `boot()` 返回才处理信号，会漏掉窗口期）。

`createProcessShutdown`（`apps/cli/src/process-shutdown.ts:22-77`）提供两个入口：

- `shutdown(code)`：优雅路径——挂 5 秒宽限定时器（`PROCESS_SHUTDOWN_TIMEOUT_MS`，`apps/cli/src/process-shutdown.ts:4`），调用应用 disposer（这里是 `app.current?.fiber.dispose()`，整棵树卸载）；成功 → `completeOnce(code)` 只设 `process.exitCode`（**不强制退出**，让事件循环自然排空）；失败 → 强制 `forceExitOnce`（`:52-63`）。
- `interrupt(code)`：信号路径——若无待决 shutdown，调 `start(code, true)`：dispose 成功也**直接强制退出**；若已有待决 shutdown，**第二次信号立即强制退出**（escalate，`:69-75`）。语义差别注解在 `apps/cli/src/profile-boot.ts:218-220`：SIGTERM 是监督者请求、应用可能正干完活（退出 0）；SIGINT 是用户拍桌子（130）。

另一条兜底线是 `installFailLoud`（`packages/boot/app-boot/src/index.ts:609-649`）：启动后的**未处理拒绝**不再是"静默失败"，而是打印 stack、可选地执行 release（终端所有者恢复终端，带 2 秒超时 `FAIL_LOUD_RELEASE_TIMEOUT_MS`，`:578`）、然后 `exit(1)`。因为 Loader 并发挂载条目的原因，一个兄弟条目失败时终端可能已处于原始模式——直接 `process.exit` 会把用户 shell 留在崩溃态（`:586-594`）。已归入启动诊断的拒绝则被 `assembledActivationRejections` 放行（如 `:616` 的检查）。**这解释了"为什么 dsh 异常退出时行为如此讲究"**：错误路径同样是产品的一部分。

## 6.9 404 fallback 与 healed 模块：两个"找不到"的哲学

本章出现两个"找不到"，处理方式相反，值得对读：

**404 fallback（profile 不存在）**：见 6.4 第 2 步——**认识的名字自动初始化**（web/headless 从发货模板生成三个文件），不认识的名字报错。为什么敢于"自动创建"：模板是发布内容（`PROFILE_TEMPLATES` 常量），生成的目录内容完全确定；且 `initProfile` 对已存在的文件**永不覆盖**（`packages/boot/app-boot/src/profile.ts:148-149` 注释："Existing files are never touched, so re-running is a no-op"）。这是"首次使用体验"与"可预期性"的平衡。

**healed 模块（bundle 找不到）**：`healProfilesModuleFallback(installAnchor)`（`packages/boot/app-boot/src/profile.ts:223-255`）在每次启动前**自愈**一个目录：`$DSH_HOME/profiles/node_modules`。它是什么、为什么需要？

- 事实：profile 目录要装**out-of-tree 插件**（`dsh plugin add` 装的东西），其 `node_modules` 由 pnpm 管；但**内置 bundle 与内置插件必须来自安装本体**（"bundles come from the installation"，`packages/boot/app-boot/src/profile.ts:210-212` 注释）。Node 解析 bare 名（`@deepseek-ai/dsh-base`…）靠父目录上溯——profile 的 node_modules 里没有它们，上溯也就找不到。
- 办法：维护一个**扁平回退目录**，对"dsh 应用依赖闭包"里的每个包建一个**junction 符号链接**（`:250-254`）。闭包用 BFS：从 app 的 package.json 出发，`dependencies` **与 `peerDependencies` 都参与**（`:233-249` 注释：Service Definition 包（`dsh-subprocess`、`dsh-compaction` 等）是实现的 peer、从不是普通依赖，而 out-of-tree 插件直接 import 它们）；每个包解析到它自己的**真实目录**（`packageDirFromAnchor`，`:322-330`：按 Node 自身的 node_modules 查找顺序探测，结果与 Loader 从同一锚点 import 一致）。声称解析的包按自己的真实位置被链接，Node 默认跟随符号链接解析其依赖（`:214-216` 注释），所以每个包一个扁平链接就够。
- 幂等性：正确的链接保留、移动的安装重新指向、悬空链接对解析不可见（`:217-219`）；并发启动竞争写同一链接时"输了但内容相同"也算成功（`:189-201`）。Windows 用 `junction`（目录符号链接不需要管理员权限，`:184-190` 注释还处理了 `unlink` 与 `rmSync` 的差异）。

把两个"找不到"并置：**profile 找不到 → 模板生成（乐观）；包找不到 → 要么自愈（回退目录），要么报错并提示 `dsh plugin install`（负责任的失败）**。dsh 的错误设计原则在这里贯穿始终：可自动修复的自动修复（且幂等、可重入），不可自动修复的就给出一条可执行的命令。

## 6.10 本章小结

1. 启动 = 组装补丁栈 + 单次拍平 + 挂载：`parseDshArgs`（三模式、`--patch` 按 argv 收集、参数直通）→ `composeProfile`（空根 + bundle 层 + profile 层 + home 层 + `--patch` + agent-presets + telemetry）→ `boot`（`mountRootInclude` 把补丁栈作为根 include 的内联 patches）→ `loader.await()` + `assertEntriesActivated`。
2. 补丁栈上层覆盖下层；`composeEntries` 与挂载共用 `applyEntryPatches`——**单次拍平、单一索引、所见即所挂**；插入行跨层可见（第 5 章的"插入行立即建索引"）。
3. 每层都能定位到磁盘文件：`$DSH_HOME/profiles/<name>/{package.json,cordis.yml,cordis.patch.yml}`、`$DSH_HOME/cordis.patch.yml`、bundle 的 `dsh.bundle.patch`、`--patch` 文件；agent-presets 与 telemetry 是派生层（无文件）。
4. `prepareProfile` 每次启动重写空根 `cordis.yml`，防止 Loader 写回把组合行烤进根文件造成重复 insert。
5. 热重载：`watchUserPatches` 通过 HMR 监视两个用户层文件，`composeLive` 每次新鲜重读并克隆（防插入行别名污染），失败走事务回滚；缺 HMR 时兜底挂"纯监视"实例。
6. 退出：SIGTERM/0、SIGINT/130，5 秒宽限、二次信号强制退出；fail-loud 保终端与诊断。

## 6.11 分层练习

**理解**：
1. 不查资料，画出补丁栈七层并标注每层的文件来源；说出哪两层没有独立文件、由什么派生。
2. 解释：为什么 `--patch` 缺失文件会抛错，而 `$DSH_HOME/cordis.patch.yml` 缺失却静默通过？（提示：`loadOverlayPatches` vs `loadOptionalPatches`）

**应用**：
3. 在真机运行 `dsh --profile web --dump-config`（**未验证**：需构建），对照 6.5 的表，为输出里任意三行注明它们来自哪一层（`# ==` 注释就是线索）。若你还没有构建，就用 6.5 的定位方法从 `$DSH_HOME/profiles/web/package.json` 与 `cordis.patch.yml` 手工推出该 profile 会加载哪些行。
4. 为 `dsh --profile headless` 写一条 `$DSH_HOME/cordis.patch.yml`：禁用 `session-telemetry-otel`，再设置 `DSH_TELEMETRY_DISABLED=0`，解释两者叠加后谁生效（提示：两处都产生 `disabled: true`，作用相同；但请从 "ANY non-empty value" 语义说明 `'0'` 的含义——见 6.3 第 7 步）。

**综合**：
5. 假设你在 `cordis.patch.yml` 里写错了 `id`（目标行不存在），启动会怎样？如果写成一个**非法 YAML**（顶层不是数组），又会怎样？两条路径分别对应本章哪个函数？
6. 设计一个"最小 profile"：手工在 `$DSH_HOME/profiles/mini/` 下创建 `package.json`（`bundles: ['@deepseek-ai/dsh-base']`）、`cordis.patch.yml`、`cordis.yml`，然后预测 `dsh --profile mini` 会挂载哪些基础服务（提示：`@deepseek-ai/dsh-base` 是唯一 bundle 层，其 patch 文件见 `packages/bundle/base/cordis.patch.yml`）。**（未验证：需要构建并运行 dsh。）**

**挑战**：
7. 论证 `prepareProfile` 的"每次重写空根"是必须的：如果删掉这步，Loader 的树写回会在什么场景下造成"重复 insert"，具体是哪一段代码会写回？（提示：`vendor/loader/src/index.ts:103-109` 的 `internal/update` 钩子与 `vendor/loader/src/index.ts:151-156` 的 `options.disabled = true` 写回路径。）

## 6.12 延伸阅读

- 仓库内：`packages/boot/app-boot/src/profile.ts`（本章数据模型与全部纯函数）、`packages/boot/app-boot/src/index.ts`（boot/挂载/注视/watch）、`apps/cli/src/profile-boot.ts`（补丁栈与生命周期）；`docs/cordis-tutorial/06-composition-and-hmr.zh.md`（id 稳定性与 HMR 的概念版）。
- 第 7 章预告：bundle 的 `dsh.bundle` 声明与三个内置组合包（`packages/bundle/*`）——本章只用了 resolve 结果，没有看 bundle 里具体装了什么。
- 上游：Cordis HMR（`@cordisjs/plugin-hmr`）、pnpm workspace `nodeLinker: hoisted`；Node 模块解析规则（父目录上溯、junction 语义）。
