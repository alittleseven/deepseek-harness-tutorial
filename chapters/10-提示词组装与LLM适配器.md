# 第 10 章　提示词组装与 LLM 适配器

> **本章学习目标**（读完本章，你应该能够）：
> 1. 描述提示词段（prompt section）的注册、排序、`complete` 机制，说出 order 约定（-100 身份、0 persona、100-199 工具）；
> 2. 说明工具 schema 如何从工具注册表进入每一条模型请求，以及 `toolOrder` 的校验规则；
> 3. 讲清 llm 包的消息与流式词汇表（StreamChunk、failure chunk），以及适配器注册的路由、校验与替换语义；
> 4. 准确说出 prepareCall 一次调用准备做了哪几件事；
> 5. 说明 llm-retry 与 token-meter 为什么挂在事件/会话流水线上，而不是包裹 `ctx.llm.stream()`。
>
> **本章讲法**：机制型，两问驱动——"模型看到的提示词是拼出来的，谁拼的？""同一套循环怎么换模型商？"第一个问题通向 `@deepseek-ai/dsh-system-prompt` 组装机制，第二个问题通向 `@deepseek-ai/dsh-llm` 适配器（adapter）seam，最后在真实提供方 DeepSeek 适配器的完整走读中合流。
>
> **前置**：第 8 章（会话日志）、第 9 章（Agent Loop）。

## 10.1 两个问题与一张总图

第 9 章已走完一次轮次（turn）的一生：`step()` 组装请求、流式读取、拼装消息。本章回答它刻意跳过的两个"谁"：

**问题一：模型看到的提示词是拼出来的，谁拼的？** 系统提示词不是配置里一整段字符串，而是各插件贡献的"段"（section）按序拼接、再经变量插值而成。谁负责收集、排序、插值？——`SystemPrompt` 服务（`@deepseek-ai/dsh-system-prompt`）。

**问题二：同一套循环怎么换模型商？** Agent Loop 对 DeepSeek、pi-ai、自建网关一视同仁，只调 `ctx.llm` 一个服务。换模型商不换循环，靠的是适配器（adapter）这个 seam：把 harness 的请求词汇翻译成某家供应商的 HTTP 接口。翻译由 `@deepseek-ai/dsh-llm` 的 `LlmRuntime` 调度。

补全第 9 章链路，本章要讲的就是中间两段：

```
第 9 章 step()（agent.ts:332）
 ├─ systemPrompt.assemble() ──► PromptAssembly{sections, contexts, tools, variables}
 ├─ renderPrompt() ──────────► system 字符串 ─────────────────────┐
 ├─ renderContextSections()+joinContextSections() ─► 运行时上下文快照（并入 user 消息）
 └─ buildRequest() ──────────► GenerateOptions{provider, model, messages, system, tools}
        │  llm.prepareCall()（llm/index.ts:779）──► PreparedLlmCall（绑定适配器注册）
        ▼
 llm/stream waterfall ──► adapter.stream() ──► SSE ──► StreamChunk* ──► BlockAssembler
                                                                             │
                       assistant/chunk 逐条入日志（第 8 章）←───────────────┘
```

上半条链（提示词）在 10.2–10.6 节，下半条链（适配器）在 10.7–10.12 节。

## 10.2 提示词段：三块积木与一个顺序约定

### ① 类比：不是一整张拼图，而是一堆积木

想象一个"接力画"游戏：每个人只画自己负责的一块，主持人按约定顺序把它们首尾相接成一幅完整画面。dsh 的系统提示词正是如此——没有任何一个插件拥有"整段提示词"，每个插件只贡献自己那一块，拼装由主持人（`SystemPrompt`）完成。

### ② 精确定义：PromptSection

> **提示词段（prompt section）**：一次对系统提示词的具名贡献。定义为 `PromptSection` 接口（`packages/core/system-prompt/src/index.ts:53-75`），四个字段：`name`（全库唯一，重复注册抛错）、`order`（数值，段按升序拼接）、`text`（静态字符串，或每次组装时求值的函数 `(context) => string`）、`complete?`（可选布尔：把该段当作完整系统提示词）。

顺序约定写在接口注释里（`packages/core/system-prompt/src/index.ts:57-59`）：`-100` 是 harness 身份，`0` 是部署 persona，工具指引用 `100-199`，其余负数段也渲染在 persona 之前。这些槽位有具名常量：`PERSONA_SECTION = 'deployment:persona'`（`:128`）与 `PERSONA_ORDER = 0`（`:131`），以及保留标记 `TOOL_ORDER_REST = '<unlisted-tools>'`（`:140`，10.6 节用）。导出常量是因为该槽位可被替换：agent 预设用同名段遮蔽部署 persona，同名即替换而非重复（`:122-127`）。

`SystemPrompt` 构造器（`packages/core/system-prompt/src/index.ts:353-371`）自己就注册两块：`harness:identity`（order -100，文本 `'You are an AI agent powered by DeepSeek Harness.'`，受配置 `includeHarnessIdentity` 控制，`:357-363`）和 `deployment:persona`（order 0，文本来自配置 `persona`，`:364-369`）。

### ③ 最小示例：配置里的 persona 段

`examples/headless-agent/cordis.yml:50-57`：

```yaml
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    agents:
      - id: main
        provider: deepseek-official
        model: deepseek-v4-flash
    persona: |
      You are headless-agent, a coding assistant powered by the {{model}} model.
```

这段 persona 里的 `{{model}}` 是**变量引用**，渲染时才被替换（10.5 节）；`model` 由 agent-loop 插件注册（`packages/core/agent-loop/src/index.ts:351-353`，`provider`/`model`/`cwd` 三个变量都来自当前 agent 的选项）。这就是"静态配置 + 动态求值"的最小示范：**段文本是模板，变量提供方在组装时填值**。

### ④ complete 段的语义

`complete: true` 的段声明"我即全部"。组装并不会因此跳过其他机制：瀑布（waterfall）照常运行，工具、上下文、变量照常解析，之后才把该段恢复为唯一提示词段（`packages/core/system-prompt/src/index.ts:68-74` 注释、`:536-541` 实现）。若同时有多个有效 complete 段，组装直接失败（`:505-508`）。注意一个细节：complete 段的"权威性"发生在 assemble 返回值上，而瀑布监听器无法增删该 scope 的提示词——注释明确说"listeners cannot add to or replace that scope's system prompt"（`:24-26`），这是对第 4 章 waterfall 语义的一个例外式限定（推断：为了给"锁定提示词"的部署场景留出强制通道）。

