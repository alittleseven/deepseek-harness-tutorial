# 附录 C　源码文件清单与参考文献

> 本附录两部分：C.1 由教程全部章节正文中出现的 `包路径:行号` 引用**程序化汇总去重**生成（写作时仓库状态：commit `47f943859bef60e4160492346772ded9b24f765a`，2026-08-13 merge PR #2519）；C.2 为参考文献（仓库官方文档 + 外部资源 + 各章延伸阅读索引）。行号与正文引用一致；仓库升级后行号可能漂移，函数名/事件名不变。

### C.1　源码文件清单

> 按仓库顶级目录分组，共 264 个被引用文件（vendor 20、packages 217、apps 11、docs 11、examples 5、.agents 0）；行号为各章正文引用的并集（相邻行号已合并）。

## C.1.1　vendor/（vendored 框架，20 个）

- `vendor/README.md` —— 引用行：3-5, 16-20, 33-50
- `vendor/cordis/package.json` —— 引用行：4, 23
- `vendor/cordis/src/context.ts` —— 引用行：16-41, 46, 71-84, 94, 99-145
- `vendor/cordis/src/events.ts` —— 引用行：1, 13-15, 24-109, 112-117, 120-123, 131, 134-156, 165-175, 183-243, 254-275, 288-302, 312-318, 329-352
- `vendor/cordis/src/fiber.ts` —— 引用行：19-36, 50-62, 74, 83-93, 139-154, 176-210, 222-228, 235-245, 250-261, 265-297, 302, 314-333, 402-522, 574-694, 704-710, 718-723, 736-753
- `vendor/cordis/src/index.ts` —— 引用行：1-14
- `vendor/cordis/src/logger.ts` —— 引用行：239-269
- `vendor/cordis/src/reflect.ts` —— 引用行：80-91, 135-197, 208-211, 219-222, 233-243, 254-265, 277-336, 345-353, 408-417
- `vendor/cordis/src/registry.ts` —— 引用行：92-95, 185, 207-209, 222-228, 300-302, 319, 322-335
- `vendor/cordis/src/service.ts` —— 引用行：5-10, 42-59, 65-73, 86-102
- `vendor/cordis/src/utils.ts` —— 引用行：14-31, 79-89, 226-233
- `vendor/cosmokit/src/misc.ts` —— 引用行：72
- `vendor/include/src/index.ts` —— 引用行：9-15, 23, 43-53, 58-128, 144-156, 161-170, 182, 206-213, 250-251, 261-263, 296-306, 315-321
- `vendor/loader/src/config/entry.ts` —— 引用行：9-22, 52-61, 66-68, 75-81, 84-98, 104-108, 114-122, 142-246, 291-302
- `vendor/loader/src/config/group.ts` —— 引用行：6-14, 20-21, 59-106, 116-128
- `vendor/loader/src/config/isolate.ts` —— 引用行：5-9, 96-153
- `vendor/loader/src/config/tree.ts` —— 引用行：8, 46-73
- `vendor/loader/src/config/utils.ts` —— 引用行：5-9, 12-22, 25-27
- `vendor/loader/src/index.ts` —— 引用行：92-109
- `vendor/schemastery/src/index.ts` —— 引用行：275-292

## C.1.2　packages/（217 个）

### packages/

- `packages/README.md` —— 引用行：11-59
### packages/acp/

- `packages/acp/acp/README.md` —— 引用行：22-30, 78-80
### packages/api/

- `packages/api/gateway/src/index.ts` —— 引用行：90, 104-120, 145-184, 251-275
### packages/attachment/

- `packages/attachment/attachment-local/src/index.ts` —— 引用行：15-21
- `packages/attachment/attachment-local/src/store.ts` —— 引用行：204-221
### packages/boot/

- `packages/boot/app-boot/src/index.ts` —— 引用行：232-265, 278-287, 320-338, 348-356, 360-365, 379-473, 486-529, 609-649, 658-664, 692-725, 747, 757-802
- `packages/boot/app-boot/src/profile.ts` —— 引用行：5-13, 41-70, 104-117, 120-125, 148-149, 152-168, 210-212, 223-255, 297-312, 344-355, 366-420
### packages/bundle/

