# DeepSeek Harness 源码教程

**插件式 Agent 运行时的架构、机制与源码走读**

| 项目 | 内容 |
|---|---|
| 教程对象 | DeepSeek Harness（`dsh`）源码仓库 |
| 源码版本 | `v0.1.0-rc.5`（MIT License），提交 `47f943859bef60e4160492346772ded9b24f765a`（2026-08-13，merge PR #2519） |
| 底层框架 | 仓库内 vendored `@deepseek-ai/cordis` v4.0.1（上游 cordis `4.0.0-rc.7` 快照，commit `56b3d4f` + 18 条本地修改） |
| 教程生成日期 | 2026-08-26（正文 08-25 完成，习题解答 08-26 合入） |
| 编写者 | PenguinHarness（源码教程代理） |
| 篇幅 | 正文 17 章 + 附录（术语表 / API 与配置速查 / 源码文件清单与参考文献）+ 习题解答 `answers.md` |

> 所有技术陈述均以教程写作时对源码的逐行阅读为准，并标注 `文件路径:行号`。凡未在源码或官方文档中证实的表述均明确标注"（推断）"或"（未验证）"。

---

## 1. 这本书写给谁

面向**想真正读懂 dsh 而不是只会用它的读者**：本科高年级学生、研究生、希望二次开发或研究 Agent 运行时的工程师。

**先修知识**（本书默认你已掌握，不再展开讲解）：
- TypeScript：类型、泛型、类与继承、装饰器（仅需了解）；
- Node.js：进程、事件循环、模块系统；
- LLM Agent 基本概念：消息（message）、工具调用（tool call）、流式输出（streaming）。

**学完你将能够**：
- 说清 `dsh` 从一条命令到一棵插件树、再到一次模型轮次与一个工具执行的完整链路；
- 独立写出一个可挂载、可测试、可替换的插件（工具 / 提供方 / 服务）；
- 用一层补丁（patch）替换产品的任何一部分：文件系统、沙箱、模型提供方、Web 传输……
- 读懂会话日志、提示词组装、执行流水线这些"看不出门道"的内部机制。

## 2. 学习路线

书按知识依赖顺序推进，建议顺序阅读；有基础者可跳过加粗标注的章节。

```
第1章 全景（预览，不深究）
   │
   ├─→ 第2章 Context与Service ─→ 第3章 插件与Effect/Fiber ─→ 第4章 事件系统五模式 ─→ 第5章 cordis.yml与Loader
   │                                                                                    │
   └──────────────────────────────────── 第6章 Profile组装（复用 2–5 全部概念，补丁栈总图）
                                                   │
                     ┌─────────────────────────────┴───────────────────────────┐
                     │                                                          │
               第7章 组合包与内置bundle                              第8章 会话日志事件流（"模型可见即已记录"）
                     │                                                          │
                     │            ┌─────────────────────────────────────────────┘
                     │            │
                     │     第9章 Agent Loop：一次轮次的一生
                     │            │
                     │     第10章 提示词组装与LLM适配器
                     │            │
                     │     第11章 工具系统与执行流水线
                     │            │
                     │     第12章 能力Seam全景（fs/shell/subprocess/terminal/sandbox/lsp/code-runtime/web）
                     │            │
                     │     第13章 多智能体与任务组织（subagent/skill/jobs/workflow）
                     │            │
                     │     第14章 长程会话治理（compaction/plan/todo/context/guard）
                     │            │
                     └───────────► 第15章 持久化与设置
                                    第16章 Web与远程协议（浏览器/宿主/SDK/ACP）
                                    第17章 扩展实战（可编程扩展点 + 从0到1插件项目）
附录A 术语表 / 附录B API与配置速查 / 附录C 源码文件清单与参考文献 / answers.md 习题解答
```