## 10.3 注册 API：五个方法、两组容器

`SystemPrompt` 对外提供五个注册方法，全部返回 Cordis 的 effect 撤销函数（与第 3 章"注册即 effect"一致）。其中"动态上下文（context）段"与 Cordis 的依赖容器上下文（Context，第 2 章）不是一回事：前者是给模型看的文本块，后者是依赖注入作用域——勿混用。

| 方法 | 注册什么 | 容器 | 作用于 |
|---|---|---|---|
| `section()`（packages/core/system-prompt/src/index.ts:381-390） | 提示词段 | `NamedEntries`（名唯一） | system 槽 |
| `context()`（packages/core/system-prompt/src/index.ts:398-407） | 动态上下文段 | `NamedEntries`（名唯一） | user 角色快照 |
| `tools()`（packages/core/system-prompt/src/index.ts:430-436） | 工具 schema 提供方 | `AnonymousEntries`（多提供方） | 请求 tools 字段 |
| `variable()`（packages/core/system-prompt/src/index.ts:446-455） | 变量提供方 | `NamedEntries`（名唯一） | `{{name}}` 插值 |
| `suppressRuntimeContext()`（packages/core/system-prompt/src/index.ts:415-421） | 抑制标记 | `AnonymousEntries` | 清空 contexts |

两组容器语义不同（`packages/core/scope/src/store.ts`）：`NamedEntries` 同名 `insert` 直接抛错（`:43-54`），"重复注册"立即失败；`AnonymousEntries` 允许任意多个提供方共存（`:114-150`），`tools()` 与抑制标记是"共同贡献者"——每个工具插件追加自己的 schema 提供方，全体求值合并。

作用域（scope）语义与第 9 章的 agent 作用域一致：注册发生在调用方 `ctx` 的作用域；`ScopedLayers.merge` 把全局条目与作用域链条目合并，近者胜（`packages/core/scope/src/store.ts:208-217`），所以"scoped section 遮蔽全局同名段"（`packages/core/system-prompt/src/index.ts:373-376` 注释）。

四个细节值得记：

1. `section()` 与 `context()` 要求 `order` 是有限数，否则 `TypeError`（`packages/core/system-prompt/src/index.ts:382-384`、`:399-401`）；
2. `tools()` 的提供方函数**每次组装都会重新求值**（`:493-494`），不是注册时快照——新注册的工具立即出现在下一次组装里；
3. `variable()` 校验名字形如 `[a-z][a-z0-9_]*`（`:447-449`），提供方**允许返回 `undefined`**，但任何段引用了这个变量，渲染时就会抛错（`:441` 注释 + `:288-290` 实现）——值能否提供取决于组装时刻的运行状态；
4. `context()` 注册的动态上下文最终进入 **user 角色的运行时上下文快照**（`PromptContext` 注释 `:77`），而不是 system 槽——因为它描述"当前这一刻运行时的状态"（工作区、已打开文件等），随会话历史推进而更新，与第 8 章"模型可见即已记录"的日志模型衔接。

## 10.4 assemble 走读：一次组装的十个动作

`assemble(context)`（`packages/core/system-prompt/src/index.ts:467-542`）是本章核心流程。每次模型步骤开始前，Agent Loop 在 `preStep` 里调用它一次（`packages/core/agent-loop/src/agent.ts:230`），产物 `assembly` 随后传给 `step(assembly)`（`packages/core/agent-loop/src/agent.ts:287`）。逐段读代码：

**① 确定作用域链与抑制状态**（packages/core/system-prompt/src/index.ts:469-471）：`chainLayers(scope)` 给出"最远祖先 → 最近"的层序列（`packages/core/scope/src/store.ts:192-199`）；任一层的抑制标记非空，`runtimeContextSuppressed` 即为真，本次组装不带任何上下文段。

**② 变量求值**（packages/core/system-prompt/src/index.ts:473-482）：先全局层，再作用域链由远及近逐层覆盖同名变量——"nearest scope wins"，且**全局变量的 `undefined` 也会被作用域值覆盖**。注意这里的覆盖是整键覆盖，不是合并。

**③ 段与上下文的合并**（packages/core/system-prompt/src/index.ts:484-485）：`this.layers.merge(scope, ...)` 得到"名称 → 定义"映射，全局被 scoped 遮蔽。同名即遮蔽，所以 agent 预设能替换部署 persona。

**④ 工具 schema 收集**（packages/core/system-prompt/src/index.ts:491-503）：全局与各作用域层的工具提供方**全部**参与（不遮蔽、只合并），每个提供方用本次组装的 `context` 求值一次；`parameters` 经 `structuredClone` 深拷贝（:498）——把 JSON Schema 从工具注册表上"拆下来"，防止组装方或模型请求篡改注册表的原件。`knownNames` 收集"该 scope 逻辑上已知但可能被限制掉"的工具名（:500-503），供 10.6 节的 `toolOrder` 校验使用。

**⑤ 段排序与 complete 检查**（packages/core/system-prompt/src/index.ts:504-508）：`sectionDefinitions` 由合并映射的值按 `order` 升序排序（注意排序键是段定义，不是拼好的文本）；多于一个 complete 段即抛错。

**⑥ 文本求值**（packages/core/system-prompt/src/index.ts:510-518）：`text` 是函数则当场调用，是字符串则原样保留。产物 `AssembledSection` 只含 `name` 与未插值的 `text`。

**⑦ 组装装配**（packages/core/system-prompt/src/index.ts:519-531）：contexts 按 `order` 排序、`tools` 交给 `orderTools`（10.6 节）、variables 原样带入；`runtimeContextSuppressed` 时 contexts 直接空数组（:521-522）。

**⑧ 瀑布**（packages/core/system-prompt/src/index.ts:532-535）：`this.ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))`。这是专家级扩展点：任何插件可监听 `system-prompt/assemble` 改写组装结果，**返回的 assembly 是权威的**（事件声明注释 `:20-26`）。瀑布按 scope 分发：scoped 监听器只收本 scope 的组装（:21-22）。

**⑨ 恢复 complete / 清空 contexts**（packages/core/system-prompt/src/index.ts:536-541）：若有 complete 段，无论瀑布改写了什么，`sections` 被替换成仅该段；若抑制了运行时上下文，`contexts` 强制为空。这两个例外在瀑布**之后**执行，所以监听器管不到它们。

**⑩ 调用方使用**：`preStep` 用同一 assembly 渲染上下文快照（`packages/core/agent-loop/src/agent.ts:232-233`），`step` 用它渲染 system 提示词（`packages/core/agent-loop/src/agent.ts:337`）并取 `assembly.tools` 构造请求（`packages/core/agent-loop/src/agent.ts:341`）。

