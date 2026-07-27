# V2 导演多轮改动记录

## 1. 服务端工作区会话与 Patch 契约

- 链路：V2 主链路。
- 根因：导演状态只在浏览器中拼装；UI 的默认值与 `undefined` 会参与合并，刷新后没有可靠的连续对话事实。
- 修改：新增服务端工作区状态模型、原子文件持久化仓库（默认 `backend/data/v2-director-sessions`，本地模式可随 `DPL304_LOCAL_DATA_DIR` 挂载），以及“缺失保留、`null` 清空、对象递归合并、数组明确替换”的统一 Patch 函数。会话不复用 V1 任务或 RenderPlan。
- 影响：后续导演 API 可以在创建草稿前保存讨论，创建后关联 V2 草稿和版本。
- 验证：`npm.cmd run test:smoke:v2:director-workspace-session`；验证默认值不覆盖、显式清空与四轮上下文压缩。
- Trace：本点为纯状态契约，不调用素材、视频或渲染模型；后续接入 API 后写入 V2 director turn trace。
- 遗留：下一点将该会话接入 `/api/director/chat` 与模型连续上下文。

## 2. 每轮核心模型、连续上下文与 Director trace

- 链路：V2 主链路。
- 根因：`/api/director/chat` 虽会调用模型，但每次只接收前端临时上下文；Router 和前端状态机的展示信息容易被误解为决策来源，且没有逐轮证据。
- 修改：chat 服务恢复工作区会话，合并运行时事实但不接受 UI 默认偏好反向覆盖；每轮都调用核心模型并保存模型的自然回复、状态 Patch、意图、必要信息、最近 Response ID 与四轮窗口。Router 只提供观测信息。新增 Response ID 配置开关，连续 ID 被 provider 拒绝时只标记后续轮次回退到压缩上下文，不重试该轮。
- Trace：每轮写入 `backend/tmp/v2-agent-trace/<workspace>__turn_*/00-director-turn/`，包含输入到达、模型调用、动作、状态差异、Response ID、fallback 原因。
- 验证：`npm.cmd run test:smoke:v2:director-routing` 通过；该 smoke 只验证协议和安全边界，不调用 provider。
- 遗留：动作执行仍由前端 V2 executor 完成，下一点将其结果回写同一服务端会话。

## 3. V2 工具执行结果回写

- 链路：V2 主链路。
- 根因：预览、修订和渲染的真实结果写入 V2 草稿/trace，但导演下一轮没有同一份结果状态，容易重新按旧输入回答。
- 修改：新增工作区 outcome API。前端 V2 executor 在成功或失败后非阻塞回写动作、结果、最新草稿版本和 V2 trace 地址；服务端将其写入会话的 `latestExecution` 或 `recentFailure`，并追加可压缩的系统结果轮次。
- 安全：回写只关联当前工作区与请求用户；失败的会话回写不会覆盖已经成功的 V2 草稿。
- 验证：`npm.cmd run test:smoke:v2:director-workspace-session` 通过，覆盖草稿版本与执行结果的 Patch 保留。
- 遗留：下一点收敛规划校验与字幕归属，避免局部协议问题退化成整案 fallback。

## 4. 字幕归属与可修复规划校验

- 链路：V2 主链路。
- 根因：模型可能把镜头的素材标签、画面说明或裸文件名放进文字叠层；同时未知动画名会被 validator 判为 error，触发整案确定性 fallback。
- 修改：文本归属标准化器会移除“视觉场景素材标签/裸媒体文件名”形成的隐式文字叠层，保留 `creative_intent` 供右侧方案说明使用；明确用户字幕仍在硬要求阶段后置写入（包括“字幕显示「…」”），因此不会误删用户确实要显示的文件名。未知安全动画统一映射为 `fade`。
- 验证：`npm.cmd run test:smoke:v2:remotion-timeline-planner` 先验证失败，再验证 `zoom_in → fade`、`4.png` 不成为字幕、完整 spec 仍合法。
- 遗留：下一点收敛前端技术详情与服务端快照同步，移除把 Router/旧状态机暴露成用户工作流的表达。

## 5. 前端会话恢复与自然对话表达