**为什么这样排**：
- 第 8 章（会话日志）必须先于第 9/10 章——模型历史来自会话日志投影（`deriveMessages`），"模型可见即已记录"是轮次读历史的前提；
- 第 9 章（Agent Loop）先于第 11 章（工具）——工具调用由循环发起；
- 第 11 章先于第 12 章（能力 Seam）——seam 的消费方是工具；
- 第 12 章先于第 13 章（多智能体）——进程外子代理依赖 subprocess/agent 注册表；
- 第 14/15 章先于第 16 章（Web）——宿主与浏览器共享会话事件流与持久化后端。

## 3. 目录

- **第 1 章　从一条命令到一棵插件树：dsh 全景**
- **第 2 章　Context 与 Service：Cordis 的依赖容器**
- **第 3 章　插件与可逆副作用：Fiber 状态机与 effect**
- **第 4 章　事件即扩展点：五种分发模式与 dsh 的真实事件**
- **第 5 章　cordis.yml 与 Loader：配置文件如何变成插件实例**
- **第 6 章　Profile 组装：从 `dsh` 命令到插件树**
- **第 7 章　组合包与内置 bundle：base / headless / web-app**
- **第 8 章　会话日志：仅追加事件流与"模型可见即已记录"**
- **第 9 章　Agent Loop：一次轮次的一生**
- **第 10 章　提示词组装与 LLM 适配器**
- **第 11 章　工具系统与执行流水线**
- **第 12 章　能力 Seam 全景：三种角色一种思想**
- **第 13 章　多智能体与任务组织：subagent、skill、jobs、workflow**
- **第 14 章　长程会话治理：compaction、plan-mode、todo、context 与 guard**
- **第 15 章　持久化与设置：session 落盘、settings、credentials、workspace**
- **第 16 章　Web 与远程协议：浏览器、宿主、SDK 与 ACP**
- **第 17 章　扩展实战：从 0 到 1 编写一个自己的插件**
- **附录 A　术语表（中英对照）**（`appendix-a-glossary.md`）
- **附录 B　API 与配置速查**（`appendix-b-api-config.md`）
- **附录 C　源码文件清单与参考文献**（`appendix-c-source.md`）

（各章正文见 `chapters/`；习题解答见 `answers.md`。）

## 4. 阅读约定

1. **引用格式**：正文中源码引用以 `包路径:行号` 为主，如 `packages/core/agent-loop/src/agent.ts:246-330`。同一段落（或同一表格行）内，首个引用给出完整仓库路径，此后指代同一文件可省略路径，写作 `文件名:行号` 或仅 `:行号`（如"`SessionStore.flush` 的 `:1026-1035`"）。行号对应教程写作时的仓库状态（见上方提交号）；升级仓库后行号可能漂移，但函数名/事件名不变。
2. **术语**：首次出现给中英对照（如"上下文（Context）"）；Cordis 专有名词（fiber、epoch、isolate、waterfall、serial、bail、effect 等）保持英文，首次出现给出中文解释。全书中英对照汇总见附录 A。
3. **诚实性标注**：`（推断）`＝由相邻代码/文档合理推论但未直接证实；`（未验证）`＝依赖真实模型调用、真实网络或需要构建运行才能验证，当前环境未具备条件。这两类内容不影响对源码机制的阅读。
4. **先讲后用**：每个概念首次出现，正文都会先给直觉类比、再给精确定义、最后给最小示例；此后出现则简引"见 N.M"。若读到陌生术语，往前翻一章大概率能找到它的首次讲解。
5. **章节依赖**：每章开头标注前置章节；跳读时请先确认前置已读。

## 5. 配套资源

- 源码仓库：`C:/Users/yq/Desktop/develop/deepseek-harness`（教程写作时以 `git rev-parse HEAD` 为准，见上方提交号）。
- 官方文档（仓库内）：`README.zh.md`、`docs/architecture.zh.md`、`docs/capability-seams.zh.md`、`docs/tool-execution-pipeline.zh.md`、`docs/cordis-primer.zh.md`、`docs/cordis-tutorial/`、`apps/cli/reference/README.md` 等。
- 运行示例：`examples/headless-agent/`（含 `cordis.yml` 与 README）。