## 10.5 插值与渲染：严格到"裸花括号也算散文"

组装产物里的 `text` 还是模板，渲染（render）才是最后一步。两个纯函数：`renderPrompt` 与上下文渲染三件套。

**`interpolate`**（packages/core/system-prompt/src/index.ts:258-295）是插值的唯一实现，规则逐条读：

- 变量名必须匹配 `VARIABLE_NAME = /^[a-z][a-z0-9_]*$/`（packages/core/system-prompt/src/index.ts:134），即小写字母开头、全小写字母/数字/下划线；`GROUP_AT = /^\{\{([^{}]*)\}\}/`（:137）做位置锚定；
- 位置扫描到 `{{` 后：若其后**没有** `}}`，视为字面散文原样保留（:269-275）；若有 `}}` 但组内容非法（如 `{{foo bar}}`、`{{}}`），抛 malformed 错误（:271-272、:277-281）；
- 变量未注册（用 `Object.hasOwn` 检查，防走原型链 `Object.prototype`，:283-285）抛 unknown 错误，并把已注册变量名列进消息里；
- 变量注册了但本次值为 `undefined`，抛"no value for this assembly"（:288-290）；
- 替换值本身不再被扫描（:205-208 注释），所以值里写 `{{x}}` 不会二次展开——一层插值，绝不递归。

**`renderPrompt`**（packages/core/system-prompt/src/index.ts:212-217）：对每段 `interpolate` → 丢掉空段 → 用 `'\n\n'` 连接。空段丢弃意味着"什么都没贡献的段不占一个段落占位"。

**上下文三件套**：`renderContextSections`（packages/core/system-prompt/src/index.ts:251-255）把每个 context 插值后按"非空文本"过滤，返回**带名字**的段列表；`joinContextSections`（:236-240）用 `'\n\n'` 连接，并在非空时加一行标题 `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.`（:239）——"此快照取代更早的快照"，告知模型以哪一份为准；`renderContextSnapshot`（:224-226）是两者之和。保留命名段而非直接拼接，是为让展示方（如 UI）标注每段来源（:242-250 注释）。`preStep` 取这两步产物，经 `runtimeContext.project` 投影为 user 消息，追加在领取到的消息之后（`packages/core/agent-loop/src/agent.ts:232-238`）。

**最小示例**（纯函数，可离线在 Node 里跑，未在真机构建验证）：

```ts
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const prompt = renderPrompt({
  sections: [
    { name: 'harness:identity', text: 'You are an AI agent.' },
    { name: 'deployment:persona', text: 'Answer in Chinese, model {{model}}.' },
    { name: 'empty', text: '{{missing}}' },   // 插值时就抛错
  ],
  contexts: [],
  tools: [],
  variables: { model: 'deepseek-v4-flash' },
})
// 实际输出："You are an AI agent.\n\nAnswer in Chinese, model deepseek-v4-flash."
```

把 `{{missing}}` 换成 `{{model}}` 则正常；换成 `{{Model}}` 会因变量名不合法抛错——严格校验把"拼错变量名"变成组装期错误，而非把字面 `{{Model}}` 发给模型。

## 10.6 工具 schema 怎样进入每条请求

问题一还剩最后一块：`assembly.tools` 从哪来、又到哪去？

**来路**。`ToolRuntime` 构造器里注册了唯一一个全局工具提供方（`packages/core/tools/src/index.ts:832`）：`ctx.systemPrompt.tools(context => this.wireSchemas(context.scope))`。`wireSchemas`（:980-1000）读取该 scope 的可见工具视图，把每个工具定义投影为 `ToolSchema {name, description, parameters}`（`packages/llm/llm/src/types.ts:312-317`），并附带 `knownNames`——被 `restrict` 限制掉的工具名仍算"已知"（:985；设计说明见 :977-979），因为 `toolOrder` 校验要区分"拼错名字"与"合法但被隐藏"。

**排序与校验**。`assemble` 把收集到的 schema 交给 `orderTools`（packages/llm/llm/src/types.ts:164-178），规则：

1. 任何提供方返回保留名 `<unlisted-tools>` 直接抛错（packages/llm/llm/src/types.ts:165-168）；
2. 配置了 `toolOrder` 时：未列出的工具按字典序插入 `<unlisted-tools>` 槽（:174-177），列出的工具按给出的顺序（:176-177）；
3. `toolOrder` 里出现未注册的名字抛错，并列出已知工具（:170-173）——"拼错名"在组装期暴露；
4. 未配置 `toolOrder` 时按字典序排序（:169）；比较函数是码元字典序（:181-183），保证任意机器上顺序一致。

配置在加载时即校验（`validateToolOrder`，packages/llm/llm/src/types.ts:146-157）：重复名抛错、缺 `<unlisted-tools>` 标记抛错（:153-155）；配置注释（:196-201）补充：已知但被 scope 隐藏的工具名允许缺席——scope 不同，可见集不同。

**去路**。`step()` 把 `assembly.tools` 传给 `buildRequest`（`packages/core/agent-loop/src/agent.ts:341`），后者放进请求头与最终请求（`packages/core/agent-loop/src/agent.ts:458-463`、`packages/core/agent-loop/src/agent.ts:486-493`）：`request.tools` 与 `request.system` 共同成为 `GenerateOptions` 字段（`packages/llm/llm/src/types.ts:320-356`），DeepSeek 适配器 `serializeRequest` 映射为 wire `tools` 字段（`packages/llm/llm-deepseek/src/serialize.ts:144-148` 注释）。闭环：**工具注册表 → 组装 → 请求 → wire**，每步产物可重建（第 8 章"模型可见即已记录"：请求内容是会话日志的纯函数，`llm/stream` 注释 `:56-59` 再次强调）。

## 10.7 适配器：让循环只认识一个插座

### ① 类比：电源转换头

去国外旅游，手机只认一种插孔，各国墙壁插座却不同。转换头把"墙壁的世界"翻译成"插头的世界"——手机毫不知情。dsh 的 Agent Loop 就是手机：只依赖 `ctx.llm` 一个服务（`packages/llm/llm/src/index.ts:46-49` 声明），DeepSeek、pi-ai、自建网关这些"国家"各有各的插座形状（请求/响应协议不同）。转换头就是 **`LlmAdapter`**。

### ② 精确定义：LlmAdapter

