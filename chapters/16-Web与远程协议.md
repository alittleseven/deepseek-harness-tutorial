# 第 16 章　Web 与远程协议：浏览器、宿主、SDK 与 ACP

> **本章学习目标**（读完本章，你应该能够）：
> 1. 说清浏览器端如何获得实时事件：上行 `POST /api/<method>` 一元调用（强制 `application/json` 防 CSRF），下行两条 downlink-only WebSocket（`/api/events.mux`、`/api/events.host`），SSE 只服务同进程载体，普通 GET 到 WS 路径返回 426；
> 2. 讲出 webserver 的路由匹配序（exact → 最长前缀 → fallback）的动机，以及 apiproxy 帧引擎（FrameQueue、订阅基线、`respond` 路由）如何把宿主事件桥接到浏览器；
> 3. 说明 typert 的接口发现（生成器 → 注册表 → loader）与 api gateway 的拦截/调用（`intercept('/api', …)`、`invoke`）；
> 4. 了解 SDK（换行分帧 JSON-RPC 2.0 + `DeepSeekHarness`/`HarnessClient`）与 ACP（`initialize`/`authenticate`/`session/new`…方法表）的对外形态与已知限制；
> 5. 解释 web-startup 为何拒绝 `--host 0.0.0.0`，以及"信任栅栏是可达性策略不是认证"到底意味着什么。
>
> **本章讲法**：对比型——三端一源。先讲"协议上流动的是什么"（方法调用命令 / 会话事件流 / host 事件三类载荷），再讲"每一端怎么接收、怎么渲染、怎么防攻击"。**前置**：第 8 章（会话日志事件流，见 8.2 词汇表与 8.4 投影）；第 15 章（持久化与设置后端，被宿主服务依赖）；第 4 章（事件分发）可后置；第 7 章（组合包）可选。

## 16.1 楔子：一个事件、三种住户、一个源头

### 16.1.1 三个要先认识的名词

本章反复出现三个词，先按"三步法"认识它们。

**① 类比建立直觉。** 把 dsh 想成一栋楼里的公司：真正干活的人（agent-loop、工具、模型适配器）坐在办公室里（一个 Node.js 进程）；楼外的人是访客。访客想找人办事，只能通过前台（HTTP 接口）；办公室里发生的事，访客怎么知道？通过大厅公告屏（事件流）。访客身份千差万别：站在大厅里的（浏览器）、远程打电话的（SDK）、第三方代办机构（ACP）——但公告屏只有一块。

**② 精确定义。** 本章语境下：

> **宿主（host）**：运行 harness 运行时的那一侧进程。Web 组合里就是 `dsh --profile web` 启动的那个 Node 进程（`packages/bundle/web-app` 给它装配 web 专属插件）；相对地，"浏览器侧"（client）只是它的远程客户端。宿主持有会话日志、agent-loop 与全部能力 seam。
>
> **协议（protocol）**：通信双方就"线上传什么形状的字节、每个字段什么含义"达成的约定。本章涉及两套独立协议栈：在线协议（浏览器 ↔ 宿主：HTTP POST + WebSocket）与进程外协议（另一进程 ↔ 宿主：stdio 上的 JSON-RPC 2.0，见 16.7/16.8）。
>
> **桥接（bridge）**：把一种接口形态翻译成另一种的中间层。最典型的例子：Node 的 `node:http` 请求对象与 WHATWG `fetch` 的 `Request` 是两种形态，`packages/client/connection/src/http-bridge.ts` 把前者翻译成后者（`bridge()`，`packages/client/connection/src/http-bridge.ts:32-99`），再喂给纯 fetch 形态的处理器。桥接是分层思想：下层接口稳定后，上层可以各写各的。

**③ 最小实证。** 桥接的"存在感"在 `http-bridge.ts` 顶部注释里：`node:http ↔ WHATWG fetch bridge for the /api transport（packages/client/connection/src/http-bridge.ts:9）`。你只需要记住：浏览器请求进来 → 桥接翻译成 `Request` → 分发给一个 `fetch(request): Promise<Response>` 处理器。后面 16.3 全程沿着这条线走。

### 16.1.2 三端一源：谁和谁共享同一个源头

把产品外围面摊开，一共三种"端"，它们共享同一个**事件源**——会话日志（第 8 章）：