- 链路：V2 主链路。
- 根因：聊天面板把 surface Router、置信度和旧状态机直接展示为技术详情；刷新后也没有恢复服务端导演会话。
- 修改：浏览器保存稳定工作区 ID，页面加载时恢复服务端会话，收到 server snapshot 后以其 context 同步前端。技术详情改为“本轮理解/下一步/会话同步”；纯讨论只显示模型回复。模型失败降级改为引用当前问题与已保留 V2 事实的非执行回复。
- 验证：将在最终前端构建与多轮 mock smoke 一并验证；本点没有发起模型、素材或渲染调用。
- 遗留：下一点补充多轮覆盖、完整 trace 检查和一次性构建/三分支 smoke。

## 6. 多轮模拟、trace 与最终验收

- 链路：V2 主链路。
- 修改：新增 mock Responses API 多轮 smoke，经过真实 SSE 导演服务、服务端会话仓库和 V2 trace 写入，而非只调用私有函数。
- 覆盖：无素材文生视频创建；询问既有方案不执行；基于草稿修订；明确渲染授权产生执行计划；单轮模型失败后继续对话；UI `undefined` 不覆盖已确认时长；四轮压缩保留约束；Response ID 连续传递。
- Trace 证据：`backend/tmp/v2-agent-trace/v2_multiturn_*__turn_*/00-director-turn/turn-result.json` 显示 `core_model_called: true`、`planner_called: false`（纯讨论）、前后 Response ID 和状态差异。
- 最终验证：后端 build 通过；前端 build 通过；`test:smoke:v2:creation-modes` 通过，覆盖 `sample_replicate`、`material_brief`、`text_to_video`；导演多轮、导演路由、时间线规划 smoke 均通过。
- 遗留：无。本轮未调用真实模型、素材生成或渲染；真实交互验证应由用户在额度允许时进行。

## 7. 综合多轮模拟（无外部额度）

- 链路：V2 主链路验证；不修改产品运行策略。
- 案例：同一会话依次覆盖无素材文生视频创建、风格修订、关键词驱动字幕、已有方案问答、素材全覆盖、单轮模型失败、失败后恢复、局部节奏/转场/字幕位置修订、明确渲染授权。
- 机制：使用 mock Responses API，但真实经过 SSE 导演服务、服务端会话、上下文压缩、Response ID 连续性、动作计划、模拟 V2 outcome 回写及 trace 写入。
- 结果：问答与失败恢复不产生动作计划；创建/修订/明确渲染分别产生相应 V2 动作计划；没有调用真实 Planner、素材生成或渲染。
- 证据：以 `backend/tmp/v2-agent-trace/v2_comprehensive_director_*/00-simulation/comprehensive-session.json` 为索引，逐轮 trace 位于同一 workspace ID 的 `v2_director_*__turn_*/00-director-turn/`。

## 8. V2 状态、旧模式隔离与结构化模型协议

- 链路：V2 主链路；旧规则路由只保留为未导出的兼容实现，正式 Director、Planner 与 Executor 均不再调用。
- 根因：旧 UI 的 `generationMode` / `audioPolicy`、`hasPipeline` 和“无目标即分析样例”默认值会把非 V2 事实写入会话，或让一个可映射字段使整轮创建协议失败。
- 修改：V2 slots 删除旧模式与音频策略；运行时删除 `hasPipeline`；空目标保留为未设定；非本轮 `clarify` 清除历史待问问题。旧字段若承载 `sample_replicate`、`material_brief` 或 `text_to_video`，只转换为审计用 `v2CreationMode`，不会写回状态，也不会覆盖根据实际输入确定的创建分支。
- 协议：导演、样例理解、时间线规划均优先请求 provider JSON Schema；provider 明确拒绝时同轮退回严格 JSON。首次解析或字段校验失败仅发起一次不携带媒体的格式修复请求；二次失败保留字段诊断并走既有 V2 fallback。Trace 仅保存最终文本、响应 ID、模型、用量与诊断，不保存推理摘要。
- 受影响模块：`shared/types/director-context.ts`、导演路由/会话服务、样例理解服务、V2 时间线 LLM planner、V2 trace 写入与对应 smoke。
- 验证：`test:smoke:v2:director-routing`、`test:smoke:v2:director-multiturn`、`test:smoke:v2:director-workspace-session`、`test:smoke:v2:structured-model-protocol`、`test:smoke:v2:remotion-timeline-planner` 均通过。结构化协议 smoke 使用 mock provider，覆盖样例/规划 JSON 修复成功和规划二次失败的 trace fallback；未调用真实媒体生成或渲染。
- 遗留：最终统一 build、前端 build 与三条 V2 创建分支 smoke 将在所有窄验证完成后只执行一次。