- `packages/bundle/README.zh.md` —— 引用行：5, 13
- `packages/bundle/base/cordis.patch.yml` —— 引用行：1-451
- `packages/bundle/base/package.json` —— 引用行：36-40
- `packages/bundle/headless/README.zh.md` —— 引用行：5-7
- `packages/bundle/headless/cordis.patch.yml` —— 引用行：1-35
- `packages/bundle/web-app/README.zh.md` —— 引用行：5
- `packages/bundle/web-app/cordis.patch.yml` —— 引用行：8-12, 16-41, 47-273, 276-291, 299-307, 420-424
- `packages/bundle/web-app/src/startup.ts` —— 引用行：69-71
### packages/client/

- `packages/client/connection/README.md` —— 引用行：5, 13
- `packages/client/connection/src/api-path.ts` —— 引用行：8-14
- `packages/client/connection/src/api-request-trust.ts` —— 引用行：96-108
- `packages/client/connection/src/client/connection.ts` —— 引用行：12-16, 20-23
- `packages/client/connection/src/client/web-api-client.ts` —— 引用行：13-16
- `packages/client/connection/src/http-bridge.ts` —— 引用行：9, 12, 32-99
- `packages/client/connection/src/index.ts` —— 引用行：76-83, 89-119, 150-158, 161-195
- `packages/client/connection/src/websocket-downlink.ts` —— 引用行：14-21, 64-82, 109-111, 144-153
- `packages/client/modules/src/client/manifest.ts` —— 引用行：50-69, 91-99, 108-143
- `packages/client/web/README.md` —— 引用行：5
- `packages/client/web/src/boot.tsx` —— 引用行：2-6, 97-237
- `packages/client/web/src/seed.ts` —— 引用行：25-40
### packages/code-runtime/

- `packages/code-runtime/code-runtime-worker-thread/src/index.ts` —— 引用行：378-393
- `packages/code-runtime/code-runtime/src/index.ts` —— 引用行：102-135
- `packages/code-runtime/code-runtime/src/types.ts` —— 引用行：73-108
### packages/compaction/

- `packages/compaction/command-compact/src/index.ts` —— 引用行：66
- `packages/compaction/compaction-basic/src/config.ts` —— 引用行：95, 144
- `packages/compaction/compaction-basic/src/index.ts` —— 引用行：129, 139-194
- `packages/compaction/compaction-basic/src/region.ts` —— 引用行：98-118, 305
- `packages/compaction/compaction-basic/src/summarizer.ts` —— 引用行：111-116
- `packages/compaction/compaction-tool-result-pruner/src/index.ts` —— 引用行：44
- `packages/compaction/compaction/src/index.ts` —— 引用行：27-34, 96, 113, 164
- `packages/compaction/compaction/src/tool-pairing.ts` —— 引用行：117
### packages/context/

- `packages/context/agent-instructions/src/index.ts` —— 引用行：125
- `packages/context/time-context/src/index.ts` —— 引用行：170
- `packages/context/tmux-context/src/index.ts` —— 引用行：7-14
### packages/core/