> **适配器（adapter）**：把 harness 的统一请求（`GenerateOptions`）翻译为某一家模型供应商的线上协议，并把它家的线上增量翻译回 harness 的统一流式词汇（`StreamChunk`）的对象。抽象类 `LlmAdapter`（packages/llm/llm/src/index.ts:180-233）定义了四个可覆写方法与一个必须实现的方法：

| 方法 | 默认行为 | 语义 |
|---|---|---|
| `providerInfo(provider)`（packages/llm/llm/src/index.ts:186-188） | `{id: provider, name: provider}` | 展示元数据，`id` 必须等于路由名 |
| `providerRetryPolicy(_provider)`（packages/llm/llm/src/index.ts:195-197） | `undefined`（用默认重试策略） | 该路由专属的重试策略 |
| `listModels(_provider)`（packages/llm/llm/src/index.ts:206-208） | `[]` | 可广告的模型目录（仅供参考，不限制请求） |
| `resolveModel(provider, model)`（packages/llm/llm/src/index.ts:219-225） | 恒等 `{provider, id: model, name: model}` | 精确模型的元数据（上下文窗口、默认 maxTokens、推理档位） |
| **`stream(options)`（packages/llm/llm/src/index.ts:232）** | 抽象方法 | **唯一必须实现**：按契约产出 `StreamChunk` 流 |

请求词汇 `GenerateOptions`（`packages/llm/llm/src/types.ts:320-356`）列出：`provider`/`model` 选路由、`messages`（模型看到的对话，不含 system）、`system`、`tools`、`temperature`/`maxTokens`/`stop`、`signal`（中止信号，适配器必须尊重）、`sessionId`（会话标识）、`purpose`（辅助调用分类，如 'compaction'）。**适配器只管这一个对象 → 一个 HTTP 请求的翻译**——连接参数、密钥、用户 ID 由注册插件注入（10.11 节）。

### ③ 最小示例：EchoAdapter

```ts
import { LlmAdapter, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** 最小适配器：把最后一条 user 消息的文本原样回显为流式增量。离线演示，未实测运行。 */
class EchoAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = [...options.messages].reverse().find(m => m.role === 'user')
    const text = last ? last.content.map(b => (b.type === 'text' ? b.text : '')).join('') : ''
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const piece of text.match(/.{1,4}/g) ?? []) {
      yield { type: 'text-delta', index: 0, text: piece }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```

这个例子只为了展示契约：**一个对象、一个异步迭代器**。它不发 HTTP、无需 API 密钥，但必须注册进 `LlmRuntime` 才有意义——下一节。

## 10.8 注册与路由：一次性成功、可原子替换

### ① registerAdapter：all-or-nothing 的承诺

`ctx.llm.registerAdapter(providers, adapter)`（`packages/llm/llm/src/index.ts:338-367`）：`providers` 是路由名数组（如 `'deepseek-official'`），一个适配器实例可同时服务多条路由。三步走：

1. **空数组直接拒绝**：`an adapter must register at least one provider`，错误码 `INVALID_ADAPTER`（packages/llm/llm/src/index.ts:346）；
2. **先校验、后提交**：`commitRoutes(owned, this.prepareRoutes(providers, adapter, owned))`（:347），`prepareRoutes`（:374-396）逐个校验路由名非空（:378）、重复或已被他人占用（:379-381，`DUPLICATE_ADAPTER`）、`adapter.providerInfo(id)` 的 `id` 必须等于该路由且 `name` 非空（:382-385），再为每条路由固化 `retryPolicy`（`adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(...)`，:387-388）。校验期不写任何状态——"有一个不合法，整个注册都不发生"；
3. **提交在 effect 里**（:345-354）：注册与 fiber 同生命周期，disposer 把 `owned` 里的路由全部删除并广播（:350-352）。

**注册时固化的 retryPolicy 是关键设计**：策略属于路由的注册时刻，而非每次请求重读配置（注释 `packages/llm/llm/src/index.ts:158-159`）；代价是配置变更须显式更新注册——10.11 节 llm-deepseek 用 `registration.replace()`。

### ② replace：一个同步段里的换轨

`AdapterRegistrationHandle`（packages/llm/llm/src/index.ts:239-257）除了是可调用 disposer，还带 `replace(providers)`：

- 候选集**先整体校验**（非法名、与他方冲突、元数据错误都抛错且原路由不动）——"校验失败不动当前，是 swap 不是 delete-then-add"（packages/llm/llm/src/index.ts:245-248 注释）；
- 提交是**一个同步段**：`commitRoutes`（:405-413）先删 `owned`、再逐条写入新集合、最后广播 `llm/adapters-updated`——这中间没有任何 `await`，所以"不存在一个时刻适配器消失了"（:399-404 注释）；
- 空数组是合法的（设置段清空路由但保持注册），与初始注册必须非空不同（:248-249 注释）；
- 注册已释放后再 `replace` 抛 `REGISTRATION_DISPOSED`（:361-362）——disposer 已跑过，此刻再注册便无人能释放。

### ③ 目录、发现与通知

`registerConfigurableProviders`（packages/llm/llm/src/index.ts:431-484）是"声明式提供方目录"：一个插件声明它拥有哪些可被配置激活的提供方（`LlmConfigurableProvider`：provider、displayName、settingsNs、settingsPath，`packages/llm/llm/src/types.ts:166-187`），同样 all-or-nothing、可 `replace`（:477-482）、空集拒绝（:464-466）、重复声明 `DUPLICATE_DIRECTORY`（:451-453）。它与 `registerAdapter` 的分工：后者是"活着的路由"，前者是"可供设置面激活的候选"——所以 10.11 节里 llm-deepseek 同时调用两者。`registerModelDiscovery`（:504-521）则允许插件为某个 settings 命名空间提供"探测端点广告模型"的能力，属于设置面辅助，本章不展开。

所有注册的增删都广播 `llm/adapters-updated`（`packages/llm/llm/src/types.ts:23`）。广播实现 `emitAdaptersUpdated`（`packages/llm/llm/src/index.ts:296-322`）有条纪律：**观察者失败不否决提交**——Cordis `emit` 用 `Array.map`，一个同步抛错的监听器会饿死后面的（:298-299 注释），故逐个 try/catch，普通失败只记警告，仅 `INVARIANT` 码重抛（:313-321）。通知是"告知"不是"表决"。

**与第 6/7 章衔接**：`examples/headless-agent/cordis.yml:23-28` 的 `llm-deepseek` 一行（`name: '@deepseek-ai/dsh-llm-deepseek'`）加载时执行 `apply()`，即本节全部注册的入口；注释（`packages/llm/llm-deepseek/src/index.ts:4-7`）说明用户设置文档里的 `llm-deepseek:` 段覆盖该入口而无需重启——生效通道正是 10.11 节的 `options()` thunk 与 `registration.replace()`。

