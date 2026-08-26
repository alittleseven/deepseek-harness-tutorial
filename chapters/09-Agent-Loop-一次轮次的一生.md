# 第 9 章　Agent Loop：一次轮次的一生

> **本章学习目标**（读完本章，你应该能够）：
> 1. 画出 `ReactLoopAgent` 的相位状态机（idle / maintenance / running），说出每条迁移由谁触发、`maintenance` 期对外表现为哪种状态；
> 2. 按顺序写出一次"领取输入 → 模型调用 → 工具执行"轮次的完整事件序列，并指出每个事件由哪段代码写出（精确到 `packages/core/agent-loop/src/agent.ts` 行号）；
> 3. 解释收件箱（inbox）为何是"持久事件流的增量投影"，以及"注入内容留在 inbox 直到被领取"引出的三种结局（进 step、被拒绝、被取消）；
> 4. 说明 pre-step 拒绝与空改写为何也会关闭持久轮次，却不一定花一次模型调用；
> 5. 划清 agent/* 事件域与 session 事件域的边界，指出"模型可见内容必须走日志通道"在本章的至少两处体现。
>
> **本章讲法**：算法与状态机型。第 8 章回答"日志里写什么、怎么读"，本章回答"谁在跑"：一次轮次从哪一刻开始、被推过哪些边界、又以哪几种方式结束。我们不按类的定义顺序讲，而是先给一份与实现逐行对得上的轮次生命周期伪代码（9.2），再把伪代码一行一行映射回源码（9.3–9.12），最后用一个自观察探针插件收束（9.13）。**前置**：第 4 章（waterfall / serial / emit 三种分发模式）；第 8 章（会话事件词汇、`surfaceOp`、"模型可见即已记录"规则）。

## 9.1 控制面与数据面

先建直觉（① 类比）。餐厅里有两套系统：**后厨按点菜单做菜**，菜单上写什么，菜就长什么样；**领班决定什么时候下单、催菜、结账**——他不在菜单上写字，只在动作层面驱动。第 8 章的会话日志就是点菜单（数据面），本章的 Agent Loop 就是领班（控制面）。

再精确定义（②）。dsh 把两者严格分开：

> **数据面（data plane）**：`Session` 会话日志与从它投影出的消息历史。其词汇（`turn/start`、`user/message`、`assistant/*`、`tool/*`、`request/*`…）与"模型可见即已记录"规则见 8.2、8.4；写入闸门见 8.3、8.6。
>
> **控制面（control plane）**：一个**驱动器（driver）**——`ReactLoopAgent`（`packages/core/agent-loop/src/agent.ts:64`，注释 "Drives one session through turn and step boundaries."）。它调用 `Session.append` 写数据面事件，同时通过 `agent/*` 事件对外直播自己的活（见 9.3–9.12）。

控制面先认识四个术语（后文各节展开，此处只给定义）：
- **driver（驱动器）**：跑着 `kick()` 的那个异步任务，把一个个轮次从起点运到终点（9.8）。
- **phase（相位）**：驱动器此刻所处的状态，三选一：`idle`（待机）/ `maintenance`（维护）/ `running`（运行）（9.3）。
- **inbox（收件箱）**：待领取的输入消息，分 `next-turn` 与 `next-step` 两格（9.5）。
- **wake（唤醒）**：投递消息后"按门铃"的动作，让空闲的驱动器开工（9.6）。

最小示例（③）：控制面的全部可见行为，可以浓缩成对着一行 API 观察日志的变化——下面两行就是本章最小示例的骨架，9.2 起逐行展开：

```ts
agent.send(message, 'next-turn', true)    // 前门投递 + 唤醒
// 之后日志里必然出现一对边界事件（成对性见 9.12）：
//   turn/start { turn: 1 }  →  …  →  turn/end { turn: 1, reason: 'completed' }
```

## 9.2 全景：一次轮次的伪代码与事件序

### 9.2.1 轮次生命周期伪代码

以下伪代码与 `packages/core/agent-loop/src/agent.ts` 的 `kick` / `turn` / `preStep` / `step` / `buildRequest` 一一对应，括号内是真实行号。**先看懂它，再逐段读源码**。记号：`append(type, data)` 表示 `session.append`（见 8.3），`waterfall`/`serial` 是第 4 章的分发模式。

```
async def kick():                              # agent.ts:210-223
    while await turn(): pass                   # 上一轮尾部还有待领输入时续跑（⑪）
    收尾：若"锁存唤醒"且 inbox 有货，再 wakeDriver()（换挡，9.6）

async def turn() -> bool:                      # agent.ts:246-330
    turn = phase.turn + 1
    append('turn/start', { turn })             # ① 开轮边界先落账
    turnEnds = null; target = 'next-turn'
    loop:
        step = phase.step + 1
        decision = preStep(target, {turn, step})        # ② 领取+组装+改写（9.7）
        if decision == reject:                         # ③ pre-step 拒绝
            turnEnds = {kind:'blocked'}; return false
        if turnEnds != null and decision.messages == []: break   # ④ 轮已结且无新消息
        if phase.step == 0 and decision.messages == []:  # ⑤ 首步空改写
            turnEnds = {kind:'completed'}; return false        #    关轮但不花模型调用
        append('step/start', {turn, step}); phase.step = step
        for msg in decision.messages: append('user/message', msg, surfaceOp='append')  # ⑤'
        stepEnd = step(assembly)               # ⑥ 一次或多次模型请求（9.9）
        finally: append('step/end', {turn, step})          #    必写
        if turnEnds == null or turnEnds.kind != 'max-tokens': turnEnds = stepEnd   # ⑦ 粘性
        if turnEnds != null and inbox.nextStep == []:
            await serial('agent/turn-stopping')            # ⑧ 关门前的最后发言机会
        if turnEnds != null and inbox.nextStep == []: break
        target = 'next-step'                   # ⑨ 之后的步骤改领 next-step
    catch: 见 9.12（aborted / error 两种结局）
    finally: append('turn/end', {turn, reason: turnEnds})   # ⑩ 必然关闭
    if inbox 还有货: 换新 AbortController；清锁存；step=0；return true   # ⑪ 尾部续跑
    return false

async def step(assembly) -> StepEndReason | null:   # agent.ts:332-401
    loop:
        request = buildRequest(...)            # 从日志推导请求（9.10）
        stream = preparedCall?.stream ?? ctx.llm.stream(request)
        for chunk in stream: append('assistant/chunk', {chunk})   # 逐 token 落账
        if finish 是 error/aborted:
            action = waterfall('agent/request-error')
            if action != retry: throw LlmError(...)   # retry 则 continue
        append('assistant/message', {message, sourceEventSeqs: chunkSeqs})
        if finish == max-tokens: return {kind:'max-tokens'}
        if 无工具调用: return {kind:'completed'}
        concluded = executeToolCalls(...)      # 9.11
        return concluded ? {kind:'completed'} : null   # null ⇒ 继续循环
```

两点预告：`⑦` 中 `stepEnd` 为 null（有工具调用且未定论）时，`turnEnds` 保持原值——null 不覆盖已定的结局；`⑩` 的 `turnEnds!` 非空断言所以成立，是因为 catch 与主体三条路径都赋过值（9.12 列全）。

### 9.2.2 一次轮次的事件序（有工具调用、正常完成）

| # | 事件 | 写出者（代码位置） | 一句话说明 |
|---|---|---|---|
| 1 | `turn/start` | turn 主体（`packages/core/agent-loop/src/agent.ts:255`） | 开轮边界，先落账 |
| 2 | `step/start` | turn 主体（`packages/core/agent-loop/src/agent.ts:279`） | 打开第一个 step |
| 3 | `user/message` ×n | turn 主体（`packages/core/agent-loop/src/agent.ts:282-284`） | 领取的消息进模型可见面 |
| 4 | `request/header` | buildRequest（`packages/core/agent-loop/src/agent.ts:466`） | 请求配置快照（initial/resume/change） |
| 5 | `request/context` | buildRequest（`packages/core/agent-loop/src/agent.ts:482`） | 提供方/模型/窗口（变了才记） |
| 6 | `assistant/chunk` ×n | step（`packages/core/agent-loop/src/agent.ts:349`） | 逐 token 流式原样入账 |
| 7 | `assistant/message` | step（`packages/core/agent-loop/src/agent.ts:381-390`） | 组装结果，`sourceEventSeqs`=chunkSeqs |
| 8 | `tool/call` ×n | tool-calls（`packages/core/agent-loop/src/tool-calls.ts:167`） | 模型发起的调用 |
| 9 | `tool/result` ×n | tool-calls（`packages/core/agent-loop/src/tool-calls.ts:281-288`） | 按模型序回填，`sourceEventSeqs:[callSeq]` |
| 10 | `step/end` | turn 的 finally（`packages/core/agent-loop/src/agent.ts:292`） | 关闭 step（即使出错） |
| 11 | `turn/end` | turn 的 finally（`packages/core/agent-loop/src/agent.ts:319`） | 关闭轮次，带 reason |

途中可能夹着 `agent/inbox/spliced`（收件箱的每次增删都写自己的持久事件，9.5）。而 `agent/status`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`agent/error`、`agent/inbox/*` **都不进日志**——它们属于"进程内直播"频道（9.4 讲边界，9.2.2 表里的行号把 1–11 与 9.3–9.12 的走读串起来；取消/失败路径的事件形状见 9.12）。

## 9.3 相位机：idle / maintenance / running

### 9.3.1 相位定义

（① 类比）电梯有三种状态：待机（轿厢停在某层）、维护（检修工人在里面，乘客进不去）、运行（轿厢在动）。"维护中"对外就是"不可用"，但维护与运行是两码事。

（② 精确定义）`Phase` 是驱动器内部状态的联合类型（`packages/core/agent-loop/src/agent.ts:38-46`）：

```ts
type Phase =
  | { kind: 'idle'; lastTurn: number }                       // 待机：无活动
  | { kind: 'maintenance'; abort: AbortController            // 维护：非轮次任务占位
      lastTurn: number; wakeRequested: boolean }
  | { kind: 'running'; abort: AbortController                // 运行：驱动中
      turn: number; step: number; wakeRequested: boolean }
```

每个字段都有用途：`abort` 是当前活动的取消信号（`runMaintenance` 与 `wakeDriver` 各建一个 `AbortController`，见 packages/core/agent-loop/src/agent.ts:148、:187）；`turn`/`step` 记录"推进到哪了"；`wakeRequested` 是**锁存（latch）**位——唤醒发生在驱动器无暇它顾时，先记下"有人按过门铃"，等当前活动收敛（convergence）再重放（9.6）。

（③ 最小示例）对外状态只有两个（`AgentStatus = 'idle' | 'running'`，`packages/core/agent/src/runtime-types.ts:50`），因为维护期对外表现为闲置：

```ts
get status(): AgentStatus {           // agent.ts:99-101
  return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
}
```

### 9.3.2 迁移表

| 迁移 | 触发者 | 代码 | 对外可见（`agent/status`） |
|---|---|---|---|
| idle → running | `wakeDriver`（消息唤醒） | `packages/core/agent-loop/src/agent.ts:183-192` | idle → **running** |
| idle → maintenance | `runMaintenance` | `packages/core/agent-loop/src/agent.ts:145-152` | 不变（对外仍 idle） |
| running → idle | `kick` 的 finally | `packages/core/agent-loop/src/agent.ts:217-219` | running → **idle** |
| maintenance → idle | `runMaintenance` 的 finally | `packages/core/agent-loop/src/agent.ts:156-157` | 不变（对外仍 idle） |

`setPhase`（packages/core/agent-loop/src/agent.ts:104-111）只在外观状态翻转时才发一次 `agent/status`：

```ts
private setPhase(next: Phase): void {
  const previousStatus = this.status
  this.phase = next
  const status = this.status
  if (status !== previousStatus) this.dispatch.emit('agent/status', { status })   // :108-110
}
```

三个细节：① 每次进入 running 都新建 `AbortController`（packages/core/agent-loop/src/agent.ts:187），`cancel` 只作用于**当前**活动的信号——上一轮的取消不会泄漏到下一轮（`packages/core/agent/src/runtime-types.ts:78-85`："the first cause wins for that activity"）；② `wakeDriver` 新建 running 时把 `lastTurn` 拷贝为起始 turn（:188），`runMaintenance` 同理（:149）；③ 若 `kick` 的 finally 发现"锁存唤醒 + inbox 有货"，会**立即再次进入 running**（:220）——这不是"回 idle 再出发"，而是换挡续跑（9.6.2）。

## 9.4 前门：send、followup、steer、inject 与 cancel

Agent 接口对外暴露五个控制方法。先看语义规格（接口注释即规范），再看实现。

### 9.4.1 语义规格

| 方法 | 目标格 | 唤醒 | 语义（接口注释摘要，`packages/core/agent/src/runtime-types.ts`） |
|---|---|---|---|
| `send(message, target, wakeup)` | 调用者指定 | 调用者指定 | 底层原语：路由到收件箱边界并可选唤醒（packages/core/agent/src/runtime-types.ts:106-117） |
| `followup(message)` | `next-turn` | 是 | 普通后续轮；该消息成为自己那一轮的唯一普通消息（packages/core/agent/src/runtime-types.ts:119-124） |
| `steer(message)` | `next-step` | 是 | 就近步骤的转向；空闲则开新轮，运行中在下个 step 边界被消费（packages/core/agent/src/runtime-types.ts:126-133） |
| `inject(message)` | `next-step` | 否 | 面向模型的上文注入；空闲时停在 inbox，直到被唤醒或领取（packages/core/agent/src/runtime-types.ts:135-143） |
| `cancel(cause, {keepInbox}?)` | — | — | 清空队列并中止当前活动；首个 cause 获胜（packages/core/agent/src/runtime-types.ts:78-85） |

一句话差异：**followup 开新轮，steer 只是"转向"，inject 只是"塞资料"**。三者进同一个收件箱，只是格子与敲门方式不同（9.5）。

### 9.4.2 实现走读

`send` 是唯一实现，其余三个是一行转发（`packages/core/agent-loop/src/agent.ts:113-132`）：

```ts
send(message, target, wakeup) {
  // Waking input cannot join an aborted activity, so it starts the next turn.
  // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
  const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted  // :116
  const resolvedTarget = wakingAfterAbort ? 'next-turn' : target                                    // :117
  this.inbox.splice(resolvedTarget, Infinity, 0, [message])                                         // :118
  if (wakeup) this.wakeDriver(wakingAfterAbort)                                                     // :119
}
```

两个值得写下来的细节：

1. **取消后的唤醒消息不能"混进"正在收尾的活动**——注释（packages/core/agent-loop/src/agent.ts:114-115）说得很直白：Waking input cannot join an aborted activity, so it starts the next turn。判定在**插入之前**捕获（:115 注释：Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it）——若等插入完再判断，splice 观察者里的重入 cancel 会改掉分类。`wakingAfterAbort` 为真时强制投到 `next-turn`：下一轮才领取。
2. **`splice` 的起点 `Infinity`**：`inbox.splice` 遵循标准数组 splice 语义（9.5），`Infinity` 经坐标规范化后等价于"追加到队尾"——对 `next-turn` 是排到普通队列末尾，对 `next-step` 是排到转向队列末尾。

`cancel`（packages/core/agent-loop/src/agent.ts:134-140）：

```ts
cancel(cause, options = {}) {
  if (!options.keepInbox) {
    this.inbox.clear()                                            // :136
    if (this.phase.kind !== 'idle') this.phase.wakeRequested = false  // :137
  }
  if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)   // :139
}
```

- 默认 `keepInbox` 为 false：**队列清空**（`inbox.clear` 写 `agent/inbox/spliced` 持久事件，`outcome:'canceled'`，9.5）**且锁存位清除**（packages/core/agent-loop/src/agent.ts:137——取消之后，先前"按过的门铃"不再重放）。`keepInbox: true` 则保留已排队/转向的工作，仅中止本次活动（`CancelOptions` 注释 `packages/core/agent/src/runtime-types.ts:35-41`：no canceled inbox splice is logged）。
- `abort(cause)` 传播的是 `AgentCancelCause`（`user`/`parent`/`hook`/`disposed`，`packages/core/session/src/types.ts:143-147`）。`disposed` 是唯一不锁存唤醒的 cause（9.6.1）——`packages/core/agent/src/runtime-types.ts:110-112` 注释：a `disposed` cancel leaves it parked（停在那里，不回放）。

## 9.5 收件箱：持久化的"待领取队列"

### 9.5.1 是什么

（① 类比）酒店前台有两格待取柜：一格放"新客人的入住单"（`next-turn`），一格放"在住客人的加急通知"（`next-step`）。领班每次来取，先拿加急格的全部通知，再（若是新客人）拿一张入住单。

（② 精确定义）`Inbox`（`packages/core/agent/src/inbox.ts:24-25` 注释）是 "A replay-once projection that incrementally consumes later inbox splices"——**会话日志中 `agent/inbox/spliced` 事件的增量投影**：

- 状态只有两个数组：`{ 'next-turn': [], 'next-step': [] }`（packages/core/agent/src/inbox.ts:26）；
- 构造时从 `session.events` 的种子之后重放所有 `agent/inbox/spliced`（:28-40），因此**进程重启后收件箱内容由日志恢复**——这与第 8 章"一切读端都是投影"是同一件事；
- 每次增删改，**先** `session.append('agent/inbox/spliced', splice)`（:186，持久事件先落账），**再**改内存（:187），随后发 `discarded`/`inserted` 通知（:188-191）——与 `Session.append`"先写日志再让订阅者看见"（8.3）同序；
- `agent/inbox/spliced` 的载荷规范见 `packages/core/agent/src/types.ts:19-24`：`target` / `start` / `removedCount?` / `inserted` / `outcome?: 'canceled'`；它在 `SessionEventMap` 里与 `turn/start` 等并列，**持久、可重放**。

（③ 最小示例）`claim` 是唯一"取件"路径（packages/core/agent/src/inbox.ts:71-78）：

```ts
claim(target, turn): UserMessage[] {
  const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)  // 清空加急格
  if (target === 'next-turn') claimed.push(...this.mutate('next-turn', 0, 1, [], false))  // 取 1 张入住单
  for (const message of claimed) this.notifications.claimed(message, turn)   // → agent/inbox/claimed
  return claimed
}
```

注意 `claim` 的持久 splice 是**纯删除**（packages/core/agent/src/inbox.ts:63-65 注释：The durable splices are pure deletions），不带 `outcome`；`outcome:'canceled'` 只出现在 `clear`/`remove`/`replace` 这类"取消丢弃"路径（discardRemoved 为 true 时，:177）。

### 9.5.2 领取之后：三种结局

"注入内容留在 inbox 直到被领取"——领取之后走向哪，取决于 pre-step 的结果（9.7）：

| 结局 | 触发 | 日志里留下什么 |
|---|---|---|
| 进 step | pre-step 决定 `enter` 且消息非空 | `user/message`（`surfaceOp:'append'`，`packages/core/agent-loop/src/agent.ts:282-284`） |
| 停在原地 | pre-step 决定 `reject` | 只有 `agent/inbox/claimed` 通知；既不是 `user/message` 也不是 discarded（`packages/core/agent/src/runtime-types.ts:188-197` 注释原文："it is neither discarded nor re-emitted as a user/message"） |
| 被取消/删除 | `cancel` / `inbox.remove` | `agent/inbox/spliced`（`outcome:'canceled'`）+ `agent/inbox/discarded` 通知 |

第三种里有一个精细的时间窗：**已领取但尚未写 `user/message`**（`claim` 与日志写入之间隔着 pre-step 的 waterfall，插件可能 await）。若在此期间被取消，`signal.throwIfAborted()`（`packages/core/agent-loop/src/agent.ts:231`、`:241`）会在写任何模型可见事件之前中止——消息已从投影中删除（claimed），但**没有**成为日志内容；轮次以 `aborted` 关闭（9.12）。"取消不污染日志"由此成立。

### 9.5.3 校验器

`validate`（packages/core/agent/src/inbox.ts:203-219）对每条 splice 做两个检查：坐标规范化（`start`/`removedCount` 为安全整数且落在数组内，:206-210）；**消息 id 唯一**（跨两格检查，:211-218）。因此把已在等待的同一身份消息再次 `append` 会抛错——"同一消息不能同时出现在两格"。坐标校验失败同样抛错，保证投影与持久事件永远一致（违反时宁可整体失败，见 8.6 的"入账前闸门"思想）。

## 9.6 唤醒、锁存与换挡

### 9.6.1 wakeDriver：三分支

（① 类比）门铃：人在家（idle）→ 直接开门；在洗澡（maintenance）→ 记下"有人按过铃"，洗完再开；在跑步（running）→ 若还在跑，他会自己跑到门口取信；若刚被取消、正在收尾 → 也记下，等收尾完重放；**人已经搬走（disposed）→ 按了也白按**。

（② 精确定义）`wakeDriver`（`packages/core/agent-loop/src/agent.ts:172-193`）按相位三分：

```ts
private wakeDriver(wakeAfterAbort = false): void {
  if (this.phase.kind !== 'idle') {
    // Maintenance and aborted drivers cannot deliver the wake: latch it for
    // replay at convergence. Live drivers claim queued work themselves;
    // disposal never latches, so teardown waits on no model turn.
    const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
    if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
      this.phase.wakeRequested = true        // 锁存：等收敛后重放   :178-180
    }
    return
  }
  const driver = Promise.withResolvers<void>()
  this.activityDone = driver.promise
  this.setPhase({
    kind: 'running', abort: new AbortController(),
    turn: this.phase.lastTurn, step: 0, wakeRequested: false,
  })                                        // :185-191
  this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)  // :192
}
```

不锁存的情形只有两种（注释 packages/core/agent-loop/src/agent.ts:176-177）：**`disposed`**——"disposal never latches, so teardown waits on no model turn"（拆除时不等待任何模型轮次）；以及 **running 且未中止**——"Live drivers claim queued work themselves"（活着的驱动器会自己领走投递的内容，无需锁存）。注意锁存条件是 `wakeAfterAbort` 或 maintenance：**普通运行期唤醒不锁存**，因为驱动器自己会看到 inbox 里的新货。

（③ 最小示例）锁存位唯一被消费的地方：`kick` 的 finally（packages/core/agent-loop/src/agent.ts:220）与 `runMaintenance` 的 finally（:158）——`if (wakeRequested && this.inbox.hasPending) this.wakeDriver()`。这就是"换挡续跑"：当前活动收敛后，若有人按过铃且队列里还有货，立刻再出发。

### 9.6.2 kick：驱动器的主循环

```ts
private async kick(): Promise<void> {
  try {
    while (await this.turn()) {}          // :212 —— 一个驱动器跑多个轮次
  } catch (_error) {
    // Reported failures and cancellation are contained at the driver boundary.   :214
  } finally {
    if (this.phase.kind === 'running') {
      const { turn, wakeRequested } = this.phase
      this.setPhase({ kind: 'idle', lastTurn: turn })       // :219
      if (wakeRequested && this.inbox.hasPending) this.wakeDriver()   // :220
    }
  }
}
```

三个关键点：

1. **`turn()` 返回 true 表示"尾部还有待领输入"**（9.8 ⑪），继续跑；返回 false 表示收敛，循环结束。
2. **catch 里什么都不做**：失败已在 `turn()` 内部被报告（`agent/error` 直播 + `turn/end` 的 reason 落账，9.12），驱动器边界只负责"别让异常逃逸"。取消同理——`turn()` 的 catch 会重新抛出（packages/core/agent-loop/src/agent.ts:305），在这里统一吞掉。
3. **finally 收回 running 后再看锁存**：此时 `wakeDriver` 看到的是 idle，于是**立即再开一个新的 running**（:220 → :183-192 分支），整个驱动器没有停机间隙。这就是"换挡"。

配套的 `whenIdle`（packages/core/agent-loop/src/agent.ts:195-200）要处理"等待期间又有人启动了新活动"的竞态——用 do/while 比较挂起期间 `activityDone` 是否变化：

```ts
async whenIdle(): Promise<void> {
  let activity: Promise<void>
  do { await (activity = this.activityDone) } while (activity !== this.activityDone)
}
```

`runMaintenance`（packages/core/agent-loop/src/agent.ts:142-162）与此对称：非 idle 时直接抛错（:143，不允许重入）；置 maintenance 相位（:145-151）；finally 回 idle 并同样检查锁存重放（:156-159）。维护期"waking input remains in the inbox until the task settles, while public status stays idle"（`packages/core/agent/src/runtime-types.ts:96-99`）。

### 9.6.3 initiator：我是谁的因果链

`wakeDriver` 启动驱动器时用 `withInitiator(this, () => this.kick())`（packages/core/agent-loop/src/agent.ts:192）。这不是装饰：`AgentRegistry` 用 `AsyncLocalStorage`（`packages/core/agent/src/index.ts:259`）把"发起者 Agent"沿异步调用链传递（:341-343），工具执行器据此取回发起者：

```ts
const agent = ctx.agents.requireInitiator()   // tool-calls.ts:67
```

于是"哪个 Agent 的轮次在跑，它的工具调用就归属谁"有了进程内的因果链——这是第 11 章工具归因（`ToolExecutionInput.agent`）的前提。注意边界：注释（`packages/core/agent/src/index.ts:250-254`）明确 "Ambient presence is neither liveness proof nor authorization"——因果链只用于同进程归因，身份仍以显式字段为准。

## 9.7 preStep：领取、组装、改写

`preStep`（`packages/core/agent-loop/src/agent.ts:225-243`）是每个 step 开门前的五步：

```ts
private async preStep(target, position): Promise<PreparedStep> {
  if (this.phase.kind !== 'running') throw new Error(...)        // :227 守卫
  const signal = this.phase.abort.signal
  const claimed = this.inbox.claim(target, position.turn)        // ① 领取（9.5）
  const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))  // ② 提示词组装
  signal.throwIfAborted()                                        // ③ 组装期间可被取消
  const sections = renderContextSections(assembly)
  const context = this.runtimeContext.project(joinContextSections(sections), sections)  // ④ 动态上下文投影
  const decision = await this.dispatch.waterfall(                // ⑤ agent/pre-step 瀑布
    'agent/pre-step', { messages: claimed, ...position, signal },
    (): Promise<PreStepDecision> => Promise.resolve({
      kind: 'enter',
      messages: context === undefined ? claimed : [...claimed, context],
    }),
  )
  signal.throwIfAborted()
  return decision.kind === 'reject' ? decision : { ...decision, assembly }   // :242
}
```

- **① 领取**：`claim(target, turn)`——`target` 决定是否同时取走一条 `next-turn`（9.5.1）。被领取的消息立即从投影中删除（持久 splice 是纯删除），此后只作为 `decision.messages` 存在。
- **② 组装**：`systemPrompt.assemble` 产出 `PromptAssembly`（提示词各 section 与优先级见第 10 章），`assembleContextFor(this, signal)` 携带 agent 与取消信号。
- **④ 动态运行时上下文**：`runtimeContext.project`（`packages/core/agent-loop/src/runtime-context.ts:64-75`）只在**内容变化时**才生成一条新的 `UserMessage`（源标记为 `@deepseek-ai/dsh-system-prompt` 的 plugin 消息，:12）；若上下文已清空，则生成一条 `CLEARED` 占位文本（:13："Current runtime context: none. Earlier runtime-context snapshots no longer apply."）。它**不直接发给模型**——它被拼进 `messages`，随后由 turn 循环写成 `user/message` 事件（9.8 ⑤'）。这正是 8.4.4"模型可见即已记录"规则在控制面的落点：动态上下文想进模型视野，就必须先成为日志事件。
- **⑤ 瀑布改写**：`agent/pre-step` 是 waterfall（第 4 章）。默认行为是 `enter` 并原样保留消息；任何监听者都可以：
  - 返回 `{ kind: 'enter', messages: [...] }` **替换**即将进入 step 的消息（改写，而非追加）；
  - 返回 `{ kind: 'reject' }` **拒绝**这一步（`PreStepDecision`，`packages/core/agent/src/runtime-types.ts:52-55`）。

**为什么"改写为空"是合法的？** 瀑布运行在 `claim` 之后、任何日志写入之前——消息还没"生米煮成熟饭"，此时删空不影响日志一致性；但轮次边界已经属于"这次唤醒"了（9.8 的 ④⑤ 处理）。

## 9.8 turn 主循环：开轮、续步、收尾

按 9.2.1 的伪代码逐段对照。**先落账，后推进**是本循环的第一纪律。

### 9.8.1 开轮

```ts
if (this.phase.kind !== 'running') this.throwError(...)      // :247-249 守卫
const { signal } = phase.abort
signal.throwIfAborted()                                      // :252
const turn = phase.turn + 1
try { this.session.append('turn/start', { turn }) }          // :255 开轮边界先落账
catch (error) { this.throwError(error) }                     // :256-258
phase.turn = turn                                            // :259 推进
let turnEnds: TurnEndReason | null = null                    // :260
let target: InboxTarget = 'next-turn'                        // :261
```

设计要点：`turn/start` 是持久边界（8.2），所以**先写日志再推进状态**——写入失败则抛 `agent/error`，相位不前进、轮次从未开始（9.12.3）。`turnEnds` 从 null 起步，记录"这轮怎么结束的"。

### 9.8.2 循环体：先试输入，再开 step

```ts
while (true) {
  signal.throwIfAborted()                                    // :264
  const step = phase.step + 1
  const decision = await this.preStep(target, { turn, step })                                  // :266
  if (decision.kind === 'reject') { turnEnds = { kind: 'blocked' }; return false }             // :267-270
  if (turnEnds && decision.messages.length === 0) break                                       // :271
  // A removed waking message or an enter decision rewritten to empty
  // still owns the initial turn boundary, but it spends no model call.   // :272-273
  if (phase.step === 0 && decision.messages.length === 0) {                                    // :274
    turnEnds = { kind: 'completed' }; return false                                            // :275-276
  }
  signal.throwIfAborted()
  this.session.append('step/start', { turn, step })          // :279
  phase.step = step                                          // :280
  try {
    for (const message of decision.messages)                 // :282-284
      this.session.append('user/message', message, { surfaceOp: 'append' })
    const stepEnd = await this.step(decision.assembly)       // :287
    // max-tokens is sticky: once any step hits the ceiling, later steps
    // that complete normally must not downgrade the turn outcome.   // :285-286
    if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd   // :288-290
  } finally {
    this.session.append('step/end', { turn, step })          // :292 必写
  }
  signal.throwIfAborted()                                    // :294
  if (turnEnds && this.inbox.nextStep.length === 0) {        // :295
    await this.dispatch.serial('agent/turn-stopping', { turn, signal })   // :296
    signal.throwIfAborted()                                  // :297
  }
  if (turnEnds && this.inbox.nextStep.length === 0) break    // :299
  target = 'next-step'                                       // :300
}
```

逐点解释（对照伪代码序号）：

**③ 拒绝（blocked）**：pre-step 拒绝这一步——`turnEnds = blocked` 且 **return false**。此时没有 `step/start`、没有 `user/message`、没有模型调用；轮次直接以 blocked 关闭（finally 必写 turn/end）。被领取的消息"停在原地"（9.5.2）：它不在日志里，也不在 inbox 里——被瀑布拒绝了。`packages/core/agent/src/runtime-types.ts:188-197` 注释确认："It is neither discarded nor re-emitted as a user/message."

**④⑤ 两种空改写**：
- `turnEnds && messages.length === 0`（packages/core/agent-loop/src/agent.ts:271）：轮次**已经有**结局（如上一 step 是 `max-tokens`），这一步又没领到消息——无需再开 step，直接 break 关闭。
- `phase.step === 0 && messages.length === 0`（:274-277）：**首个** step 就空——通常是"唤醒消息在 pre-step 被改写为空"或"唤醒后消息被删除"（注释 :272-273："A removed waking message or an enter decision rewritten to empty still owns the initial turn boundary, but it spends no model call."）。**轮次仍然打开并关闭（turn/start + turn/end 成对），但没有 step、没有模型调用**。这就是"空改写也关闭持久轮次"的原因：轮次边界属于"唤醒动作"，而不属于"消息内容"。

**⑤' 消息落账**：`user/message` 以 `surfaceOp: 'append'` 写入（packages/core/agent-loop/src/agent.ts:282-284），与第 8 章表面机制衔接——这是模型可见面，任何改写后的消息都必须走这里（8.4.4）。

**⑦ max-tokens 粘性**：注释原文（packages/core/agent-loop/src/agent.ts:285-286、:288-290）——"max-tokens is sticky: once any step hits the ceiling, later steps that complete normally must not downgrade the turn outcome." 只要有一个 step 撞到输出 token 上限，整轮结局就是 `max-tokens`；之后即使插件续跑了几个正常完成的 step，也不许把结局降级成 `completed`。更新规则 `if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd`（:290）正是该语义的机械实现：null 允许首次赋值，max-tokens 拒绝被覆盖。

**⑧ turn-stopping**：关门前的最后发言机会。条件是两个**同时满足**：`turnEnds` 已定 **且 next-step 收件箱为空**（packages/core/agent-loop/src/agent.ts:295）——有工具上下文在途或有人在路上（steer 已投递）就不算 "the model owes no response"（`packages/core/agent/src/runtime-types.ts:262-263`）。这是 **serial** 模式（第 4 章）：监听者可以调用 `agent.steer(...)` 塞回新消息，机器会**重读** inbox（:299 的第二次判断）。`packages/core/agent/src/runtime-types.ts:265-271` 注释强调"Data decides, so listener order cannot change the outcome"——数据决定，监听者顺序不能改变结果。

**⑨ 切换 target**：第一个 step 领 `next-turn`（外加清空 `next-step`），后续 step 只领 `next-step`（packages/core/agent-loop/src/agent.ts:300）。"followup 开新轮、steer 转向"在循环里的实际效果：下一轮多一条 `next-turn`，本轮剩余 step 看到 `next-step` 的新内容。

### 9.8.3 收尾：finally 与尾部续跑

```ts
} finally {
  try {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
    this.session.append('turn/end', { turn, reason: turnEnds! })   // :316-319
  } catch (error) { this.throwError(error) }                        // :320-322
}
if (!this.inbox.hasPending) return false                            // :324
phase.abort = new AbortController()                                 // :325 新信号
// A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.  // :326
phase.wakeRequested = false                                         // :327
phase.step = 0                                                      // :328
return true                                                         // :329
```

- **turn/end 必然写出**：finally 里写 `turn/end`，注释 "every exit assigns a turn ending"（packages/core/agent-loop/src/agent.ts:318）。`turnEnds!` 非空断言之所以成立，是因为主体（`:270/:276/:299` 与赋值 `:290`）与 catch（`:304/:309`）三条路径都赋过值（9.12 列全）。
- **尾部续跑**：turn 关闭后若 inbox 仍有货（比如关闭瞬间有人 steer 进来），**换新 `AbortController`**（:325）——旧信号已中止或完成，新信号让下一轮从干净状态开始；清锁存（:327，注释：换新控制器后旧锁存已失效——活驱动器自己会领队列）；`step = 0` 归零；返回 true 让 `kick` 的 `while` 无缝进入下一次 `turn()`（中间没有"回 idle"的间隙）。

## 9.9 step：一个步骤内可以发生几次模型请求

`step`（`packages/core/agent-loop/src/agent.ts:332-401`）接收 pre-step 给出的 `assembly`，执行"一次或多次"请求：

```ts
private async step(assembly): Promise<StepEndReason | null> {
  if (this.phase.kind !== 'running') throw new Error(...)
  const { turn, step, abort: { signal } } = this.phase
  signal.throwIfAborted()
  const system = renderPrompt(assembly)                     // :337

  while (true) {                                            // :339 —— 注意这个循环
    const { request, preparedCall } = await this.buildRequest(
      turn, step, assembly.tools, system, this.session.deriveMessages(), signal)   // :340-342
    const assembler = new BlockAssembler()
    const chunkSeqs: number[] = []
    const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)   // :345
    signal.throwIfAborted()
    for await (const chunk of stream) {                     // :347-351
      signal.throwIfAborted()
      chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq)
      assembler.push(chunk)
    }
    signal.throwIfAborted()
    const finish = assembler.finish                         // :353
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      const action = await this.dispatch.waterfall(
        'agent/request-error', { turn, step, provider: request.provider,
          failure: finish.failure, retryPolicy: preparedCall?.retryPolicy, signal },
        () => Promise.resolve<RequestErrorAction>(undefined))            // :354-365
      signal.throwIfAborted()
      if (action?.kind !== 'retry') {
        throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)  // :367-368
      }
      continue                                              // :370 —— retry 则再发一次
    }
    const message = createAssistantMessage({
      content: assembler.blocks(),
      source: { provider: request.provider, model: request.model, ...(replayState) },   // :373-380
    })
    this.session.append('assistant/message', { turn, step, message, ...(usage) },
      { surfaceOp: 'append', sourceEventSeqs: chunkSeqs })  // :381-390
    if (finish.kind === 'max-tokens') return { kind: 'max-tokens' }     // :391
    const toolCalls = message.content.filter(block => block.type === 'tool-call')  // :393
    if (toolCalls.length === 0) return { kind: 'completed' }             // :394
    const { concluded } = await executeToolCalls(loopCtx, turn, step, toolCalls, signal,
      context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]))  // :395-398
    return concluded ? { kind: 'completed' } : null                      // :399
  }
}
```

走读要点：

1. **`while (true)` 的语义**：一个 step 内允许**多次**模型请求——第一次请求的 assistant 消息带出工具调用，工具执行后（或 `agent/request-error` 决定 retry 后）循环回到 `buildRequest`，用**更新后的** `deriveMessages()` 再次请求（packages/core/agent-loop/src/agent.ts:341 每次循环现取）。`packages/core/session/src/types.ts:253` 对 `step/start` 的注释写的是 "one model call plus the tool executions it requested"——**类型注释的口径与实现上限之间有一处张力**：注释描述"典型形状"，而实现允许同一 step 内多次模型请求。两者并不矛盾（无新输入时，同一 step 内的后续请求可视为"工具执行"的延伸），但读者应知道实现是 `while (true)` 而非单次调用——这是一个值得课堂讨论的设计点。
2. **chunk 逐条落账**：每条 `assistant/chunk` 都 append 并取回 `seq`（:349）——原始流式 chunk 是日志真相（8.2），序列号收集进 `chunkSeqs` 供 assistant/message 以 `sourceEventSeqs` 引用（8.5）。
3. **错误与重试**：流在 adapter 边界被规范化为 `finish.kind === 'error' | 'aborted'`（第 10 章讲错误映射）。此时触发 `agent/request-error` waterfall（:354-365）：监听者可返回 `{ kind: 'retry' }` 表示"我已接管恢复"（换路由、改配置等），**不调用** `next()` 直接返回；默认 `undefined` 则失败是终局的（`RequestErrorAction`，`packages/core/agent/src/runtime-types.ts:57-58`）→ 抛 `LlmError`（:367-368）→ 上抛到 turn 的 catch 变成 `turnEnds.error`。注意 retry 会 `continue`，但**不会重走 pre-step**——同一 step 内直接再 buildRequest。
4. **assistant/message 与 usage 同账**：`usage` 与模型输出一起落账（:387），因为"there is no separate usage record"（`packages/llm/llm/src/types.ts:270-272`）。
5. **结局**：`max-tokens` → 立即返回（粘性交给 turn 循环，9.8）；**无工具调用 → completed**；有工具调用 → 交给 `executeToolCalls`（9.11），`concluded` 表示有工具结果宣称 `concludesTurn`（如"任务完成"型工具），否则返回 **null 让循环继续**（:399）。`null` 是 step 与 turn 之间的"无声契约"：**本 step 尚未定论**。

## 9.10 buildRequest：请求是从日志里推导出来的

这一节回答"每次请求的 provider、model、消息怎么定"——答案：**一切从日志与配置推导；瀑布只能替换配置，不能动消息**。

### 9.10.1 种子配置：首请求 vs 后续

```ts
const persistedHeader = session.requestHeader()               // :419 日志里的请求头（8.2）
const persistedConfig = persistedHeader?.config
const route = { provider: this.options.provider ?? '', model: this.options.model ?? '' }   // :421
const reasoningEffort = persistedConfig?.provider === route.provider
  && persistedConfig.model === route.model
  && persistedHeader?.adapterDefaults?.reasoningEffort !== true
  ? persistedConfig.reasoningEffort : undefined               // :422-426
const maxTokens = this.options.maxTokens                      // :427
const seedConfig = deepFreeze(structuredClone(
  this.requestHeaderLogged
    ? requestProposal(persistedHeader!)                       // :431 后续：用日志里的头
    : { ...route, ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(maxTokens === undefined ? {} : { maxTokens }) },  // :432-436 首次：选项
))
const proposedConfig = await this.dispatch.waterfall(
  'agent/request', { turn, step, signal },
  () => Promise.resolve(seedConfig))                          // :438-441
```

- **首次请求**的种子来自 `AgentOptions`（provider/model/maxTokens）；**之后的请求**来自**日志中的 `request/header`**（packages/core/agent-loop/src/agent.ts:431）——"请求配置也是日志状态"，这是第 8 章 requestHeader 折叠（8.2）在控制面的消费，也是"回放精确复现请求配置"的根据。
- `requestProposal`（:54-61）把**适配器推导出的默认值**剥掉（`adapterDefaults.reasoningEffort === true` 时删掉 `reasoningEffort`，`maxTokens` 同理）——注释（:54）"Remove adapter-derived values before plugins propose the next request config."：让插件提案时只看得到"人类写的配置"，避免把机器推导值当成提案基准。
- `reasoningEffort` 的继承规则（:422-426）：只有**同一 provider/model**（本实例声明的路由）且适配器没有接管该字段时才从日志恢复，否则保持 `undefined`——换路由时把决定权留给新适配器。
- **`agent/request` 瀑布不能改消息**：`packages/core/agent/src/runtime-types.ts:236` 注释原文 "Model-visible content must use logged channels; this waterfall cannot mutate messages."——与 8.4.4 的扩展规则同一条纪律：**要改模型看到的内容，去改日志（或 pre-step 改写）；瀑布只配"怎么调"，不配"说什么"**。

### 9.10.2 绑定适配器与落账请求头

```ts
if (!proposedConfig.provider || !proposedConfig.model)
  throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`)  // :443-445
try {
  preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)   // :448-449
  config = preparedCall.config
} catch (error) {
  // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
  if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error  // :453
  config = proposedConfig                                                    // :454
}
const header = canonicalHeader({ config, ...(adapterDefaults), ...(system), ...(tools) })  // :458-463
const baseline = this.session.requestHeader()
if (!this.requestHeaderLogged) {
  this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' })  // :466
  this.requestHeaderLogged = true
} else if (baseline === undefined || !headerEquals(baseline, header)) {
  this.session.append('request/header', { header, reason: 'change' })        // :469
}
const requestContext = { provider: config.provider, model: config.model, ...(contextWindow) }  // :472-477
if (previousContext?.provider !== requestContext.provider
  || previousContext.model !== requestContext.model
  || previousContext.contextWindow !== requestContext.contextWindow) {
  this.session.append('request/context', requestContext)                     // :478-483
}
```

- `prepareCall` 把提案配置解析为**带适配器默认值**的具体配置（第 10 章讲解析与路由）；`NO_ADAPTER` 被容忍（packages/core/agent-loop/src/agent.ts:452-454）：中间件（如 mock 层）可以在瀑布里替掉路由，此时请求仍以提案配置飞行，只是没有 adapter 绑定。
- **`request/header` 三态**（:464-470）：第一个请求写 `initial`（日志里还没有头）或 `resume`（恢复的会话已有头，本实例从该头继续折叠）；此后**仅当 `headerEquals` 判定为真实变化**才写 `change`。`canonicalHeader` / `headerEquals`（`packages/core/session/src/request-header.ts`）是"折叠"机制——请求配置在日志里是**压缩快照**，不是逐条流水（与 8.5 表面折叠同族）。
- **`request/context` 只在 provider/model/contextWindow 任一变化时写**（:478-483）——它记录"这次请求面对哪家模型、多大的窗口"，属于缓存键级事实（第 10 章扩展开讲）。

### 9.10.3 冻结：发出瀑布的是一份只读请求

```ts
const request = markAgentLoopRequest(deepFreeze({
  ...header.config,
  messages: boundaryMessages,             // 来自 deriveMessages()（8.4）
  ...(header.system !== undefined ? { system: header.system } : {}),
  ...(header.tools !== undefined ? { tools: header.tools } : {}),
  sessionId: this.session.id,
  signal,
}))                                       // :486-493
return { request, ...(preparedCall === undefined ? {} : { preparedCall }) }
```

两道锁：

1. **`deepFreeze`**（`packages/llm/llm/src/call-config.ts:88-117`）：迭代式冻结整个请求对象——**`AbortSignal` 特意跳过**（:83-84、:104：冻结会破坏取消机制）。
2. **`markAgentLoopRequest`**（`packages/llm/llm/src/call-config.ts:66-69`）：把请求对象登记进进程本地 WeakSet（:13），`llm/stream` 瀑布据此识别"这是 loop 造的请求"。`packages/llm/llm/src/index.ts:52-64` 的事件注释说明其意义（原话见 :56）："A LOOP-built request … arrives deep-frozen (mutation throws): its content is a pure function of the session log (the reconstructability Agent Note), so listeners read it, never rewrite it."——**流式监听者只能读，不能改**。

至此控制面对数据面的边界完整闭合：请求内容 = `deriveMessages()` 的投影（8.4）；模型可见内容只能经日志通道进入（8.4.4）；瀑布与监听者都无法绕过。

## 9.11 工具调度：屏障与滚动池

（预告：工具**内部**执行流水线——pre-execute / execute / around / restrict——在第 11 章；本节只讲循环如何调度一批 tool/call，以及调度与日志的一致性。）

### 9.11.1 入口：把模型输出翻译成执行计划

```ts
export async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {
  const agent = ctx.agents.requireInitiator()      // :67 —— 9.6.3 的因果链
  const { session } = agent
  const planned = toolCalls.map(block => ({
    block,
    exec: { callId: block.id, name: block.name,
      arguments: parseArguments(block.arguments), agent, signal },   // :71-80
  }))
  let next = 0, concluded = false
  while (next < planned.length) {
    const first = planned[next]!
    const mode = ctx.tools.executionMode(first.exec).kind   // :88 实时读取并发模式
    const group = mode === 'parallel' ? planned.slice(next) : [first]   // :89
    const outcome = await runGroup(ctx, turn, step, group, mode, signal, acceptContext)  // :90-92
    next += outcome.consumed
    concluded ||= outcome.concluded
    if (outcome.aborted) {
      for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call.block)  // :96
      return { concluded }
    }
  }
  return { concluded }
}
```

- **`parseArguments`**（packages/llm/llm/src/index.ts:103-110）：模型给的 `arguments` 是原始 JSON 字符串；合法则解析，**非法则保留原文**（让工具侧看到错误再自决）——注意日志里 `tool/call` 存的是**原样字符串**（`packages/llm/llm/src/types.ts:273-277` 注释，原话见 :275："exactly as the model produced it (unparsed)"）。
- **分组**（:84-99）：以 `executionMode` 的**实时**判定为准（:88，注释 "Commit before classifying again so registry changes affect unstarted calls"）：`exclusive` 是**屏障**（barrier：单独一组、单独调度），`parallel` 是**滚动池**（滚动池：消费剩余全部）。

### 9.11.2 runGroup：一次屏障或一个池

```ts
const { maxParallelToolCalls } = ctx.agentLoop.config          // :131 —— 默认 10（constants.ts:6）
const slots = group.map(() => undefined)
const callSeqs = group.map(() => -1)                           // :132-134 记录已写 tool/call 的 seq
const commitReady = async () => {                              // :146-160 按模型序连续提交
  while (committed < group.length) {
    const slot = slots[committed]
    if (slot === undefined) break                              // 必须连续，缺位即停
    const result = slot.needsPost ? await finalize(...) : finish(...)
    appendToolResult(session, turn, step, call.block, result, callSeqs[committed]!)
    for (const context of result.additionalContexts ?? []) acceptContext(context)   // :156
    concluded ||= result.concludesTurn === true
    committed++
  }
}
const fillPool = async () => {                                 // :198-213 滚动池
  while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
    const nextCall = group[nextToStart]!
    if (nextToStart > 0 && mode === 'parallel'
      && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break   // :203-204 重分类
    await startCall(nextToStart); nextToStart++
    ...
  }
}
```

- **滚动池**：同时 in-flight 的工具调用数 ≤ `maxParallelToolCalls`（packages/llm/llm/src/types.ts:199），默认 10（`packages/core/agent-loop/src/constants.ts:6`；`packages/core/agent-loop/src/index.ts:300-311` 的 Config 规定 `min(1)` 且可通过 settings 热更新——注释说明该值"读于每组开始时，已提交的变更只影响下一组，不打扰在飞的一组"）。
- **提交序 = 模型序**：`commitReady` 只在 `slots[committed]` 就绪时前进（:147-149）。工具**可以并行执行**，但 `tool/result` **按模型声明的顺序落账**——这就是 9.2.2 事件序里 `tool/result ×n` 有序的来源：日志顺序 = 模型顺序 = 回放可复现顺序。
- **`acceptContext`**（:156）：每个结果携带的 `additionalContexts` 被投入 **next-step 收件箱尾部**（回调实现在 `packages/core/agent-loop/src/agent.ts:397`：`this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context])`）——于是"工具结果的上文"会出现在**下一个 step** 的 `claim` 里（9.5.1），与本 step 遗留库存合流。注意投的是 `next-step` 而非 `next-turn`：工具上下文只影响本轮剩余步骤——`packages/core/agent/src/runtime-types.ts:269-271` 注释重申：conclusion "never short-circuits already-submitted next-step work"。

### 9.11.3 取消与失败的一致性承诺

模块注释（`packages/core/agent-loop/src/tool-calls.ts:1-11`）给出三个承诺，逐一对照实现：

| 承诺 | 实现 | 位置 |
|---|---|---|
| 取消后，未启动的调用写**合成 error 结果**，回放仍然有效 | `appendSkippedToolCall`：'Error: tool call aborted before dispatch' + `TOOL_ABORTED_BEFORE_DISPATCH` | `packages/core/agent-loop/src/tool-calls.ts:249-259`（调用点 :96、:240） |
| **调度器内部失败**不伪造结果 | catch 里 `Promise.allSettled` 等已启动的 dispatch 落地后抛原错误；已写的 `tool/call` 保留、不补 result | `packages/core/agent-loop/src/tool-calls.ts:231-235`，注释 :9-10 |
| 结果与上下文按模型序提交 | `commitReady` 的连续槽位 | `packages/core/agent-loop/src/tool-calls.ts:146-160` |

`appendToolResult`（packages/core/agent-loop/src/tool-calls.ts:268-288）以 `sourceEventSeqs: [callSeq]` 绑定 call 与 result（:288）——这是第 8 章表面机制在控制面的使用：`tool/result` 是表面事件，其 `sourceEventSeqs` 指向 `tool/call`（工具卡片的"完成态"）。

取消时**已启动**的工具调用会被 drain（等它们结算，packages/core/agent-loop/src/tool-calls.ts:220-230、:233），其 `additionalContexts` 也**照常**经 `acceptContext` 投递（注释 `:42-46`："Abort drains them, records synthetic results for unstarted calls, and returns with the signal still aborted after accepting started-call context through the caller-supplied acceptor (the machine stages it in its next-step inbox for the step boundary)."）随后控制回到 turn 循环的 `signal.throwIfAborted()`（`packages/core/agent-loop/src/agent.ts:294`，或下一次 `buildRequest` 内的 :456）让轮次以 aborted 结束（9.12）——**上下文留在收件箱里，等下一个（被唤醒的）轮次领取**。这就是"取消后消息不丢"的完整机制。

## 9.12 轮次的结局：五种 reason 与"必然关闭"

### 9.12.1 turnEnds 取值全表

`TurnEndReason` 有六种值（`packages/core/session/src/types.ts:155-174`），其中 `interrupted` 是持久化后端恢复崩溃孤儿轮次时补写的（`packages/llm/llm/src/types.ts:163-166` 的条目与注释，原话 :164："The loop never emits this marker"）——**loop 自己只能写五种**：`completed` / `max-tokens` / `blocked` / `aborted` / `error`。各自的诞生点：

| reason | 触发 | 代码 | 日志形状 |
|---|---|---|---|
| `completed` | 无工具调用的 step 正常返回；或首步空改写（packages/llm/llm/src/types.ts:274-276）；或 `concludesTurn` | `packages/core/agent-loop/src/agent.ts:394`、`:399` | 至少 turn/start + turn/end |
| `max-tokens` | 任一 step 撞到输出上限（粘性） | `packages/core/agent-loop/src/agent.ts:391` → `:288-290` | 同上 |
| `blocked` | pre-step 拒绝 | `packages/core/agent-loop/src/agent.ts:267-270` | 只有边界，无 step、无消息 |
| `aborted` | 取消（signal.aborted） | `packages/core/agent-loop/src/agent.ts:303-306` | 边界 reason 带 cause |
| `error` | 任何其他失败（拍平） | `packages/core/agent-loop/src/agent.ts:307-315` | reason.error 为结构化失败 |

### 9.12.2 错误拍平：LlmError 保事实，其余归 UNKNOWN

```ts
} catch (error) {
  if (signal.aborted) {
    turnEnds = { kind: 'aborted', reason: signal.reason as AgentCancelCause }   // :303-306
    throw error
  }
  turnEnds = {
    kind: 'error',
    error: error instanceof LlmError
      ? error.failure                                      // :311-312 保留可序列化事实
      : { message: errorChain(error), code: 'UNKNOWN' },   // :313 其余拍平
  }
  this.throwError(error)                                   // :315 先直播再上抛
}
```

与 `packages/llm/llm/src/types.ts:157-160` 的注释完全一致：error 永远是**结构化失败**——`LlmError` 的 facts 原样保留（adapter 已把提供方错误规范化为可序列化事实，第 10 章），其他异常拍平为 `{ message: errorChain(error), code: 'UNKNOWN' }`。`throwError`（`packages/core/agent-loop/src/agent.ts:202-208`）在 **turn/end 之前**发 `agent/error`（直播频道，`packages/core/agent/src/runtime-types.ts:280-290`），然后重新抛出——`kick` 的 catch（`packages/core/agent-loop/src/agent.ts:213-215`）吞掉它，驱动器边界安静收敛。

### 9.12.3 "必然关闭"与边界完整

把 9.8.3 的 finally 与开轮逻辑放在一起，可推出一个不变量：

> **turn/start 成功之后，必有 turn/end；step/start 成功之后，必有 step/end。**

推导：`step/end` 在包含 `user/message` 与 `step` 调用的 try-finally 内（packages/core/agent-loop/src/agent.ts:281-293）；`turn/end` 在 turn 的 try-finally 内（:316-323）。唯一的"缺口"是**开边界本身写入失败**：`turn/start` 的 append 失败（:255-258）→ `throwError`，轮次从未开始（既无 turn/end 也无后续事件）；`step/start` 的 append 失败（:279）→ 抛到 catch → 有 turn/end、无 step/end。对应的日志形状分别是"无边界"与"有轮次边界、step 边界不完整"——这正是 `turn/end` 注释 "A turn with no entered step has no step/start or step/end"（`packages/llm/llm/src/types.ts:246`）的严谨版。因此**不存在"开了轮却永无关闭事件"的持久状态**（除非开边界失败——那时日志里连轮次都没有）。（推断：该不变量由上述控制流推演得出，可用 `packages/core/agent-loop/tests/` 下的单测复核。）

### 9.12.4 取消收敛的三段式

从 `cancel` 到驱动器真正安静，共三段：

1. **cancel 当下**：`abort(cause)`（packages/core/agent-loop/src/agent.ts:139）→ 正在 await 的 `signal.throwIfAborted()` 立刻抛出（可能落在 preStep 的 :231/:241、turn 的 :264/:294/:297、step 的 :336/:347/:352、工具池的循环里）；
2. **turn 收尾**：catch 判定 `signal.aborted` → `turnEnds = { kind: 'aborted', reason }` 并重新抛出（:303-306）→ finally 写 turn/end → `kick` 吞掉；
3. **收敛后重放**：finally 里若 `wakeRequested && hasPending` 则 `wakeDriver()`（:220）——覆盖"取消进行中又有人投递"的竞态（9.6.1）。

配套的锁存纪律：只有 `maintenance` 或 `wakeAfterAbort` 才锁存；`disposed` 永不锁存（9.6.1）。`packages/core/agent/src/runtime-types.ts:110-112` 的完整表述："Waking input submitted after active cancellation is queued for the next turn and runs when the aborted activity converges to idle; a `disposed` cancel leaves it parked."

## 9.13 最小示例：一个自观察的轮次探针插件

不依赖任何业务工具，只靠第 4 章的事件机制，就能"看到"一次轮次的一生。下面的插件挂在 agent 的 scoped 扩展点上（注册方式见第 5/6 章；scope 过滤保证只观察本 agent）：

```ts
// 观察控制面直播频道（都在进程内，不持久）
ctx.on('agent/status', ({ agent: { id }, status }) => {
  console.log(`[${id}] status → ${status}`)            // idle ⇄ running
})
ctx.on('agent/pre-step', (payload, next) => {
  console.log(`[pre-step] turn=${payload.turn} step=${payload.step} 领取 ${payload.messages.length} 条`)
  return next()                                        // 不改写：保持默认 enter
})
ctx.on('agent/request', (payload, next) => {
  console.log(`[request] turn=${payload.turn} step=${payload.step}`)
  return next()                                        // 不改配置
})
ctx.on('agent/turn-stopping', ({ turn }) => {
  console.log(`[turn-stopping] turn=${turn}：next-step 已空，准备关门`)
})
// 观察数据面：任何 session 事件都走日志
ctx.on('session/event', (subject, event) => {
  console.log(`[log] ${event.type}#${event.data.turn ?? '?'}.${event.data.step ?? ''}`)
})
```

预期输出（按 9.2.2 事件序推演；**未运行验证：该示例需要完整 dsh 环境与 API key**，执笔环境不运行 node/pnpm）：

```
[<agent-id>] status → running（触发于 wakeDriver，见 9.6.1）
[log]      turn/start #1.
[pre-step] turn=1 step=1 领取 1 条
[log]      step/start #1.1
[log]      user/message #1.1
[request]  turn=1 step=1
[log]      request/header #1.1  reason=initial
[log]      assistant/chunk #1.1  ×n
[log]      assistant/message #1.1
[log]      tool/call #1.1  ×k
[log]      tool/result #1.1  ×k
[log]      step/end #1.1
[turn-stopping] turn=1：next-step 已空，准备关门
[log]      turn/end #1.  reason=completed
```

（提示：`agent/status` 的 running 应出现在 `turn/start` 之前——**相位先行、日志随后**（9.6.1、9.8.1）；若把探针改挂在 `pre-step` 里**改写** `messages`（如把 `inject` 来的动态上下文压缩成一行），就能观察到 9.7 ⑤ 的瀑布与 9.8.2 的空改写分支——这正是练习 3 的起点。）

## 9.14 本章小结

一张速查表 + 三条纪律。

**控制面五个机制的速查表**：

| 机制 | 一句话 | 位置 |
|---|---|---|
| 相位机 | idle / maintenance / running；维护期对外 idle；翻转才发 `agent/status` | 9.3 |
| 前门 | followup 开新轮、steer 转向、inject 塞资料；cancel 清队列 + 中止活动 | 9.4 |
| 收件箱 | `agent/inbox/spliced` 的增量投影；先落账后改内存；内容留在箱中直到被领取 | 9.5 |
| 唤醒 | idle 直接开跑；maintenance/取消后锁存，收敛时换挡重放；disposed 永不锁存 | 9.6 |
| 轮次循环 | 开轮先写 start；pre-step 决定进不进；step 出结局；finally 写 end；尾部续跑 | 9.7–9.9 |

**三条纪律**（与第 8 章的"模型可见即已记录"互为表里）：

1. **先落账，后推进**：`turn/start`、`user/message`、`agent/inbox/spliced` 都在状态推进之前写入——投影（inbox、deriveMessages、runtimeContext）永远慢于日志，日志是唯一真源。
2. **每个轮次必有结局**：`turn/start` 成功之后必有 `turn/end`（"every exit assigns a turn ending"），`step/start` 之后必有 `step/end`；唯一缺口是开边界本身失败，那时连轮次都不存在。
3. **模型可见内容只走日志通道**：pre-step 改写最终落成 `user/message`（9.7、9.8）；`agent/request` 只能改配置不能改消息（9.10.1）；`llm/stream` 收到的是深冻结、带 loop 标记的只读请求（9.10.3）。

**一个边界**：`agent/*` 事件（status/inbox 通知/pre-step/request/request-error/turn-stopping/error）只活在进程内，是控制面的直播频道；持久的事实全部以 session 事件落账。二者可读性不同、生命周期不同，但**语义一致**——`agent/error` 与 `turn/end.reason=error` 描述的是同一件事的两个侧面。

## 9.15 分层练习

**理解层**
1. 不看源码，画出相位状态机：三个节点、全部迁移边、每条边的触发函数与对外 `agent/status` 变化；再标出"锁存位"在哪里被置位、在哪里被消费。
2. 把 11 个 agent/* 事件按"生命周期通知 / 机器扩展点 / 错误通知"三组分类（对照 `packages/core/agent/src/runtime-types.ts:146-291`），并指出哪些事件载荷里带 `signal`。

**应用层**
3. 写一个 `agent/pre-step` 插件：把 `inject` 来的动态上下文（`messages` 中 source 为 `@deepseek-ai/dsh-system-prompt` 的那条）压缩成一行文本。写出：插件代码、改写后的事件序差异（与 9.2.2 表对比哪些事件多/少）、以及"若压缩结果为空字符串"时轮次会怎样结束。
4. 实现"步骤限流"：在 `agent/request` 瀑布里把 `maxTokens` 限制为 2000。回答：为什么同一处瀑布**不能**做"限制消息条数"？用 `packages/core/agent/src/runtime-types.ts:236-237` 的注释论证，并指出正确的替代位置。

**综合层**
5. 取消发生在工具执行中途。结合 9.11.3 的表分析：正常取消路径下日志中 `tool/call` 与 `tool/result` 是否对偶？调度器内部失败路径呢？（提示：两处承诺不同——一处在 `packages/core/agent-loop/src/tool-calls.ts:96` 与 `:240`，另一处在 `:231-235` 与模块注释 `:9-10`。）
6. 论证"running 且未中止时锁存唤醒"会造成的两类错误（丢唤醒 / 重复开轮），并说明为什么代码选择只对 maintenance 与 wakeAfterAbort 锁存（`packages/core/agent-loop/src/agent.ts:177-181`）。

**挑战层**
7. pre-step 拒绝后的瞬间，控制台收到 `followup(...)`：写出之后的完整事件序与 `turnEnds` 的值（注意 target 切换 packages/core/agent-loop/src/agent.ts:300 与尾部续跑 :324-329 的交互），并画出 phase 的完整变化序列。
8. 设计"轮次级重试"：若提供方持续 429 且 `agent/request-error` 每次返回 `{ kind: 'retry' }`，step 内的 `while(true)`（:339）会不会无限循环？给出一个带重试计数上限的插件方案，并说明它与第 10 章 `retryPolicy` 的边界。

## 9.16 延伸阅读

- `packages/core/agent-loop/src/agent.ts`：本章主角，建议整读（`Phase`、`kick`、`turn`、`step`、`buildRequest` 的注释即设计文档）。
- `packages/core/agent/src/inbox.ts` 与 `packages/core/agent/src/runtime-types.ts`：收件箱投影与公共契约（五个方法、十个事件的规范注释）。
- `packages/core/agent/src/index.ts`：`AgentRegistry`——initiator 因果链、`register`/`enter`/`announce` 的生命周期编排。
- `docs/agent-lifecycle.zh.md`：agent 生命周期的官方说明（本章 9.3、9.12 的配套文档）。
- `docs/tool-execution-pipeline.zh.md`：工具执行流水线（第 11 章伴读；本章 9.11 只讲了调度层）。
- `.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.zh.md`：取消收敛唤醒锁存的修复笔记（`packages/core/agent/src/runtime-types.ts:112` 引用的正是它，9.6 的"换挡续跑"设计来源）。
- `packages/core/agent-loop/README.zh.md` 与 `packages/core/agent-loop/tests/`：行为规格与单测（验证 9.12.3 推演结论的捷径）。