- `packages/core/agent-loop/src/agent.ts` —— 引用行：38-46, 64, 94-95, 104-162, 172-208, 213-220, 225-243, 255, 267-271, 279-296, 300, 303-315, 318-319, 332-401, 407-495
- `packages/core/agent-loop/src/constants.ts` —— 引用行：6
- `packages/core/agent-loop/src/index.ts` —— 引用行：300-311, 351-353
- `packages/core/agent-loop/src/runtime-context.ts` —— 引用行：64-75
- `packages/core/agent-loop/src/tool-calls.ts` —— 引用行：1-11, 59-110, 121-246, 249-259, 262-289
- `packages/core/agent/src/dispatch.ts` —— 引用行：107-149
- `packages/core/agent/src/inbox.ts` —— 引用行：24-26, 63-65, 71-78, 203-219
- `packages/core/agent/src/index.ts` —— 引用行：250-254, 259
- `packages/core/agent/src/runtime-types.ts` —— 引用行：35-41, 50-58, 78-85, 96-99, 106-143, 146-291
- `packages/core/agent/src/types.ts` —— 引用行：19-24
- `packages/core/scope/README.zh.md` —— 引用行：5, 11, 27
- `packages/core/scope/src/index.ts` —— 引用行：15, 154-156, 159-164, 170-183
- `packages/core/scope/src/store.ts` —— 引用行：159-266
- `packages/core/session/src/chunk-rows.ts` —— 引用行：6-7, 10-14, 65-67
- `packages/core/session/src/index.ts` —— 引用行：1-7, 54, 76, 197-210, 213-250, 363-372, 377-379, 415, 454, 482-484, 495-548, 564-567, 599-600, 604-655, 670-680, 691-706, 717-723, 726-747, 755-757, 779-784, 789-792, 863-889, 913-947, 968-996, 1022-1039, 1081-1138
- `packages/core/session/src/invariant.ts` —— 引用行：1-6
- `packages/core/session/src/json.ts` —— 引用行：13, 16-49, 70-163, 177-179
- `packages/core/session/src/request-header.ts` —— 引用行：21-31, 44-54, 65-71
- `packages/core/session/src/surface.ts` —— 引用行：83-114, 136-142, 185-194, 211-243, 350-379, 387-395, 404, 421-429, 444-459
- `packages/core/session/src/types.ts` —— 引用行：33-56, 61-174, 189-194, 228, 231-336, 343-346, 359-436
- `packages/core/system-prompt/src/index.ts` —— 引用行：53-75, 134, 212-217, 251-255, 258-295, 353-376, 381-390, 398-407, 415-421, 430-436, 446-455, 467-542
- `packages/core/tools/README.zh.md` —— 引用行：22, 27, 35, 39, 43-45, 58-59, 68-90, 95, 114, 120
- `packages/core/tools/src/code-mode.ts` —— 引用行：294-654
- `packages/core/tools/src/index.ts` —— 引用行：137, 150-197, 222-288, 324, 391-394, 427-430, 451-460, 558, 703-711, 714-754, 787-837, 1020-1022, 1037-1062, 1071-1098, 1137-1143, 1152-1193, 1256-1267, 1276-1285, 1342-1344, 1364-1451, 1459-1507, 1532-1560, 1569-1599, 1609-1621, 1631-1646, 1649-1654, 1657-1676, 1742-1781, 1793-1823, 1847-1862, 1866-1868, 1889-1916
- `packages/core/tools/src/schema.ts` —— 引用行：483-535, 545-617
- `packages/core/tools/tests/execution-mode.spec.ts` —— 引用行：16-21
### packages/credentials/

- `packages/credentials/credentials-local/src/index.ts` —— 引用行：5-10, 30-32, 103-122, 309-317, 336-339
- `packages/credentials/credentials/src/index.ts` —— 引用行：60
### packages/extensions/

- `packages/extensions/cordis-host-runner/src/index.ts` —— 引用行：248-312, 456-479
- `packages/extensions/cordis-host-runner/src/registry.ts` —— 引用行：154-159, 165-167
- `packages/extensions/cordis-host-runner/src/sandbox.ts` —— 引用行：96-108
- `packages/extensions/tool-cordis/README.md` —— 引用行：12, 21-23, 102
- `packages/extensions/tool-cordis/src/index.ts` —— 引用行：42, 61, 97, 149-236, 241, 330, 352, 381-398, 497-506
### packages/feedback/

- `packages/feedback/command-feedback/src/index.ts` —— 引用行：16, 62
- `packages/feedback/message-feedback/src/index.ts` —— 引用行：150
- `packages/feedback/message-feedback/src/spec.ts` —— 引用行：85-86
### packages/fs/

- `packages/fs/fs-local/src/fsio.ts` —— 引用行：533
- `packages/fs/fs-local/src/index.ts` —— 引用行：64-263
- `packages/fs/fs-observation-policy/src/index.ts` —— 引用行：1-7, 28, 106-129
- `packages/fs/fs-sandbox/src/index.ts` —— 引用行：59-149
- `packages/fs/fs/src/index.ts` —— 引用行：4-7, 44-77, 81-82, 86-250
- `packages/fs/fs/src/types.ts` —— 引用行：175-188, 192-194
- `packages/fs/tool-fs/src/edit.ts` —— 引用行：126, 141
- `packages/fs/tool-fs/src/index.ts` —— 引用行：21-23, 54-79
- `packages/fs/tool-fs/src/read.ts` —— 引用行：76-83, 160-162
- `packages/fs/tool-fs/src/session-cwd.ts` —— 引用行：6-7
- `packages/fs/tool-fs/src/write.ts` —— 引用行：111, 122
### packages/goal/