## 10.9 一次调用的准备：prepareCall

请求发出前，Agent Loop 在 `buildRequest`（`packages/core/agent-loop/src/agent.ts:407-495`）里做"提案-解析-绑定"三步，核心是 `llm.prepareCall`（`packages/llm/llm/src/index.ts:779-814`）。

**① 种子配置**（`packages/core/agent-loop/src/agent.ts:419-437`）：从会话请求头恢复上次路由与显式 `reasoningEffort`（仅当适配器默认值没有覆盖它时，:422-426），叠加 `options.maxTokens` 形成种子——"循环从自己声明的路由开始"。

**② 中间件改写**：`agent/request` waterfall（`packages/core/agent-loop/src/agent.ts:438-441`）让任何插件改写 provider/model（第 9 章讲过），结果必须两者非空（:443-445）。

**③ prepareCall 解析**（`packages/llm/llm/src/index.ts:780-793` + `resolveCallFor` :734-769）：

- `registration(config.provider)`（packages/llm/llm/src/index.ts:816-820）查路由，查不到抛 `NO_ADAPTER`；
- `resolveModelInfoFor`（:627-718）调用适配器的 `resolveModel`（:739），并**严格校验返回值**：provider/id 必须与请求一致、name 非空（:634-647）、contextWindow 正整数（:648-654）、defaultMaxTokens 正整数（:658-665）、推理档位非空且 defaultEffort 必须在档位里（:675-710）。适配器说谎在此被抓住，而非把垃圾元数据发去压缩器；
- **物化默认值**：`maxTokens` 缺省且模型信息给 `defaultMaxTokens` 时补上（:740-742）；`reasoningEffort` 缺省时用模型默认档位（:754-762）；显式请求了不支持的档位抛 `UNSUPPORTED_REASONING_EFFORT`（:746-763）——"在 provider I/O 之前拒绝"（:722-723 注释）；
- **冻结与标记**：返回的 config 与模型上下文都 `deepFreeze(structuredClone(...))`（:782-785）；`adapterDefaults` 记录哪些字段是适配器补的（:786-793）——循环借此判断"持久化头里那个 effort 是适配器默认值，不能当成用户的显式选择带到下一条消息"（对照 `packages/core/agent-loop/src/agent.ts:422-426` 的逻辑）；
- **注册绑定**：`PreparedLlmCall`（:155-172）携带解析时的 `registration` 与 `config`，其 `stream()` 只许调用一次（`INVALID_PREPARED_CALL`，:800-809）且配置须与解析时一致（:804-808）。为何绑定？注释（:771-777）点破：日志（request/header）与真正 dispatch 之间隔了异步边界，不绑定则 HMR 重载可能让"一次调用的解析结果"配上"另一个适配器的流"。

**④ NO_ADAPTER 的让步**（`packages/core/agent-loop/src/agent.ts:449-455`）：`prepareCall` 允许 `NO_ADAPTER` 后降级为"用提案配置、不绑定"——`agent/request` 中间件可能服务尚未注册的路由；但"终结 dispatch 仍必须有适配器"（:452 注释）：`step()` 里 `preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)`（`packages/core/agent-loop/src/agent.ts:345`），后者在 `adapterStream` 的 `registration()` 再抛 `NO_ADAPTER` 时转成终止 failure chunk（`packages/llm/llm/src/index.ts:867-869`）。

**⑤ 冻结请求**（`packages/core/agent-loop/src/agent.ts:486-493`）：`markAgentLoopRequest(deepFreeze({...}))`——整个请求（含 `messages`）被深度冻结并打上"loop 构建"标记，审计与路由都依赖它（`llm/stream` 注释 `:56-59`）。

## 10.10 流式词汇表：电报怎么逐字到达

### ① 类比：电报机

完整回复不是一次送达：供应商把回答切成增量（delta）顺着流发来，像电报一字一字按到。收报端要"边收边拼"：知道第几行属于哪个段落、何时结束、总量多少、为何停止。harness 的统一收报语言就是 `StreamChunk`。

### ② 精确定义：StreamChunk 的七种报文

>`StreamChunk`（`packages/llm/llm/src/types.ts:291-303`）是适配器对外的唯一产出类型，七个变体：`block-start`（开一块：内容/推理/工具调用）、`text-delta`、`reasoning-delta`、`tool-call-delta`（参数以增量拼接，`id`/`name` 可后到）、`block-end`（带完整块本体）、`usage`（用量）、`finish`（终止原因，可带适配器私有的 `replayState`）。终止原因 `FinishReason`（:116-125）五种：`stop`/`tool-calls`/`max-tokens`/`aborted`（带 `LlmFailure`）/`error`（带 `LlmFailure`）。

`LlmFailure`（packages/llm/llm/src/types.ts:40-51）是可序列化的失败事实：`message`、`code`、可选 `status`/`providerRetryAfterMs`/`requestId`。**code 是跨供应商稳定的机器码**（`AUTH`、`RATE_LIMIT`、`NO_ADAPTER`……），重试策略（10.12）与 UI 显示才不依赖某家供应商的措辞。`TokenUsage`（:135-141）计数**互斥**：`inputTokens` 只算未命中缓存部分，缓存命中单独计（`cacheReadTokens`）；适配器们（如 DeepSeek）恰好相反、把缓存命中并进 prompt 总数——映射责任在适配器（10.11 节 `mapUsage`）。

### ③ 最小序列与拼装器

一次"正常的文本回答"的最小 chunk 序列：

```ts
{ type: 'block-start', index: 0, blockType: 'text' }
{ type: 'text-delta', index: 0, text: 'Hello' }
{ type: 'text-delta', index: 0, text: ' world' }
{ type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } }
{ type: 'usage', usage: { inputTokens: 12, outputTokens: 2 } }
{ type: 'finish', reason: { kind: 'stop' } }
```

消费端是 `BlockAssembler`（`packages/llm/llm/src/assembler.ts:36-163`），容错规则逐条：