| 端 | 载体（carrier） | 读写方式 | 用途 |
|---|---|---|---|
| 浏览器 UI（apps/web + packages/client/*） | HTTP POST + 两条 downlink-only WebSocket | 上行命令、下行事件 | 人机交互的 GUI |
| 宿主服务侧（webserver + apiproxy + api-gateway） | 同上（服务端那半） | 接收命令、发布事件 | 唯一的"真相持有者" |
| 进程外驱动（packages/sdk、packages/acp） | stdio 上的 JSON-RPC 2.0 | 命令 + 通知 | 另一进程把 harness 当库/子进程驱动 |

**载体（carrier）**：传输层的抽象——"一元请求/响应怎么走、下行事件流怎么走"这两件事的成套约定。`packages/client/connection/README.md` 一句话点破：浏览器载体用 HTTP POST 承担一元与 respond、为 `events.mux`/`events.host` 各开一条 downlink-only WebSocket；**同进程（in-process）载体满足同一条双流抽象**。也就是说"浏览器"与"同进程"只是同一载体契约的两套实现（`packages/client/connection/README.md:5`、`packages/client/connection/README.md:13`）。

**一源**：三端最终都围绕同一份会话日志（`session/event` 事件流）转。宿主把它投影成消息历史喂模型（见 8.4），也把它编码成帧推给浏览器与 SDK 客户端。第 15 章说的持久化后端只是这份日志的存储实现——"源"始终是日志本身，不是任何一端的视图。

### 16.1.3 协议上流动的是什么：三类载荷

在线协议里，线上只流动三种东西，先给全景，后文逐个剖：

1. **方法调用命令（unary）**：浏览器 → 宿主，`POST /api/<method>`，一次请求一次响应，如 `session.prompt`、`session.list`（16.3）；
2. **会话事件流（mux 流）**：宿主 → 浏览器，`/api/events.mux` WebSocket 下行。载荷就是第 8 章会话事件的帧化形态（`session/event` 帧，`packages/host/apiproxy/src/api-proxy.ts:3475-3494`），外加订阅确认、队列快照等"恢复视图"帧（16.5）；
3. **host 事件流（host 流）**：宿主 → 浏览器，`/api/events.host` WebSocket 下行。会话列表增删、agent 运行状态、workspace 变化与转发来的远程事件（`packages/host/apiproxy/src/api-proxy.ts:3534-3636`）。

其中 2 与 3 都是**单向下行**——浏览器在这两条 socket 上不发业务消息，发一条关一条（16.4）。这就是"三端一源"在传输层的全部形状。

## 16.2 浏览器侧的两个阶段：从 `window.__DSH_BOOT__` 到插件树

### 16.2.1 壳的壳：apps/web 做了什么

`apps/web/src/main.ts` 全部职责只有三步：找挂载点、new 一个入口、run（`apps/web/src/main.ts:6-10`）：

```ts
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
```

注释说得很直白：loader 持有、模块表播种、AppRoot 闸门、插件组装——全在 `@deepseek-ai/dsh-client-web` 里，这个文件只负责找到挂载点（`apps/web/src/main.ts:1-5`）。真正的浏览器导shell在 `packages/client/web`。

### 16.2.2 两阶段 boot：先有模块系统，再有插件树

浏览器端 boot 分两个阶段（`packages/client/web/README.md:5`，本文引用其描述；`src/boot.tsx` 是实现）：

**阶段一（module face，模块面）**：解析宿主注入的入口图 `window.__DSH_BOOT__`，构建浏览器模块系统，并行预取 `immediately` 层——bundle 执行只**注册工厂**（`load({id, factory})`），不物化导出。
**阶段二（plugin face，插件面）**：挂载 vendored cordis Loader，通过其 `internal` 契约注入模块系统；为图中每一行创建一个 loader entry，外加壳自有的 app-shell 组装 entry；等 loader 安静（quiesced）且每个 entry 的 fiber 都 ACTIVE 后，AppRoot 一次性切换到真 UI。

**为什么分两阶段？** 因为 cordis 加载的是"插件"，而插件还得彼此依赖共享模块（React、cordis 本身、UI 基元）。宿主推送的每个 bundle 是被打包过的独立脚本，它通过全局 `require` 从模块表里取共享模块——所以必须**先**有一个能被任何 bundle 引用的模块表，**后**才有依赖这些模块的插件树。壳的规则是"kernel 不得 value-import 任何插件包"（`packages/client/web/src/boot.tsx:2-6`），否则插件失败时加载页也起不来。

### 16.2.3 宿主怎么把入口图塞进页面：`window.__DSH_BOOT__`

宿主侧由 `client-modules` 的 Node 半扫描声明了 `dsh.client` 的包，合成入口图并注入 index.html（`docs/subsystems/client-modules.zh.md`：tapIndex 注入 manifest；本节描述以该文档为准）。浏览器半负责解析与消费，形状如下（`packages/client/modules/src/client/manifest.ts:50-69`）：

```ts
export interface WebBootEntry {
  id: string        // 条目名 == 包名
  url: string       // '/plugins/<id>/client.js?rev=<rev>'
  rev: string       // bundle 内容哈希（缓存一致性锚）
  inject?: string[] // 包名依赖边（信息性：预检显示 / HMR 差分）
  immediately?: boolean  // 阶段一预取标记
}
export interface WebBootGraph {
  rev: string
  entries: WebBootEntry[]
}
```

解析发生在 `parseBootManifest`（`packages/client/modules/src/client/manifest.ts:108-143`）：校验 `__DSH_BOOT__` 是对象、`rev` 是字符串、每行带 string 的 id/url/rev，错误带具体位置。它把"一行"拆成两个消费视图（`packages/client/modules/src/client/manifest.ts:91-99` 的 `BootManifest`：`modules` 给模块表、`plugins` 给 entry 组装）——所谓 **"one wire, two consumer views"**。

回到 `boot.tsx` 的 `run()`（`packages/client/web/src/boot.tsx:97-143`）：解析 manifest（:98）→ 建 `ClientModuleSystem`，静态模块来自 `getStaticModules()`（`packages/client/web/src/seed.ts:25-40`：react、cordis、ui-slots 等十个平台词）→ `registerStatic` 注册壳自有的 app-shell 与（以裸包名注册的）modules 客户端半 → 渲染加载页 → 并行做两件事：预取 immediately 层（`packages/client/web/src/boot.tsx:151-158`）与 `new Context()` 后进入插件面（`packages/client/web/src/boot.tsx:133-136`）。

插件面 `runPluginBoot`（packages/client/web/src/boot.tsx:161-208）：`ctx.plugin(Loader)` 挂 loader（:163）→ **在任何 entry 存在之前**把模块系统注入 `loader.internal`（:168，注释警告：`tree.import` 在 internal 缺失时会退回裸 dynamic import，浏览器里必炸）→ 等预取层（:183）→ 创建 entry 行 `[MODULES_ID, ...manifest.plugins.map(...), APP_SHELL_ID]`（:189-204）→ `loader.await()`（:206）→ 全量 fiber 清扫（:216-237）：无 fiber = import 失败；PENDING = 等一个永远不来（inject 等待无超时）的服务——清扫就是"大声失败"的补偿。

**最小示例**：一次真实页面加载时 `window.__DSH_BOOT__` 的样子（形状按 `packages/client/modules/src/client/manifest.ts:50-69`，字段值示意）：

```json
{
  "rev": "a1b2c3",
  "entries": [
    { "id": "@deepseek-ai/dsh-client-modules",
      "url": "/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=a1b2c3",
      "rev": "a1b2c3", "immediately": true },
    { "id": "@deepseek-ai/dsh-client-ui-conversation",
      "url": "/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js?rev=a1b2c3",
      "rev": "a1b2c3" }
  ]
}
```

**（未验证）**：上述 JSON 字段值来自类型定义推演；真机页面里的实际内容需构建后打开浏览器查看（本写作环境未构建、未运行浏览器）。

## 16.3 上行：一条 `POST /api/<method>` 的七跳

现在跟一条**命令**走：浏览器想给会话发一句话，调用 `session.prompt`。

**第 1 跳：浏览器侧发起。** 客户端运行时调 `connection.rpc.call('/api', '<ns>/<method>', {args}, signal)`（`docs/api-gateway.md:121`；文档描述，与源码 `ClientRemoteService` 一致）；浏览器载体把它翻译成 `fetch` POST，路径即方法（`packages/client/connection/src/client/web-api-client.ts:13-16`，`doFetch` 就是 `globalThis.fetch`）。

**第 2 跳：webserver 收到。** `packages/host/webserver` 的 `WebServer` 是唯一 HTTP/WS 宿主设施（`packages/host/webserver/src/index.ts:148-179` 的 `[Service.init]` 建服务器、按路由分发；第 5 跳讲匹配）。接入方是 `client-connection` 插件：它注册 `/api` 前缀路由 + 信任栅栏（`packages/client/connection/src/index.ts:161-173`）。**信任栅栏（trust fence）**先验：Host 头必须是 loopback 或声明的 trusted authority（`packages/client/connection/src/api-request-trust.ts:96-108`），否则 403——这是防 DNS rebinding 的**可达性策略，不是认证**（`packages/client/connection/src/index.ts:76-83` 注释：`trustedHosts is a DNS-rebinding fence, explicitly not authentication`）。

**第 3 跳：桥接。** `bridge()` 把 node:http 请求完整读入内存（上限 160 MiB，`packages/client/connection/src/http-bridge.ts:12`；超限 413 并销毁连接，`packages/client/connection/src/http-bridge.ts:47-65`），翻译成 fetch `Request`；客户端断开时通过 `res.on('close')` 且未正常结束时 abort（`packages/client/connection/src/http-bridge.ts:44-46`，注释解释了为什么必须挂在 response 而非 request 上）。

**第 4 跳：进入纯 fetch 处理器。** `toFetchHandler(api)` 是对 `ApiProxy` 的封装（`packages/host/apiproxy/src/fetch/handler.ts:243-319`），它只认 POST（`packages/host/apiproxy/src/fetch/handler.ts:273-275`），并且——关键的安全关——**只有 `application/json` 才放行**（`packages/host/apiproxy/src/fetch/handler.ts:283-286`）：

> Cross-site write fence: browsers send "simple" POSTs (text/plain, form encodings) without a CORS preflight … Only the JSON media type is accepted; anything else is forced into a preflight this server never answers. 415 = carrier layer.

这就是"强制 JSON 防 CSRF"的证据：恶意页面若能用 `text/plain` 发"简单 POST"，`session.prompt` 会在浏览器不可读响应的情况下照常执行（副作用照犯）。强制 JSON 后，跨站 POST 必须先过 CORS 预检，而服务器从不应答预检。注意 415/400/404 只表达**载体层**错误；业务错误一律 HTTP 200 + `ServerResponse`（`packages/host/apiproxy/src/fetch/handler.ts:1-7` 的注释是规范）。

**第 5 跳：方法查表。** `methodFor(path)` 用 `UNARY_ROUTES` 查表（`packages/host/apiproxy/src/fetch/handler.ts:146-148`）。全表约五十行、编译期与 `RpcMethodMap` 锁定（`packages/host/apiproxy/src/fetch/handler.ts:90-143`，如 `'session.prompt': { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) }`，`packages/host/apiproxy/src/fetch/handler.ts:99`）。信封校验后（`packages/host/apiproxy/src/fetch/handler.ts:305-317`，method 与路径必须一致），进入 `handleUnary`：schema 解析 payload（失败 → 200 + `bad-request`，`packages/host/apiproxy/src/fetch/handler.ts:178-192`）。

**第 6 跳：域方法实现。** 以 `session.prompt` 为例（`packages/host/apiproxy/src/api-proxy.ts:2461-2517`）：校验 `clientTimeZone` 是合法 IANA 名（:2462-2472）→ `turnAgentFor(request, sessionId)` 解析出会话对应的 live/cold agent（:2473，统一入口在 `packages/host/apiproxy/src/api-proxy.ts:1850`；live 复用、冷会话恢复、subagent 拥有权围栏，见第 13 章）→ 以 `{ kind:'user', rpcId: request.rpcId, ... }` 构造 `MessageSource`——**RPC 的请求身份骑在持久化的用户消息上**（:2476-2481）→ 有图片先查模型能力（:2482-2495）→ `durablePromptContent` → `createUserMessage` → `mode === 'steer' ? agent.steer(m) : agent.followup(m)`（:2496-2499）→ 失败映射为 `attachment-error`/`agent-busy`（:2500-2513）。

**第 7 跳：响应回来。** 域方法返回窄形态 `RpcResponse`，`fullResponse` 补全为 `ServerResponse`（`packages/host/apiproxy/src/fetch/handler.ts:163-167`），HTTP 200 出网。浏览器侧按 `rpcId` 配对上响应（`rpcId` 品牌类型与四象限消息模型在 `packages/host/apiproxy/src/api/rpc.ts:150-186`：`ClientRequest`/`ServerResponse`/`ServerRequest`/`ClientResponse`，判别键是 `type` 字面量）。

**最小示例**（`curl` 级，验证 415/426 两个载体层状态码；**未验证**：需要一台构建后运行中的 `dsh --profile web`）：

```bash
# 1. 正确调用：信封 {type, rpcId, method, payload}
curl -i http://127.0.0.1:3080/api/session.list \
  -H 'content-type: application/json' \
  --data '{"type":"client-request","rpcId":"r1","method":"session.list","payload":{}}'
# 预期：HTTP/1.1 200 + {"type":"server-response","rpcId":"r1","result":{...}}

# 2. 简单 POST（text/plain）：被 415 拒——CSRF 防线
curl -i http://127.0.0.1:3080/api/session.list \
  -H 'content-type: text/plain' --data '{"type":"client-request"}'
# 预期：HTTP/1.1 415 content type must be application/json

# 3. 普通 GET 到 WebSocket 路径：426 upgrade required
curl -i http://127.0.0.1:3080/api/events.mux
# 预期：HTTP/1.1 426 + connection: Upgrade / upgrade: websocket
```

## 16.4 下行：两条 downlink-only WebSocket

### 16.4.1 为什么不是 SSE

SSE（Server-Sent Events）在 `toFetchHandler` 里**有**实现——`sseResponse`（`packages/host/apiproxy/src/fetch/handler.ts:203-236`）：`text/event-stream`，开局发一行注释 `: connected`（让代理看到活通道），每帧 `data: <JSON>\n\n`，出错发 `stream/error` 帧。它服务谁？`packages/host/apiproxy/src/fetch/handler.ts:254-259`：`GET /api/events.mux`、`GET /api/events.host` 直接返回 SSE 响应。而浏览器侧的这两条路径被 `client/connection` **拦截**：普通 GET 到 WS 路径 → 426（`packages/client/connection/src/index.ts:150-155`，带 `connection: Upgrade, upgrade: websocket` 头）。

对比 `packages/client/connection/README.md:13` 的定性：**"Ordinary network GETs to these paths return 426 with no SSE fallback; `toFetchHandler`'s SSE codec serves only the isomorphic in-process carrier."** 即：SSE 编码服务于同进程载体（`InProcessApiClient` 直接用 `toFetchHandler` 的 fetch，`packages/host/apiproxy/src/fetch/client.ts:520-536`）与文档契约；**浏览器载体刻意不用 SSE**。为什么？两条证据链：①事件是**长时间、高吞吐、且只有下行**的语言——WebSocket 全双工但这里只作纯净下行（客户端一说话就 1008 关闭，`packages/client/connection/src/websocket-downlink.ts:109-111`），比 SSE 更快更省；②SSE 走 HTTP 容易被中介缓冲/受限，且"GET 可被 `<img>`/导航直接命中"，426 的显式语义把"这里只能升级 WS"写死在协议里。

### 16.4.2 握手与泵：websocket-downlink

两条路径的装配在 `packages/client/connection/src/index.ts:174-195`：`ctx.inject(['apiProxy'])` 后，为 `MUX_EVENTS_PATH`/`HOST_EVENTS_PATH` 各注册一个 upgrade 路由（路径常量在 `packages/client/connection/src/api-path.ts:8-14`）；upgrade 前先过信任栅栏，不过直接回 403 原文（`packages/client/connection/src/websocket-downlink.ts:144-153`）。

`WebSocketDownlinks`（`websocket-downlink.ts`）：`handleMux`/`handleHost` 各自调用 `api.events.mux(...)`/`api.events.host(...)`（packages/client/connection/src/websocket-downlink.ts:64-82）——宿主 API 的 events 域返回的是一个 `AsyncIterable` 帧流，upgrade 完成后由 `pump()` 消费（:118-137）：

```ts
private async pump<F extends Frame>(socket, frames, abort) {
  try { for await (const frame of frames) await send(socket, frame) }
  catch (error) {
    if (!abort.signal.aborted) { try { await send(socket, failureFrame(error)) } catch {} }
  } finally { abort.abort(); if (socket.readyState === OPEN) socket.close() }
}
```

帧经 `serverRequest()` 包成 `ServerRequest`（`rpcId` 复用帧自己的 rpcId，`packages/client/connection/src/websocket-downlink.ts:14-21`）。任何一端关闭 → abort 源迭代器 → 泵退出（源清理由 `iterate` 的 finally 完成，见 16.5）。发送失败且未被 abort 时补发一个 `stream/error` 帧（:36-44）——**静默断流会被当成正常断连**，客户端必须看见失败。

客户端侧：`ConnectionController` 维护重连循环，指数退避从 500ms 起（`packages/client/connection/src/client/connection.ts:20-23`：base 500、factor 2、max 10000ms），且**严格握手**：两条流的 onOpen 加上 `host.describe` 都成功才 `onConnected`（`packages/client/connection/src/client/connection.ts:12-16,47-48`；`streamOpenTimeoutMs` 默认 3000）。任一流断掉，整代连接失败并重建两条流——因为两流是同一"连接代"的生命周期。

### 16.4.3 帧的再认识：downlink 上的最小单位

**帧（frame）**：下行流上的一条消息，客户端可读的形态是 `ServerRequest`（`{ type:'server-request', rpcId, method, payload }`）。method 就是帧类型，如 `session/subscribed`、`session/event`、`session/projection`、`approval/requested`。**关键细节**：`respond` 命中的 rpcId 来自帧——纯推送帧每次新铸 rpcId（`packages/host/apiproxy/src/api-proxy.ts:452-454`），而**可应答帧**（approval/question）铸稳定 rpcId 并在服务端挂起表里登记，断线重连重放时复用（`packages/host/apiproxy/src/api-proxy.ts:3445-3447` 注释：reconnecting client can still answer them）。这就是"响应者不是请求者"的逆 RPC：服务器提出问题（要审批的，要追问的），浏览器用 `POST /api/respond` 回答（`packages/host/apiproxy/src/fetch/handler.ts:296-300`）。

## 16.5 路由与帧引擎：webserver 的匹配序与 apiproxy 的基线

### 16.5.1 webserver：exact → 最长前缀 → fallback

`WebServer` 持有四张表：`exact`、`prefixes`、`upgrades` 与唯一的 `fallback` 席位（`packages/host/webserver/src/index.ts:65-70`）。`match()`（:242-251）：

```ts
private match(pathname: string): WebRoute | undefined {
  const exact = this.exact.get(pathname)
  if (exact !== undefined) return exact
  let best: WebRoute | undefined
  for (const [prefix, route] of this.prefixes) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (best === undefined || prefix.length > best.path.length) best = route
  }
  return best
}
```

匹配序被注释钉死：**exact 命中即返回；否则最长前缀赢**（packages/host/webserver/src/index.ts:241）。三类注册各有纪律：`register` 重复 `(kind, path)` 抛错（:94-101，路由模式是组合级契约）；`registerUpgrade` 一条路径只有一个协议所有者（:109-115）；`registerFallback` 单席位、二次注册抛错（:125-131，两个 fallback 无法组合）。未匹配且无 fallback → 404；处理函数异常 → 记日志回 400，**绝不让进程因一个畸形请求退出**（:166-179）。

**为什么是这个顺序？** 因为三种路由角色不同：`/api` 前缀路由（connection 注册）是功能性入口；`/plugins/<id>/client.js` 与精确路径由 modules 注册；而 `GET /`、`/assets/...` 等一切前端资源归 fallback——fallback 是 **SPA 回退所有者**（frontend-static 借此把任何未认领路径回退成 index.html，`docs/subsystems/web-server.zh.md` 与 `packages/bundle/web-app/cordis.patch.yml:122-129` 的 web-runtime 说明互证）。若 fallback 优先，`/api` 会先被 SPA 回退吃掉；若前缀随便匹配，精确路径会被前缀误伤。exact 优先保精确性、最长前缀保"谁最长谁专业"、fallback 保"剩下的都是前端"，三者边界清晰。**（推断）**：`startswith(`${prefix}/`)` 的 `/` 边界（`/api` 不吞 `/apix`）是防"前缀幻觉"的刻意细节——注释未明说，但行文如此。

顺带一提：upgrade（WebSocket）走的是另一张表 `upgrades`，由 `server.on('upgrade')` 精确路径分发（`packages/host/webserver/src/index.ts:181-214`），与普通请求互不干扰；`tapIndex`/`applyIndexTaps` 则是"往 HTML 响应里注入脚本"的钩子（:139-145、:259-263）——`__DSH_BOOT__` 就是从这条缝进页面的（`docs/subsystems/web-server.zh.md` 同述）。

### 16.5.2 apiproxy：从宿主事件到浏览器帧

`FrameQueue`（`packages/host/apiproxy/src/api-proxy.ts:414-445`）是"核心推、迭代器拉"的异步队列：`push` 入缓冲并唤醒等待者；`iterate` 循环"有货就 yield、没货就睡、abort/end 就退"，finally 里清监听、跑清理。浏览器每连一次 `events.mux` 就建一个队列（`:3431-3432`），并塞进全局 `muxQueues` 供广播。

`events.mux` 的完整基线（packages/host/apiproxy/src/api-proxy.ts:3429-3532），一句话：**先补快照，再挂监听，最后把迭代器交给泵**。逐段看：

- 对每个已存在会话发 `session/subscribed`（packages/host/apiproxy/src/api-proxy.ts:3433-3435，`subscribeSession` 带 `lastSeq: session.seq - 1`，:479-482——客户端据此知道从哪条 seq 补历史）；
- 重放仍挂起的 questions/approvals（:3436-3447，**带稳定 rpcId**，断线重连的客户端仍可作答）；
- 队列快照基线（:3449-3456：`session/queue` 帧，重连客户端仅凭这些帧重建队列视图）+ jobs 基线（:3457-3469）；
- 建 `openCalls` 表（:3470-3473，工具调用参数对，供结果视图配对），然后挂三个监听器：`session/event`（:3475-3494：`tool/call` 登记、`turn/end` 清表，然后 `viewFor` 算出工具视图，推 `session/event` 帧**带 view**）、`session/created`（:3495-3505：补订阅）、`session/disposed`（:3506-3508）；
- `queue.iterate(signal, cleanup)`（:3528-3531）：cleanup 把队列移出 `muxQueues` 并逐个 dispose 监听器——**连接断 = 监听器卸载**，这正是第 3 章 fiber 语义在传输层的体现。

`events.host` 基线（packages/host/apiproxy/src/api-proxy.ts:3534-3636）结构相同，但源是另一批事件：`session/created`→`host/session-added`（含 `blank` 与列表字段）、`agent/status`→`host/session-status`、`domain/changed`（workspace）→`host/workspace-changed|order-changed|archived-sessions-changed`、以及白名单转发的 `API_REMOTE_FORWARDED_EVENTS`→`host/remote-event`（:3620-3633，白名单在 api-remotes 包）。

**应答路由**：`respond`（packages/host/apiproxy/src/api-proxy.ts:3696-3742）先查 `pendingApprovals` 再查 `pendingQuestions`——两个注册表共享 UUID 空间，先审批后追问；应答必须与原登记的 `approvalId`/`sessionId` 匹配，否则 `bad-response`（:3705-3707）；"合法但迟到/重复"的应答是 `not-pending`（:3712、:193 的 `RpcReceipt`）。

至此，浏览器端"怎么渲染"的最后一环：`session/event` 帧流进入 `SessionRuntime` 扇出 → `ProjectionValueStore`（`session/projection` 帧 high-seq-wins）→ `ConversationNodeAssembler` 组装 → `ui-conversation`/`ui-trajectory` 渲染（`packages/client/runtime/README.md`，**行号未验证**——该包文件未逐行复核，本节引用其 README 描述）。

## 16.6 typert 接口发现与 api gateway：第二套 /api 入口

### 16.6.1 问题：五十个手写路由够吗

`UNARY_ROUTES` 是手写的，方法增删要改表、加 schema、对齐类型。typert 的思路是**从 TypeScript 类型生成**：宿主包用 `@Remote`/`@RemoteScope` 标注方法（`docs/api-gateway.md:9-15`，文档），构建期生成"接口发现"产物——`typert.host.js/d.ts` 与 `typert.remote-client.js/d.ts`（`docs/api-gateway.md` 生成管线节；生成器 `packages/typert/generator/src/tsdown-plugin.ts` 的 `typertPlugin` 在 tsdown 写盘阶段扫描带 `./typert` 导出的包并 emitWorkspace，:38-103；产物落盘于包 `lib/` 下，:108-113）。

运行时三件套：

- **注册表（registry）**：`ctx.typert`（`packages/typert/registry/src/service.ts:446` 的 `TypertRegistry`）持有严格描述符、schema、lookups 与 contexts；`register(contribution)` 原子批量注册，重复身份/端点拒绝整批（:499-519）。**lookup（查找）**解决"宿主对象不能过线"：`TypertLookupDefinition`（`packages/typert/protocol/src/types.ts:280-291`）声明 `key/parameter/wire/hostTypeSymbol/wireTypeSymbol`——`Agent` 参数名 `agent` 在线上变成 `agentId` 字段，gateway 调 `resolve(id)` 把 id 换回宿主对象（`docs/api-gateway.md:11`）；
- **loader**：`typert-loader` 扫描导出 `./typert` 的包（`TYPERT_HOST_EXPORT`，`packages/typert/loader/src/index.ts:39`），校验 manifest（`validateTypertManifest`，:83+）后注册（`inject=['typert','loader']`，:44）；
- **gateway**：`TypertGatewayService`（`packages/api/gateway/src/index.ts:90`）注册拦截器（`inject=['typert']`，:91）。

### 16.6.2 intercept：先于 apiproxy 认领 /api

关键共存机制在 ctor（`packages/api/gateway/src/index.ts:104-111`）：

```ts
ctx.inject(['connection'], (connectionCtx) => {
  connectionCtx.connection.rpc.intercept(
    '/api',
    endpoint => this.claimsEndpoint(endpoint),
    (endpoint, payload, signal) => this.dispatchRpc(endpoint, payload, signal),
    { authority: 'trusted-host' },
  )
})
```

**拦截器先于 apiproxy 认领 `/api` 的 endpoint**（`packages/client/connection/README.md:5` 同述：a registered Typert interceptor claims its Remote endpoints before the API Proxy fallback）。`claimsEndpoint`（:114-120）：端点必须恰为两段（`<ns>/<method>`），typert 本地有严格定义或见过（`hasSeen`）即认领；否则回退 SRC 扫描——遍历 `ctx.reflect.props` 找带 `typertRemote` 绑定的服务，枚举其远程方法（:122-137）。没被认领的请求落到哪？`packages/client/connection/src/index.ts:156-158`：`ctx.get('apiProxy')` 不存在就 404，否则 `toFetchHandler(apiProxy).fetch(request)`——**两个入口共用 `/api` 前缀，互不冲突**。

### 16.6.3 invoke：严格描述符还是 SRC 弱解析

`invoke`（packages/api/gateway/src/index.ts:145-184）：`resolveDescriptor`（:224-235）先查严格定义（`typert.local.get`），查到即用；`hasSeen` 但被撤回 → 拒绝 SRC 回退（:227-233）——**严谨性一旦建立就不降级**；没有严格定义才走 SRC（`resolveSrcDescriptor` :237-263：按 `typertRemote` 绑定匹配命名空间与方法名，多候选判 `ambiguous-endpoint`）。之后：`assertExactArguments`（:586-612：不多不少、lookup id 不可省略）→ `resolveReceiverContext`（:359-405：`@RemoteScope` 时用 context provider 把线上身份解析成 scoped Context）→ 参数解析（json 直传，lookup 经 provider resolve，:407-468）→ 取消信号尾参注入（:161）→ `Reflect.apply`（:174）→ 结果 `decode`（:614-638：strict 走 schema，否则仅 JSON 安全校验——**线上不能出现函数、循环、稀疏数组**，`assertJsonValue` :640-673 是完整守卫）。入站信封：`invokeRpc`（:194-222）要求 payload 恰含 `args` 一个字段——协议对"别把业务参数散在信封里"的强约束。

浏览器侧对应物是 `ctx.remote`（`ClientRemoteService`，`api/gateway/src/client/index.ts`），`connection.rpc.call('/api', '<ns>/<method>', {args}, signal)` 落到 `POST /api/<ns>/<method>`（`docs/api-gateway.md:121`）。**为什么只有 unary**：Remote 全部是"一请求一响应"的同步方法；需要长期流的（会话事件）不走 Remote，走 16.4 的专用 downlink（`docs/api-gateway.md` Boundaries 节：只有 unary）。

## 16.7 SDK：把 harness 当子进程驱动的另一套栈

### 16.7.1 传输：换行分帧的 JSON-RPC 2.0

`packages/sdk/protocol` 定义 `JsonRpcLineTransport`（`packages/sdk/protocol/README.zh.md:9`，本节引用 README）：**每行一个紧凑 JSON 帧、以 `\n` 结尾**。带 `id`+`method` 是请求、仅 `id` 是响应、仅 `method` 是通知；非法 JSON 行被忽略；缺处理器答 `-32601`，处理器抛错答 `-32603`；错误以 `JsonRpcResponseError` 拒绝挂起的 `request()`（保留 `code` 与可选 `data`）。方法与类型表（`packages/sdk/protocol/README.zh.md:15-25`）：

| 方向 | 方法 | 载荷 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult`（持久入队回执） |
| client→server | `shutdown` | 无参 → `{}` |
| server→client | `session.event` | 每个会话的全部 `session/event`（不过滤） |
| server→client | `session.status` | agent 级 running/idle 转变 |
| server→client | `subagent.started` / `subagent.finished` | 子代理血缘（finished 仅进程内） |

实现：`HarnessSdkJsonRpcServer`（`packages/sdk/server/src/server.ts`）构造时订阅四类事件并转发为通知——`session/event`→`session.event`（:71-74）、`agent/status`→`session.status`（:75-77）、`session/created`（有 parentSession）→`subagent.started`（:78-86）、`subagent/end`（`info.local` 才发）→`subagent.finished`（:87-103）。插件入口 `sdk-jsonrpc-server`（`packages/sdk/server/src/index.ts:20-22`，`inject=['agents']`）把传输接到 stdio（:46 起）。**这一侧没有 HTTP、没有 `/api`、没有 webserver**——SDK 客户端自己 spawn 运行时进程并指定 cordis.yml；`serverInfo.name` 固定为 `deepseek-harness-sdk-runtime`（README）。

### 16.7.2 客户端两层：DeepSeekHarness 与 HarnessClient

高层 `DeepSeekHarness`（`packages/sdk/client/README.zh.md`，本节引用 README）：指定 `launch: {command, args}` 惰性启动；`start()` 记忆化 `initialize`（cwd + provider/model 路由）；`run()` 拥有一个活动区间——排队提示词 → 等 `messageId` 出现在 `agent/inbox/spliced` 回执 → 收集事件直到整个 agent 进入 `idle`，返回 `RunResult { finalResponse, events, notifications }`。注意 `finalResponse` 的定义："该区间内根会话**最后提交**的助手文本"，不保证因果归属于该提示词（steering、注入内容都可能参与）。低层 `HarnessClient`：`start/initialize/prompt/request/close`，`prompt()` 只返回 messageId；`subscribe()`/`subscribeSessionTree()` 订阅通知；`close()` 走 `shutdown`→stdin-EOF→SIGTERM→SIGKILL 阶梯（`shutdownTimeoutMs` 1000、`disposeEofGraceMs` 6000、`disposeGraceMs` 3000）。

**与 Web 协议的关系：正交**。SDK 不经 `/api`、不依赖 web 组合；但它驱动的运行时**还是同一个 harness 内核**——`session.event` 通知里流淌的还是第 8 章那套 `SessionEvent`（README 明文："协议以完整会话日志封套进行流式传输，因此会话词汇是协议格式约定的一部分"）。这就是"三端一源"的第三端。

已知限制（`packages/sdk/protocol/README.zh.md:37-39`）：无版本协商（握手只带 `serverInfo.version`，客户端不校验）、无取消与会话关闭方法（放弃轮次 = 关闭运行时进程）、server→client 请求未使用（为未来审批流预留）。

## 16.8 ACP：面向自动化客户端的互操作协议

### 16.8.1 定位

**ACP（Agent Client Protocol）** 是面向第三方自动化客户端（编辑器等）的开放协议；dsh 的 `@deepseek-ai/dsh-acp` 是它的 server 实现（`packages/acp/acp/README.md`：Automation-only Agent Client Protocol server over JSON-RPC stdio）。注意两点：它和 SDK 一样**不经 Web `/api`**；但它是**互操作协议**，配对的是进程外 subagent 客户端 `subagent/subagent-acp`（第 13 章预告），而 SDK 是 dsh 自家的进程外驱动。

### 16.8.2 方法表与实现对照

方法表（`packages/acp/acp/README.md:22-30`）：

| 方法 | 行为 |
|---|---|
| `initialize` | 协商版本；只声明 baseline 提示（无 image/audio/embedded-context），不声明会话/编辑器/终端/文件系统/MCP 能力 |
| `authenticate` | 无操作（没宣称认证方法，`authMethods: []`） |
| `session/new` | 创建全新 agent，主 `cwd` 为绝对路径；`additionalDirectories`/`mcpServers` 只接受空值 |
| `session/prompt` | 拼接 text blocks、渲染 baseline 资源链接为文本引用、拒绝空输入；每会话同时只有一个 in-flight；等整个 agent idle |
| `session/cancel` | 只取消寻址 agent，未知 id 是 no-op |
| `session/update` | 每个已提交 `assistant/message` 的非空 text block 发一条 `agent_message_chunk` |
| `session/request_permission` | 对带工具调用 id 的审批给出一次性的 allow/reject 选择 |

实现要点（`packages/acp/acp/src/index.ts`）：`name='acp'`、`inject=['agents']`（:42-44）；`session/event` 监听只挑 `assistant/message` 的 text block（图片变成 `[image attachment …]` 文本占位），**原始 chunk、推理、工具、计划、标题、重试标记全部不上线**（:152-196）——README 定性为"Committed-message output intentionally trades token-by-token latency for a clean automation result"（:34）；`approval/request` → `requestPermission`（allow-once/reject-once，:215-229，水印"never infers a durable grant"）；`initialize` 返回 `agentCapabilities.promptCapabilities { image:false, audio:false, embeddedContext:false }` 与 `authMethods: []`（:231-245）；`newSession` 校验参数后 `agents.create({ sessionId, meta:{ cwd }, agentOptions })`（:251-275）；连接建立在 `new AgentSideConnection(makeAgent, stream)`（:353）。

**限制**（`packages/acp/acp/README.md:78-80`）：只支持全新会话（load/list/resume/delete/fork 都无）、baseline prompts 与单一工作区、只输出已提交答案、连接生命周期=会话生命周期。**（推断）**：这些限制共同指向"自动化一次性任务"的定位——编辑器类客户端要么走 Web GUI，要么接受这一窄能力剖面（narrow profile）。

## 16.9 安全收束：拒绝 `--host 0.0.0.0` 之后

### 16.9.1 默认与拒绝

`packages/bundle/web-app/cordis.patch.yml` 把 webserver 默认钉在回环：`host: !!js ctx.webStartup.host ?? '127.0.0.1'`、`port: !!js ctx.webStartup.port ?? 3080`（:115-120）。webserver 的 `Config.host` 连类型都只允许两个字面量（`packages/host/webserver/src/index.ts:45-50`）。若显式指定 `--host 0.0.0.0`，`web-startup` 直接报错退出（`packages/bundle/web-app/src/startup.ts:69-71`）：

```ts
if (options.host === '0.0.0.0') {
  program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: '
    + 'it would expose remote code execution to the network; use 127.0.0.1 instead')
}
```

**推导其安全考量**：`/api` 暴露的能力是"以该进程身份执行用户代码"——`session.prompt` 落进 agent-loop，agent 能读写工作区、跑 shell（组合默认自带 bash 与文件系统工具，`packages/client/connection/src/index.ts:99-103` 注释直言：any caller that may start a session at all can already run commands as this process）。这种面如果绑到 `0.0.0.0`，任何能触达网卡的人都发一条 POST 就能执行代码。而**现存的信任栅栏不是认证**：`trustedHosts` 只是 DNS-rebinding 围栏（`packages/client/connection/src/index.ts:76-83`），`host.pickDirectory`、`settings.*`、`credentials.*` 等 16 个特权方法只在回环可调（`PRIVILEGED_METHODS`，:89-119）。因此总体结论：**在真正的认证层出现之前，网络可达性必须是一等公民决策**——要么是用户显式声明的 trusted-host（需要 `--trusted-host`，且仍不覆盖回环特权面），要么干脆拒绝。CSRF 的 415 是应用层的第二道闸（16.3），host 栅栏是第一道（16.3 第 2 跳），426 是第三条"宁可显式失败"的纪律（16.4）。

还有一处值得留意的产品细节：`directory-picker-auto` 在 boot 时按宿主事实一次采样——**绑定不是回环就强制浏览器端目录选择**（`packages/host/directory-picker-auto/src/resolve.ts:40-53`，`bindHost !== '127.0.0.1' → browse`），因为 OS 原生对话框在远程浏览器场景够不着。这也印证了本章的主题：**产品外围面的每一处"端"的选择，都服务于同一个安全前提——宿主与浏览器之间的边界必须是明确、可声明、且宁可拒绝的**。

## 16.10 本章小结

1. **三端一源**：浏览器 UI、宿主服务侧、进程外驱动（SDK/ACP）共享同一事件源——会话日志；在线协议（HTTP POST 一元 + 两条 downlink WS）与进程外协议（stdio JSON-RPC）是两套独立栈（16.1）。
2. **浏览器 boot 两阶段**：模块面建 `ClientModuleSystem` 解析宿主注入的 `window.__DSH_BOOT__`（`packages/client/modules/src/client/manifest.ts:108-143`），插件面挂 vendored Loader、每图行一 entry、静默后全量 fiber 清扫（`packages/client/web/src/boot.tsx:97-237`）。
3. **上行一条命令的七跳**：webserver 收 → 信任栅栏 → `http-bridge` 翻译成 fetch → `toFetchHandler`（强制 `application/json`，415 防 CSRF；业务错误 200 + `ServerResponse`）→ `UNARY_ROUTES` 查表 → 域方法（`session.prompt` 经 `turnAgentFor` 到 `agent.followup/steer`）→ 按 `rpcId` 应答（16.3）。
4. **下行两条 downlink-only 流**：`events.mux`（会话事件 + 可应答帧）与 `events.host`（workspace/agent 变化）；客户端不发消息（1008）；SSE 编码只服务同进程载体（`packages/host/apiproxy/src/fetch/handler.ts:254-259`、`packages/client/connection/src/index.ts:150-155` 的 426 是证据）（16.4）。
5. **路由与帧引擎**：webserver 匹配序 exact → 最长前缀 → fallback（`packages/host/webserver/src/index.ts:242-251`）；`FrameQueue` 的"核心推、迭代器拉"，`events.mux` 基线"先快照后监听"，`respond` 先审批后追问（`packages/host/apiproxy/src/api-proxy.ts:3429-3532`、:3696-3742）（16.5）。
6. **typert 发现 + gateway 拦截**：构建期生成描述符，运行时 `ctx.typert` 注册、`intercept('/api', …)` 先认领两段 endpoint，`invoke` 走 strict 描述符或 SRC 弱解析，严格与 SRC 之间**只降不升**（`packages/api/gateway/src/index.ts:104-120`、:224-235）（16.6）。
7. **SDK 与 ACP**：换行分帧 JSON-RPC 2.0（`initialize`/`session/prompt`/`shutdown` + 四类通知）；ACP 方法表窄而明确（全新会话、committed text、一次性权限），两者都不经 `/api`（16.7/16.8）。
8. **安全姿态**：默认回环 3080，`--host 0.0.0.0` 被明确拒绝（`packages/bundle/web-app/src/startup.ts:69-71`）；信任栅栏是可达性策略不是认证；特权方法钉死回环（16.9）。

## 16.11 分层练习

**理解层**
1. 不看源码，写出浏览器侧一条 `session.prompt` 从键盘到 `agent.followup` 经过的 7 跳，标注每一跳所在文件。
2. 用三句话解释：为什么浏览器 GET `/api/events.mux` 得到 426，而同进程载体却用 SSE 读同一条流？（`packages/host/apiproxy/src/fetch/handler.ts:254-259` 与 `packages/client/connection/src/index.ts:150-155` 对照。）

**应用层**
3. 一个恶意页面想通过 `<form method="POST" enctype="text/plain">` 触发 `session.cancel`，服务器在哪一层、用哪个状态码挡住它？如果它改用 `application/json` 发呢？（提示：与 CORS 预检的关系。）
4. 用户开着 Web UI 时断网 30 秒又恢复。结合 `events.mux` 基线（`packages/host/apiproxy/src/api-proxy.ts:3429-3532`）与 `ConnectionController` 的严格握手，说明客户端靠哪些帧恢复视图；若断线期间恰好有一笔待审批，为什么重连后仍能作答？

**综合层**
5. `UNARY_ROUTES`（`packages/host/apiproxy/src/fetch/handler.ts:90-143`）里挑 5 个方法，往 `PRIVILEGED_METHODS`（`packages/client/connection/src/index.ts:89-119`）的取舍逻辑上归类：为什么 `llm.discoverModels` 在而 `llm.models` 不在？为什么 `agentPreset.select` 不在而 `agentPreset.read` 在？
6. 设计一个局域网部署：宿主要求同一台机器上的另一台设备（`192.168.1.50`）用浏览器访问。写出需要的最小配置组合（`--host`、`--trusted-host`、目录选择后端），并指出**为什么不能直接 `--host 0.0.0.0`**；再列出 3 个必须钉在回环的调用面。

**挑战层**
7. 假设你想给 ACP 加 `session/load`（恢复既有会话）。对照 `packages/acp/acp/README.md` 的限制清单与 `packages/api/gateway/src/index.ts:251-275` 的 `newSession` 实现，指出：它需要复用哪些宿主设施（提示：冷恢复、`turnAgentFor` 的围栏语义），会破坏 ACP 的哪条现存承诺（"连接生命周期=会话生命周期"），并给出你的取舍论证。
8. 对比 SDK 的 `session.event` 通知与浏览器 `events.mux` 的 `session/event` 帧：二者同源于 `session/event` 事件（`packages/sdk/server/src/server.ts:71-74` vs `packages/host/apiproxy/src/api-proxy.ts:3475-3494`），但一个带 view、一个不带。从"消费方是谁、渲染需要什么"出发，论证这种分叉是否合理，以及如果让 SDK 也带 view 会引入什么协议负担。

## 16.12 延伸阅读

- `packages/client/web/README.md`：浏览器 shell 两阶段 boot 的官方叙述（本章 16.2 依据；`src/boot.tsx` 是实现全文）。
- `packages/client/modules/src/client/manifest.ts` 与 `packages/client/modules/README.md`：`__DSH_BOOT__` 的 wire 形状与惰性 CJS 模块表；`docs/subsystems/client-modules.zh.md`：Node 半如何扫描 `dsh.client` 并注入 manifest。
- `packages/host/webserver/README.md` 与 `docs/subsystems/web-server.zh.md`：路由注册纪律（重复抛错、fallback 单席位）与 400/404 语义。
- `packages/client/connection/README.md`：载体抽象、"HTTP POST + 双 downlink WS"与 426 无 SSE 回退的定性。
- `packages/host/apiproxy/src/api/rpc.ts`：四象限消息模型与 `RpcId`/`RpcReceipt`（线上协议的最小词汇表）。
- `docs/api-gateway.md` 与 `docs/api-gateway.zh.md`：`@Remote`/`@RemoteScope` 编程模型、生成管线（`build:lib:host → lib:client → build:web`）与"只有 unary"的边界。
- `packages/typert/README.zh.md` 与 `docs/subsystems/typert.zh.md`：registry/loader/generator 三件套与 `TypertLookupDefinition`。
- `packages/sdk/protocol/README.zh.md`、`packages/sdk/client/README.zh.md`、`packages/sdk/server/README.zh.md`：SDK 协议、两层客户端与 close 阶梯。
- `packages/acp/acp/README.md`：ACP 方法表、committed-text 权衡与生命周期；配对客户端见 `packages/subagent/subagent-acp/README.md`。
- `packages/bundle/web-app/cordis.patch.yml` 与 `packages/bundle/web-app/README.zh.md`：web profile 组合的权威定义（host/port 默认与 `--host 0.0.0.0` 拒绝）。
- `docs/user/guide/index.zh.md`：Web UI 使用顺序（配置模型 → 选择工作区 → 运行任务），与本章"工作区先于会话"的运行时设计互证。