- `packages/goal/goal/src/fold.ts` —— 引用行：134
- `packages/goal/goal/src/index.ts` —— 引用行：183, 187, 205-206
- `packages/goal/goal/src/runtime.ts` —— 引用行：8
### packages/guard/

- `packages/guard/repeat-tool-reminder/src/index.ts` —— 引用行：46, 130-138
- `packages/guard/timeout-policy/src/index.ts` —— 引用行：23-24, 41-46, 54-80
### packages/hooks/

- `packages/hooks/hook-protocol/README.md` —— 引用行：5, 14-18
- `packages/hooks/hook-protocol/src/codec.ts` —— 引用行：65-67
- `packages/hooks/hook-protocol/src/events.ts` —— 引用行：53, 75, 92
- `packages/hooks/hook-protocol/src/merge.ts` —— 引用行：3-6
- `packages/hooks/hook-protocol/src/runner.ts` —— 引用行：67
- `packages/hooks/hooks-claude-code/README.md` —— 引用行：7
- `packages/hooks/hooks-claude-code/src/index.ts` —— 引用行：53-77
- `packages/hooks/hooks-codex/README.md` —— 引用行：5-11, 15
- `packages/hooks/hooks-codex/src/index.ts` —— 引用行：130
### packages/host/

- `packages/host/apiproxy/src/api-proxy.ts` —— 引用行：414-445, 452-454, 1850, 2461-2517, 3102-3104, 3429-3636, 3696-3742
- `packages/host/apiproxy/src/api/agent-presets.ts` —— 引用行：62-69
- `packages/host/apiproxy/src/api/rpc.ts` —— 引用行：150-186
- `packages/host/apiproxy/src/fetch/client.ts` —— 引用行：520-536
- `packages/host/apiproxy/src/fetch/handler.ts` —— 引用行：1-7, 90-143, 146-148, 163-167, 178-192, 203-236, 243-319
- `packages/host/directory-picker-auto/src/resolve.ts` —— 引用行：40-53
- `packages/host/webserver/src/index.ts` —— 引用行：45-50, 65-70, 148-214, 241-251
### packages/identity/

- `packages/identity/anonymous-user-id/src/index.ts` —— 引用行：29
### packages/interaction/

- `packages/interaction/commands/src/index.ts` —— 引用行：23
- `packages/interaction/permission-presets/src/index.ts` —— 引用行：19-27, 159
- `packages/interaction/user-approval/src/index.ts` —— 引用行：17-73, 94, 142-147, 257-276
- `packages/interaction/user-approval/src/types.ts` —— 引用行：29
### packages/jobs/

- `packages/jobs/jobs-local/src/index.ts` —— 引用行：165, 416-450
- `packages/jobs/jobs/src/index.ts` —— 引用行：47-48, 62
- `packages/jobs/jobs/src/types.ts` —— 引用行：17
### packages/llm/

- `packages/llm/llm-deepseek/src/adapter.ts` —— 引用行：31-43, 133-140, 175-345
- `packages/llm/llm-deepseek/src/index.ts` —— 引用行：4-7, 161-276
- `packages/llm/llm-deepseek/src/serialize.ts` —— 引用行：124-129, 144-148
- `packages/llm/llm-deepseek/src/sse.ts` —— 引用行：28-40
- `packages/llm/llm-deepseek/src/translate.ts` —— 引用行：86-185
- `packages/llm/llm-retry/README.zh.md` —— 引用行：5
- `packages/llm/llm-retry/src/index.ts` —— 引用行：99-226
- `packages/llm/llm/src/assembler.ts` —— 引用行：36-163
- `packages/llm/llm/src/call-config.ts` —— 引用行：66-69, 88-117
- `packages/llm/llm/src/index.ts` —— 引用行：46-64, 103-110, 158-159, 162-166, 180-233, 239-257, 296-322, 338-413, 431-484, 779-820, 867-869, 917-926
- `packages/llm/llm/src/message.ts` —— 引用行：129-156, 231-245
- `packages/llm/llm/src/retry-policy.ts` —— 引用行：18-24
- `packages/llm/llm/src/types.ts` —— 引用行：23, 40-51, 146-160, 163-187, 199, 246, 270-277, 291-303, 312-317, 320-356
- `packages/llm/token-meter/README.zh.md` —— 引用行：7-11, 20, 24-36, 52
- `packages/llm/token-meter/src/estimate.ts` —— 引用行：13, 16-19
- `packages/llm/token-meter/src/index.ts` —— 引用行：60-64, 74, 87-91
### packages/lsp/