- **容忍无头的流**：`text-delta` 先于 `block-start` 到达时，`ensure` 自动按增量类型开块（packages/llm/llm/src/assembler.ts:96-104）——适配器可以不发 `block-start`，只发增量；
- **容忍重复闭合**：`block-end` 之后同一 index 再来增量或再次闭合，直接忽略（:63、:69、:79）——"坏适配器不能撑爆内存或污染已完成块"（:32-34 注释）；
- **工具调用缺 id 用 `call-${index}` 兜底**（:113）；
- **`max-tokens` 截断时必须丢弃 tool-call 块**：`blocks()` 在 finish 为 max-tokens 时过滤掉所有 `tool-call` 块（:136-138）——参数残缺的工具调用不能被执行（第 11 章的哲学：失败对模型可见但不可执行）；
- **无 finish 默认 `stop`**（:147-149）；
- `usage` 取最后一个 usage chunk（:141-144）、`replayState` 随 finish 保存（:151-154），供第 8 章的 `assistant/message` 记录。

循环侧：`step()` 里每个 chunk 先 `session.append('assistant/chunk', ...)` 入日志再 `assembler.push(chunk)`（`packages/core/agent-loop/src/agent.ts:347-351`）——"先记录后消费"，保证逐条可重建（第 8 章）；流结束后 `createAssistantMessage` 用 `assembler.blocks()` 生成消息，`assistant/message` 带 `sourceEventSeqs: chunkSeqs`（`packages/core/agent-loop/src/agent.ts:373-390`），把"消息由哪些分片证据合成"钉进日志。

## 10.11 DeepSeekAdapter 走读：从快照到 SSE 到错误分类

`DeepSeekAdapter`（`packages/llm/llm-deepseek/src/adapter.ts`）是仓库里第一个真实适配器（:151-157 注释），也是"适配器契约 + 传输实现"的范本。

### ① 插件的接线（apply）

`apply`（`packages/llm/llm-deepseek/src/index.ts:200-276`）做了四件事：

1. `options` thunk：`resolveAdapterOptions(config, environment)`（packages/llm/llm-deepseek/src/index.ts:161-198）把配置校验成连接事实（baseURL、`apiKeyEnv`、默认参数、`maxTokens`、模型目录、空闲超时、重试策略），并**缓存最后一次好值**——live 设置段出现非法快照时继续服务旧配置并报错一次（:204-222）；
2. `resolveApiKey`（:225-246）：从 `ctx.get('credentials')` 凭据服务解析（`apiKeyEnv` 来自同一份连接快照，绝不错配密钥与端点），没有该服务时退回启动环境；解析不出抛 `MISSING_CREDENTIAL`（:241-245）；
3. `registerConfigurableProviders` + `registerAdapter(['deepseek-official'], adapter)`（:251-256）——`PROVIDER = 'deepseek-official'`（:47）；
4. **重试策略的 live 更新**：`ensureRegistrationFacts` 比较 `options().retryPolicy` 与注册时固化的策略，不同则 `registration.replace([PROVIDER])`（:258-268）——注释（:261-265）说明为何不用"dispose + 重新注册"：那会中间播发"路由消失"空档，`replace` 同步无间隙。

### ② 连接快照：一次流 = 一次冻结

`stream`（`packages/llm/llm-deepseek/src/adapter.ts:214-269`）第一件事就是三个快照（:220-222）：`connection = this.config.options()`、`apiKey = await resolveApiKey(connection)`、`userId = resolveUserId()`。注释（:215-219）点明设计意图：**端点在途的流永远不会观察到配置变更**，下一次调用重新解析；密钥从同一份快照解析，所以"这一代的 URL 配上那一代的密钥"不可能发生。

信号合并：`AbortSignal.any([options.signal, consumer.signal])`（packages/llm/llm-deepseek/src/adapter.ts:224-226）——调用方中止与"消费方停止消费"（finally 里的 `consumer.abort`，:260）都能终止上游。空闲看门狗 `idleWatchdog`（:227）在**单次读等待超过 `streamIdleTimeoutMs`（默认 300s，:89）**时触发。读取循环（:239-245）用 `watchdog.next(iterator)` 驱动，读一次、脉冲一次（:234、:239）。

错误分类在 catch 里按优先级（packages/llm/llm-deepseek/src/adapter.ts:246-258）：看门狗触发 → `TIMEOUT`；调用方 signal 已中止 → `ABORTED`；本就是 `LlmError` → 原样上抛；其余 → 包成 `TRANSPORT`（带 `cause`）。

### ③ 请求构造与线上协议映射

`request`（packages/llm/llm-deepseek/src/adapter.ts:271-345）：`serializeRequest(options, connection.defaults)` 把 harness 消息翻译为 DeepSeek chat-completions wire 消息（harness 的工具结果以 user 角色承载，wire 里要拆成 `role:'tool'` 消息，`packages/llm/llm-deepseek/src/serialize.ts:124-129` 注释）；`JSON.stringify` 在 try 外（:279-282）——序列化失败不是传输故障，不贴 `TRANSPORT` 标签。请求头（:283-295）：`Authorization: Bearer <key>`、`x-deepseek-harness-user-id`、可选 `x-deepseek-harness-session-id` 与压缩标记 `x-deepseek-harness-compact: 1`（`purpose === 'compaction'` 时，第 14 章用），以及 `attributionHeaders()`（契约要求每个请求都带，`:176-178`）。

`fetch` 失败（DNS、拒连、TLS、代理）包 `TRANSPORT` 并链 `cause`（packages/llm/llm-deepseek/src/adapter.ts:307-319）；**非 2xx**（:321-339）解析 body 取供应商错误信息，解析失败不掩盖 HTTP 状态（:328-331），`retry-after` 头换算成 `providerRetryAfterMs`（:117-125，支持秒数与 HTTP-date），`x-request-id`/`x-deepseek-request-id` 变 `requestId`（:127-130）。状态码映射 `httpErrorCode`（:138-149）：

| 情形 | code |
|---|---|
| 401 / 403 | `AUTH` |
| 配额耗尽（错误详情匹配） | `QUOTA_EXCEEDED` |
| 429 | `RATE_LIMIT` |
| 400 + 上下文超窗详情 | `CONTEXT_WINDOW_EXCEEDED` |
| 400 其他 | `INVALID_REQUEST` |
| ≥500 | `SERVER` |
| 其余 | `HTTP_<status>` |

无响应体抛 `EMPTY_RESPONSE`（packages/llm/llm-deepseek/src/adapter.ts:340-342）。

### ④ SSE 解码与翻译

`parseSse`（`packages/llm/llm-deepseek/src/sse.ts:28-40`）：`TextDecoderStream` + `EventSourceParserStream` 处理帧（跨块重组、UTF-8/CRLF/BOM/注释/多 `data:` 行拼接），**字面量 `[DONE]` 也作为数据交出**（:18 注释），由调用方决定何时收尾；流在 `[DONE]` 前 EOF 抛 `STREAM_CLOSED`（:39 注释）——截断的响应不可信。