- `packages/lsp/lsp-stdio/src/index.ts` —— 引用行：47
- `packages/lsp/lsp/src/index.ts` —— 引用行：82-150
- `packages/lsp/lsp/src/types.ts` —— 引用行：17
### packages/plan/

- `packages/plan/plan-mode/src/index.ts` —— 引用行：129-138, 293-301, 305-380
### packages/preset/

- `packages/preset/agent-presets/README.md` —— 引用行：5-7, 24, 31, 35, 131, 150
- `packages/preset/agent-presets/README.zh.md` —— 引用行：1-5
- `packages/preset/agent-presets/src/discovery.ts` —— 引用行：26
- `packages/preset/agent-presets/src/index.ts` —— 引用行：316-325, 380-393, 458-472, 491-534, 538-560
- `packages/preset/agent-presets/src/mount.ts` —— 引用行：110
### packages/sandbox/

- `packages/sandbox/sandbox-local/src/index.ts` —— 引用行：250, 316-332
- `packages/sandbox/sandbox-local/src/profiles.ts` —— 引用行：16-23, 51-58
- `packages/sandbox/sandbox-policy/src/index.ts` —— 引用行：101-110
- `packages/sandbox/sandbox-policy/src/session-mode.ts` —— 引用行：33, 69-70
- `packages/sandbox/sandbox/src/index.ts` —— 引用行：100-107, 124-144, 158-176
### packages/schedule/

- `packages/schedule/schedule/src/domain.ts` —— 引用行：21
### packages/sdk/

- `packages/sdk/protocol/README.zh.md` —— 引用行：9, 15-25, 37-39
- `packages/sdk/server/src/index.ts` —— 引用行：20-22
- `packages/sdk/server/src/server.ts` —— 引用行：71-74
### packages/session-query/

- `packages/session-query/session-query-sqlite/README.zh.md` —— 引用行：9
- `packages/session-query/session-query-sqlite/src/schema.ts` —— 引用行：127-136
- `packages/session-query/session-query/src/corpus.ts` —— 引用行：32
### packages/session/

- `packages/session/session-checkpoint-policy/src/index.ts` —— 引用行：70-75
- `packages/session/session-persistence-jsonl/src/format.ts` —— 引用行：147-167, 272-378
- `packages/session/session-persistence-jsonl/src/index.ts` —— 引用行：20, 122, 145, 422-429, 436-444, 514-526, 529-569
- `packages/session/session-persistence-jsonl/src/win32.ts` —— 引用行：1-12
- `packages/session/session-persistence-jsonl/src/zstd.ts` —— 引用行：48
- `packages/session/session-persistence-sqlite/src/index.ts` —— 引用行：100, 106, 160-164, 173-175, 284-302, 309-338, 341, 385-411
- `packages/session/session-persistence-sqlite/src/schema.ts` —— 引用行：58-67, 116-147, 232-270
- `packages/session/session-persistence/src/coordinator.ts` —— 引用行：22, 30, 127, 588, 633-658, 669-710, 720-747, 756-775, 934-963, 1086-1137
- `packages/session/session-persistence/src/index.ts` —— 引用行：84, 96, 126-129, 155-168
- `packages/session/session-projection-cache/src/index.ts` —— 引用行：71, 213
- `packages/session/session-projection-cache/src/spec.ts` —— 引用行：7-8
- `packages/session/session-projection/src/index.ts` —— 引用行：42-74
- `packages/session/session-title/src/index.ts` —— 引用行：60, 248-255, 309-317
### packages/settings/

- `packages/settings/settings-file/src/index.ts` —— 引用行：55-65, 210-231
- `packages/settings/settings/src/index.ts` —— 引用行：19
### packages/shell/

- `packages/shell/bash-local/src/index.ts` —— 引用行：102-331
- `packages/shell/bash-sandbox/src/index.ts` —— 引用行：75
- `packages/shell/shell/src/index.ts` —— 引用行：1-3, 48-50, 85-100
- `packages/shell/tool-bash/src/index.ts` —— 引用行：203-226, 259-269
### packages/skill/

- `packages/skill/skill-filesystem/src/index.ts` —— 引用行：36-40, 241-261, 672, 803-813, 937-947, 993-997
- `packages/skill/skill/src/index.ts` —— 引用行：20, 27, 357, 501
- `packages/skill/tool-skill/src/index.ts` —— 引用行：138
### packages/spill/

- `packages/spill/spill-local/src/index.ts` —— 引用行：37, 47
- `packages/spill/spill-local/src/store.ts` —— 引用行：20-29, 100-106
### packages/storage/

- `packages/storage/storage-domain/src/domain.ts` —— 引用行：5
- `packages/storage/storage-domain/src/events.ts` —— 引用行：46
- `packages/storage/storage-domain/src/spec.ts` —— 引用行：35-44
- `packages/storage/storage-json/src/index.ts` —— 引用行：2-4
- `packages/storage/storage/src/backend.ts` —— 引用行：17-27
### packages/subagent/

- `packages/subagent/subagent-acp/src/index.ts` —— 引用行：143-149
- `packages/subagent/subagent-claude-code/src/index.ts` —— 引用行：53-55
- `packages/subagent/subagent-codex/src/index.ts` —— 引用行：47-50
- `packages/subagent/subagent-fork-in-process/src/index.ts` —— 引用行：7-9, 48-72
- `packages/subagent/subagent-in-process-driver/src/index.ts` —— 引用行：102-163
- `packages/subagent/subagent-in-process-driver/src/structured.ts` —— 引用行：105-111, 116-131
- `packages/subagent/subagent-spawn-in-process/src/index.ts` —— 引用行：38-56
- `packages/subagent/subagent/src/child-agent.ts` —— 引用行：174, 199-224
- `packages/subagent/subagent/src/descriptor.ts` —— 引用行：8-19, 47-83, 289
- `packages/subagent/subagent/src/index.ts` —— 引用行：414-425, 433-446, 481-496
- `packages/subagent/subagent/src/types.ts` —— 引用行：23-26, 46-91, 100-149, 200-211, 249-275, 285-323
- `packages/subagent/tool-subagent/src/index.ts` —— 引用行：23, 167-197, 211-236, 247-265, 401-422
### packages/subprocess/

- `packages/subprocess/subprocess-local/src/index.ts` —— 引用行：1-7, 79-102
- `packages/subprocess/subprocess-local/src/spawn.ts` —— 引用行：260-315, 358-361
- `packages/subprocess/subprocess/src/index.ts` —— 引用行：60-66, 89-93, 118-139
- `packages/subprocess/subprocess/src/types.ts` —— 引用行：69-104
### packages/terminal/

- `packages/terminal/terminal-bash/src/index.ts` —— 引用行：34-53, 102-148
- `packages/terminal/terminal/src/index.ts` —— 引用行：105-474
- `packages/terminal/tool-terminal/src/index.ts` —— 引用行：163
### packages/todo/

- `packages/todo/tool-todo/src/index.ts` —— 引用行：26, 42, 149, 217-220
### packages/typert/

- `packages/typert/loader/src/index.ts` —— 引用行：39
- `packages/typert/protocol/src/types.ts` —— 引用行：280-291
- `packages/typert/registry/src/service.ts` —— 引用行：446
### packages/util/

- `packages/util/home-paths/src/index.ts` —— 引用行：87-91
- `packages/util/launch-environment/src/index.ts` —— 引用行：78-103
### packages/web/

- `packages/web/tool-web/src/index.ts` —— 引用行：27
- `packages/web/web-search-deepseek/src/provider.ts` —— 引用行：178
- `packages/web/web/src/index.ts` —— 引用行：62-164
- `packages/web/web/src/types.ts` —— 引用行：101-113
### packages/workflow/

- `packages/workflow/workflow-worker-thread/src/host.ts` —— 引用行：149, 200
- `packages/workflow/workflow-worker-thread/src/runtime.ts` —— 引用行：249
- `packages/workflow/workflow/src/index.ts` —— 引用行：157
### packages/workspace/

- `packages/workspace/workspace/src/index.ts` —— 引用行：92, 129-133
- `packages/workspace/workspace/src/spec.ts` —— 引用行：19-27, 67-70

## C.1.3　apps/（11 个）