`translate`（`packages/llm/llm-deepseek/src/translate.ts:86-185`）是"wire 增量 → StreamChunk"的状态机，四个要点：

- **空字符串的 reasoning 增量不开块**（packages/llm/llm-deepseek/src/adapter.ts:133-140）：thinking 模式首帧常发空的 `reasoning_content`，开了块会留下空的 reasoning 块；
- **`block-end`、`usage`、`finish` 全部延迟到 `[DONE]`**（:102-117）：理由写在注释（:3-5、:82）里——usage 可能挂在 finish 块上，也可能作为末尾独立的 usage-only 块到达，延迟到哨兵统一收尾，还能保证"finish 之后没有任何 chunk"（:4-5 注释）；
- **`[DONE]` 时一个块都没开过**：视为退化完成，产出 `EMPTY_RESPONSE` 的 error finish（:110-115），而非"成功的空消息"；
- 非法 JSON 载荷抛 `MALFORMED_RESPONSE`（:120-125）。

`mapFinishReason`（packages/llm/llm-deepseek/src/adapter.ts:31-43）：`stop`→`{kind:'stop'}`、`tool_calls`→`{kind:'tool-calls'}`、`length`→`{kind:'max-tokens'}`，未知值（如 `content_filter`）→ error + 大写 code——**新供应商原因不静默丢失**。`mapUsage`（:53-62）：DeepSeek 的 `prompt_tokens` 含缓存命中（`prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`），按互斥约定把缓存读减出去（:54-57）。

**真实调用示例**（未验证：需要 `DEEPSEEK_API_KEY` 与网络；端点行为以官方文档为准）：

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","stream":true,\
       "messages":[{"role":"user","content":"ping"}]}'
```

### ⑤ `resolveModel` 的诚实性

最后看元数据（packages/llm/llm-deepseek/src/adapter.ts:175-212）：目录条目给出 `contextWindow`/`maxTokens`，未收录模型名回退到 `defaultContextWindow`/`connection.maxTokens`（:182-193），**且未收录模型也声明 `inputModalities: ['text']`**——注释（:185-190）解释：wire 路由就是纯文本，若返回"未知能力"，宿主会接受并持久化图片而序列化器随后必然拒绝；负能力的静默与显式是两回事。`thinking: 'disabled'` 时推理档位只有 `off`（:194-200），与 `resolveAdapterOptions` 的校验（`packages/llm/llm/src/index.ts:162-166`：禁用 thinking 时只许配 `off`）呼应。

## 10.12 流水线上的两个邻居：llm-retry 与 token-meter

### ① llm-retry：不包裹流，而是挂在恢复事件上

重试策略的正确打开方式是 `packages/llm/llm-retry/README.zh.md:5` 第一句：**"它不包装 `ctx.llm.stream()`：每次适配器调用仍是一次提供方尝试，每次重试都会开启新的编号轮次。"** 这决定了挂载点：`agent/request-error` waterfall（第 9 章 `step()` 失败触发，`packages/core/agent-loop/src/agent.ts:354-370`），而非某层中间件包住流。

`apply`（`packages/llm/llm-retry/src/index.ts:99-226`）逻辑读一遍：

- `recover`（packages/llm/llm-retry/src/index.ts:156-208）收到失败载荷后：策略为 `undefined` 直接委托下游（:160）；`always` 模式**先问下游恢复**，下游失败仅记警告（:161-176，"waterfall 顺序组合" packages/llm/token-meter/README.zh.md:52）；normal 模式先查 `failure.code` 是否在 `retryableCodes`（:177-178，默认含 `EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`，`packages/llm/llm/src/retry-policy.ts:18-24`；默认两次、500ms→10s、10% jitter，packages/llm/token-meter/README.zh.md:7）；
- **重试预算从会话日志恢复**：`findLast` 在 `agent.session.events` 里找同 turn/step/provider/**策略键**的 `llm/retry` 事件（:181-190）。策略键（`retryPolicyKey` :65-76）序列化所有影响行为的字段，normal 还排序 code——"换过策略就换历史"（packages/llm/token-meter/README.zh.md:11）；
- **持久先行**：等待前先追加 `llm/retry` 事件（含 `retryId`、计划延迟、失败载荷，:126-152），`cancellableDelay` 等完再追加 `llm/retry-started` 并返回 `{kind:'retry'}`（:150-153）；`step()` 收到 retry 后 `continue` 重开本轮（`packages/core/agent-loop/src/agent.ts:367-370`）。为何先持久化？重试是**带延迟的异步决策**，崩溃后要从日志知道"上次重试到哪里"；
- 供应商要求的 `providerRetryAfterMs`：不超过 `maxDelayMs` 时用它代替本地退避且不加抖动；超上限时 normal 放弃、always 用本地退避（:194-205，packages/llm/token-meter/README.zh.md:9）；
- 退避（`localDelay` :58-63）：有界指数 + 对称 jitter，指数上限 1024 防溢出；
- **取消与 dispose**：`AbortSignal.any([signal, lifetime.signal])`（:124），dispose 时中止 lifetime 并 `Promise.allSettled(active)` 排空（:221-225）——"不杀掉正在结算的重试"；
- 配置纪律（:32-35）：`llm-retry` 自己**没有**配置，`retryPolicy` 必须写在每个提供方下面，写错位置直接抛错（packages/llm/token-meter/README.zh.md:29）。这也是 10.8 节"策略随注册固化"的由来：策略属于路由，不属于重试器。

### ② token-meter：只计价、不决策

`TokenMeter`（`packages/llm/token-meter/src/index.ts:74）是"每会话重放式"的用量估算服务：`measure()`（:116-147）同步会话折叠，在"最新成功调用的规范请求 envelope 与记录匹配"时复用提供方真实用量作锚（packages/llm/token-meter/README.zh.md:20），否则用固定启发式：**4 字符≈1 token**（`packages/llm/token-meter/src/estimate.ts:13`）加角色/块/请求头结构开销（`packages/llm/token-meter/src/estimate.ts:16-19`；packages/llm/token-meter/README.zh.md:9、:34 明说"CJK 文本与 JSON schema 会被严重低估"）。它**没有任何配置项**——任何配置键都被拒绝（`packages/llm/token-meter/src/index.ts:60-64`），因为模型容量属于适配器（`ctx.llm.resolveModelInfo()`），估算器不做门控（packages/llm/token-meter/README.zh.md:9、:42："harness 中没有任何环节依据它做决策，压缩改为直接读取 `measure()`"）。