- `apps/cli/config/agent-presets/standard/agent.cordis.yml` —— 引用行：1-18, 52-55, 100-124, 137-155
- `apps/cli/config/agent-presets/standard/preset.yml` —— 引用行：1-3
- `apps/cli/reference/README.md` —— 引用行：9, 13, 17, 25-30, 43-51, 64
- `apps/cli/src/args.ts` —— 引用行：4-13, 20-48, 51-61, 66-70, 89-102, 112-190
- `apps/cli/src/bin.ts` —— 引用行：2-5, 20-52
- `apps/cli/src/dump-config.ts` —— 引用行：1-6, 24-27, 30-52
- `apps/cli/src/plugin.ts` —— 引用行：123
- `apps/cli/src/process-shutdown.ts` —— 引用行：4, 22-77
- `apps/cli/src/profile-boot.ts` —— 引用行：35, 49-51, 59-64, 70-75, 92-93, 98-103, 121-137, 142-171, 174-183, 207-300
- `apps/cli/tests/built-bin.e2e.ts` —— 引用行：707, 719-721, 724-761
- `apps/web/src/main.ts` —— 引用行：1-10

## C.1.4　docs/（11 个）

- `docs/api-gateway.md` —— 引用行：9-15, 121
- `docs/architecture.md` —— 引用行：27
- `docs/architecture.zh.md` —— 引用行：11-13, 21-25, 29-33, 66-88, 96-100, 112-131
- `docs/cordis-primer.zh.md` —— 引用行：13, 34-48
- `docs/cordis-tutorial/02-lifecycle-and-effects.zh.md` —— 引用行：18-42, 53-60, 66, 72-75, 94
- `docs/cordis-tutorial/03-services.zh.md` —— 引用行：5, 40, 59, 74-78, 82-94
- `docs/cordis-tutorial/06-composition-and-hmr.zh.md` —— 引用行：23-109
- `docs/cordis-tutorial/index.zh.md` —— 引用行：17-36
- `docs/tool-execution-pipeline.zh.md` —— 引用行：10-60
- `docs/user/develop/basic/index.zh.md` —— 引用行：56
- `docs/user/develop/basic/publish.zh.md` —— 引用行：56

## C.1.5　examples/（5 个）

- `examples/acp-agent/cordis.yml` —— 引用行：37-45, 51-65, 160-174, 181-192
- `examples/acp-agent/pty.cordis.yml` —— 引用行：6-21
- `examples/headless-agent/README.zh.md` —— 引用行：13, 19-23
- `examples/headless-agent/cordis.yml` —— 引用行：12-14, 18, 23-28, 38-41, 50-57, 156-159
- `examples/headless-agent/e2b.cordis.yml` —— 引用行：1-9, 42-55

## C.2　参考文献

### C.2.1　仓库官方文档（docs/）

教程正文与各章"延伸阅读"多次引用以下官方文档（均为仓库内文件，写作时以 `.zh.md` 中文版为准；英文原版同目录）：

- 架构与概念：`docs/architecture.zh.md`、`docs/cordis-primer.zh.md`、`docs/glossary.zh.md`、`docs/capability-seams.zh.md`、`docs/agent-lifecycle.zh.md`、`docs/event-producer-consumer.zh.md`、`docs/graph-atlas.zh.md`、`docs/module-graph.zh.md`、`docs/rescope.zh.md`、`docs/defensive-patterns.zh.md`
- 分章教程：`docs/cordis-tutorial/01-first-plugin.zh.md`、`02-lifecycle-and-effects.zh.md`、`03-services.zh.md`、`04-events.zh.md`、`05-config.zh.md`、`06-composition-and-hmr.zh.md`、`07-into-the-harness.zh.md`
- 子系统文档（`docs/subsystems/`）：`session.zh.md`、`persistence.zh.md`、`invariants.zh.md`、`compaction.zh.md`、`system-prompt.zh.md`、`llm-streaming.zh.md`、`tools.zh.md`、`web-server.zh.md`、`client-modules.zh.md`、`typert.zh.md`、`subagent.zh.md`、`skills.zh.md`、`jobs.zh.md`、`workflow.zh.md`、`approval.zh.md`、`filesystem.zh.md`、`code-runtime.zh.md`、`attachment.zh.md` 等（共 20+ 篇，以 `docs/subsystems/README.zh.md` 为入口）
- 目录与规范：`docs/persistence-catalog.zh.md`（持久化事件目录）、`docs/tool-catalog.zh.md`（工具清单）、`docs/config-catalog.zh.md`（配置目录）、`docs/api-gateway.zh.md`（@Remote 网关）
- 用户手册：`docs/user/develop/basic/{index,config,tool,publish}.zh.md`、`docs/user/develop/framework/{index,service,events}.zh.md`、`docs/user/develop/practice/{index,llm-adapter}.zh.md`、`docs/user/guide/index.zh.md`

### C.2.2　包级文档与代码内规范

- `vendor/README.md`：vendored 包清单、上游版本与 18 条本地修改（dsh 版 Cordis）的权威说明。
- `packages/bundle/README.zh.md` 与各内置组合包 README（`base/README.md`、`headless/README.zh.md`、`web-app/README.zh.md`）。
- `packages/core/session/README.zh.md`、`packages/core/tools/README.zh.md`、`packages/core/scope/README.zh.md`、`packages/llm/README.zh.md`、`packages/llm/{llm-retry,token-meter}/README.zh.md`、`packages/subagent/*/README.md`、`packages/skill/*/README.md`、`packages/jobs/*/README.md`、`packages/workflow/*/README.md`、`packages/compaction/*/README.md`、`packages/guard/{repeat-tool-reminder,timeout-policy}/README.md`、`packages/hooks/*/README.md`、`packages/extensions/{tool-cordis,cordis-host-runner}/README.md`、`packages/preset/{agent-presets,persona}/README.md`、`packages/acp/acp/README.md`、`packages/sdk/{protocol,client,server}/README.zh.md`、`packages/client/{web,connection,modules}/README.md`、`packages/host/webserver/README.md`、`packages/typert/README.zh.md` 等。
- CLI 权威参考：`apps/cli/reference/README.md`（中文版 `apps/cli/README.zh.md`）。
- 设计笔记（`.agents/notes/implemented/`）：第 9 章引 `bug-fix/2026-08-07-cancel-convergence-wake-latch.zh.md`；第 11 章引 `feature/2026-07-10-parallel-tool-call-execution.md`、`architecture/2026-07-19-cooperative-tool-cancellation.md`、`architecture/2026-07-08-agent-scope-contexts.md`、`bug-fix/2026-08-07-code-mode-executor-collapse.md`、`architecture/2026-07-20-canonical-tool-output-contract.md`；第 14 章引 `feature/2026-06-18-compaction-capability-seam.md`、`simplification/2026-07-22-plan-specific-collaboration-state.md`、`feature/2026-07-28-todo-plan-clears-on-next-turn.md`。

### C.2.3　外部资源

- 上游 Cordis：<https://github.com/cordiverse/cordis>（`packages/core`，commit `56b3d4f` 即本仓库 vendor 快照的上游版本；第 2/3/5 章延伸阅读）。
- Schemastery：<https://github.com/shigma/schemastery>（第 5 章，配置校验库）。
- Standard Schema：<https://standardschema.dev/>（第 5 章，`Schema` 的 `~standard` 协议）。
- js-yaml 与 YAML 标签扩展（`JSON_SCHEMA.extend`，第 5 章）。
- DeepSeek 官方 Chat Completions 文档：`api.deepseek.com`（第 10 章，wire 协议与 `[DONE]` 约定）。
- 外部格式规范（第 15 章）：SQLite 官方文档（`application_id`/`user_version`/STRICT 表/WAL）、Zstandard 帧格式（魔数 `0xFD2FB528` 与校验和标志）、FTS5 与 `unicode61` 分词器。

### C.2.4　各章延伸阅读索引

每章末尾的"延伸阅读"小节即该章参考文献（第 1 章 §延伸阅读、第 2 章 §延伸阅读、第 3 章 §3.12、第 4 章 §延伸阅读、第 5 章 §5.10、第 6 章 §6.12、第 7 章 §延伸阅读、第 8 章 §8.11、第 9 章 §9.16、第 10 章 §10.15、第 11 章 §延伸阅读、第 12 章 §延伸阅读、第 13 章 §延伸阅读、第 14 章 §延伸阅读、第 15 章 §延伸阅读、第 16 章 §16.12、第 17 章 §17.12）。按章查阅即可获得与该主题配套的全部文档、源码与设计笔记。