它把三个投影注册进可选会话投影 seam（`packages/llm/token-meter/src/index.ts:87-91`）：`tokenUsage`、`contextPressure`、`contextBreakdown`（packages/llm/token-meter/README.zh.md:24-36）。`contextBreakdown` 明细是**组成**展示，加起来不等于 `projectedTokens`——后者锚定提供方读数（packages/llm/token-meter/README.zh.md:34）。一句话定位：**给 UI 看的近似仪表盘，不是计费单，也不是闸门**；真正需要"下一条请求多少 token"的压缩器（第 14 章）直接调 `measure()`。

## 10.13 本章小结

1. **提示词是拼的**：`SystemPrompt` 收集各插件的段/上下文/工具/变量，按 `order` 升序拼接、插值成文本；段有身份（-100）、persona（0）、工具（100-199）的顺序约定，`complete` 段在瀑布后强制独占（`packages/core/system-prompt/src/index.ts:53-75`、`:467-542`）。
2. **注册四类容器两种语义**：名唯一的段/上下文/变量，与匿名多提供方的工具/抑制标记；scoped 注册遮蔽全局同名者；工具与变量的提供方每次组装重新求值（`:430-455`）。
3. **插值严格、渲染兜底**：变量名合法、必须注册、值非空，否则组装期抛错；裸 `{{` 当散文；渲染丢弃空段、`\n\n` 连接（`:212-217`、`:258-295`）。
4. **工具进请求的路径**：`wireSchemas` 提供方 → assemble 收集（`structuredClone` 参数）→ `orderTools` 排序/校验 → `request.tools` → wire `tools`（`packages/core/tools/src/index.ts:832`、`system-prompt` `:164-178`、`packages/core/agent-loop/src/agent.ts:458-493`）。
5. **适配器是可替换的插座**：`LlmAdapter` 唯一必须实现 `stream()`；注册 all-or-nothing（`INVALID_ADAPTER`/`DUPLICATE_ADAPTER`），`replace` 单同步段无间隙（`REGISTRATION_DISPOSED` 防泄漏）；`prepareCall` 解析元数据、物化默认值、绑定注册、冻结请求（`packages/llm/llm/src/index.ts:338-413`、`:779-814`）。
6. **流是统一词汇**：七种 `StreamChunk`、五种 `FinishReason`、互斥的 `TokenUsage`；`BlockAssembler` 容忍无头/重复闭合/截断丢弃工具调用（`packages/llm/llm/src/types.ts:291-303`、`packages/llm/llm/src/assembler.ts:47-163`）。
7. **真实适配器的纪律**：一次流一次快照、单一信号源、看门狗 300s、错误分类表、`[DONE]` 前 EOF 不可信、空响应是错误不是成功（`packages/llm/llm-deepseek/src/adapter.ts:214-345`、`packages/llm/llm-deepseek/src/translate.ts:86-185`）。
8. **重试与计量都不碰流**：llm-retry 挂在 `agent/request-error` 上、以 `llm/retry` 事件为持久重试预算；token-meter 只做启发式展示，非门控（`packages/llm/llm-retry/README.zh.md:5`、`packages/llm/token-meter/README.zh.md:9`）。

## 10.14 分层练习

**理解层**
1. 不看源码说出 order 约定：harness 身份、persona、工具指引各用什么阶？为什么 `deployment:persona` 常量会被导出（提示：遮蔽语义）？
2. 一个 `complete` 段注册后，插件监听 `system-prompt/assemble` 能否往提示词里加一段？为什么？（对照 `packages/llm/token-meter/README.zh.md:24-26` 注释与 `:536-541`。）

**应用层**
3. 写出用 `renderPrompt` 渲染 `{name:'a', text:'{{x}}'}` 且 variables 为 `{x: undefined}` 的结果，并说明抛错发生在哪一行、错误消息大致内容。
4. 用日志或单测（离线路径：直接构造 `SystemPrompt` 并 `assemble()`，不发起任何模型调用）验证：注册一个 order 为 5 的 section 后，渲染结果位于 persona 段之后、工具段之前；然后同一名字再注册一次，记录抛出的错误文本。注意：本地未构建运行，此练习表述的期望行为来自源码走读（未实测）。

**综合层**
5. 写一个"把 baseURL 指向自建网关"的最小适配器方案：复刻 `llm-deepseek` 的 `apply` 接线（options thunk + `resolveApiKey` + `registerAdapter`），把 `retryPolicy` 配置为 `mode: 'always'`，并论证为什么换 baseURL 不需要 `registration.replace()`，而换 retryPolicy 需要（对照 `packages/llm/llm-deepseek/src/index.ts:204-268`）。
6. 工具 schema 的 `parameters` 在 assemble 里被 `structuredClone`，试论证：若不做克隆，哪个环节可能篡改注册表的原件？（提示：`llm/stream` 瀑布的载荷含 `request.tools`（已 `deepFreeze`）；`agent/request` 瀑布只见 `LlmCallConfig`——provider/model/maxTokens 等，**没有** tools 字段。）

**挑战层**
7. 设计一个"persona 每次组装从文件读取并缓存失效"的插件：说明你会把"读文件"放在 `section().text` 的函数里还是 `variable()` 里、缓存键是什么、如何让 HMR 换掉文件内容后下一次组装就生效——用 `assemble` 每次重新求值（`text` 函数见 packages/core/system-prompt/src/index.ts:510-518，`variable()` 提供方见 :473-483）与 `options()` thunk 缓存（`packages/llm/llm-deepseek/src/index.ts:204-222`）两种现成机制对照论证。

## 10.15 延伸阅读

- `docs/subsystems/system-prompt.zh.md`：系统提示词子系统的官方说明（`AssembleContext`、`ToolProviderResult`、段落/上下文/事件）。
- `docs/subsystems/llm-streaming.zh.md`：流式词汇表的官方定义（Message/ContentBlock/StreamChunk 三层）。
- `packages/llm/README.zh.md`：llm 包的路由、适配器与错误分类总览。
- `packages/llm/llm-retry/README.zh.md`：重试语义的权威表述（"agent 轮次是唯一重试边界"、always 模式的成本警示）。
- `packages/llm/token-meter/README.zh.md`：估算器定位——"近似仪表盘，非计费、非门控"。
- `examples/headless-agent/cordis.yml`：本章引用的接线示例（llm-deepseek 入口、persona 配置）。
- DeepSeek 官方 chat completions 文档（`api.deepseek.com`）：wire 协议与 `[DONE]` 约定的权威来源。
