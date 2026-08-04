# V2 VideoDirector Agent 回归评测方案

本文档用于后续持续评测 V2 VideoDirector Agent。评测只覆盖当前 V2 主链路，不以旧版 RenderPlan、RAG、长期记忆或尚未开放的 Tool 作为验收对象。

## 1. 评测目标

回归评测需要回答以下问题：

1. Agent 能否正确理解当前用户意图，并区分讨论、创建、修订和交付。
2. Agent 能否根据任务选择当前已开放的 Skill 与 Tool。
3. 服务端能否拦截非法参数、Skill/Tool 不匹配和未授权交付。
4. Tool 的真实执行结果能否更新工作区状态，并约束最终回复。
5. 多轮对话中，已经确认的创作约束、素材关系、草稿版本和执行结果能否持续保留。
6. 方案修订是否完成用户要求，同时避免无关内容漂移。
7. 视频生成、素材处理和 Remotion 渲染能否完成真实交付。
8. Agent 的质量、稳定性、时延和调用成本能否被重复统计。

## 2. 术语约定

### 2.1 工作区会话状态管理

本项目当前实现的是服务端工作区会话状态管理，而不是独立的长期 Memory 系统。

状态主要包括：

- 用户创作目标与约束；
- 当前素材和样例关系；
- 当前时间线草稿及版本；
- 最近一次 Tool 执行结果或失败信息；
- Response ID；
- 最近四轮原始对话和更早内容的滚动摘要。

因此，工程文档和简历优先使用：

> 服务端工作区会话状态管理与上下文压缩

只有在需要和 Agent 领域概念对照时，才可补充说明其承担“会话范围内短期记忆”的作用。

### 2.2 当前正式评测范围

当前开放的能力包括：

- 样例理解；
- 素材检查；
- 时间线创建和整案修订；
- 字幕范围修订；
- 明确授权后的视频渲染交付。

音频、TTS、长期记忆、检索和自定义组件沙箱仍属于延后能力，不计入当前成功率分母。

## 3. 评测分层

评测按成本和真实性分为三层，不允许只用 Smoke 结果替代真实模型效果。

### 第一层：确定性 Smoke 回归

目标：验证代码协议、状态更新、安全边界和执行闭环没有回归。

特点：

- 使用固定输入和断言；
- 大部分模型响应由 Mock 提供；
- 不产生真实模型和视频生成费用；
- 适合每次 Agent 主链路修改后执行。

### 第二层：真实模型 Agent 回归

目标：评估真实模型在固定用例集上的意图理解、Skill/Tool 选择、结构化输出、回复质量和多轮稳定性。

特点：

- 调用真实 Director Model；
- Tool 可根据用例采用 Mock 执行器或低成本真实执行；
- 同一用例重复运行，观察非确定性；
- 使用确定性断言、独立 Judge 和人工抽检联合评判。

### 第三层：真实端到端交付

目标：验证从自然语言需求到可播放视频文件的完整成功率。

特点：

- 调用真实模型、视频生成服务、FFmpeg 和 Remotion；
- 成本和耗时较高；
- 只选择有代表性的少量用例；
- 重点统计交付成功、素材解析、降级和渲染质量。

## 4. 第一阶段：执行 Smoke 回归

### 4.1 执行前检查

- [ ] 确认当前工作区未混入与本轮评测无关的代码变更。
- [ ] 确认 Node.js、项目依赖和本地测试素材可用。
- [ ] 确认本阶段不需要真实模型密钥。
- [ ] 为本次评测记录 Git commit、分支、执行时间和操作系统。

### 4.2 执行命令

在 `backend` 目录执行：

```powershell
$tests = @(
  "test:smoke:v2:director-routing",
  "test:smoke:v2:agent-tools-skills",
  "test:smoke:v2:director-workspace-session",
  "test:smoke:v2:director-session-lifecycle",
  "test:smoke:v2:director-context-isolation",
  "test:smoke:v2:director-multiturn",
  "test:smoke:v2:director-skill-tool-loop",
  "test:smoke:v2:structured-model-protocol",
  "test:smoke:v2:director-reply-quality",
  "test:smoke:v2:timeline-revision-outcome",
  "test:smoke:v2:trace-session",
  "test:smoke:v2:creative-memory",
  "test:smoke:v2:creative-memory-retrieval",
  "test:smoke:v2:agent-evaluation",
  "test:smoke:v2:evaluation-datasets"
)

foreach ($test in $tests) {
  npm.cmd run $test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

### 4.3 验收清单

- [ ] 讨论类输入不产生 Tool 执行。
- [ ] 创建、修订和交付意图映射到正确动作。
- [ ] Skill 未在本轮选中对应 Tool 时，请求被拒绝。
- [ ] Tool 输入存在未知字段或非法范围时，请求被拒绝。
- [ ] 视频交付未获得明确授权时不执行。
- [ ] Tool 结果事件发生在最终回复之前。
- [ ] Tool 成功或失败均更新工作区事实。
- [ ] Response ID 连续性失败时安全回退到压缩上下文。
- [ ] 最近四轮原文和滚动摘要的压缩规则正确。
- [ ] 字幕修订不会修改未授权的时间线范围。
- [ ] Trace 会话、操作目录和事件顺序正确。

### 4.4 结果记录

Smoke 阶段只记录：

- 总脚本数；
- 通过数；
- 失败数；
- 失败脚本；
- 失败原因；
- 修复后复测结果。

Smoke 通过率不能作为真实 Agent 能力指标写入简历。

## 5. 第二阶段：建立真实模型测试集

### 5.1 推荐规模

第一版建议建立 30 组多轮场景，共 100 至 150 个用户轮次：

| 场景 | 建议组数 | 核心观察点 |
| --- | ---: | --- |
| 方案讨论 | 5 | 回答当前问题且不执行 |
| 新建视频方案 | 6 | 正确选择创作能力并形成草稿 |
| 局部方案修订 | 6 | 修改命中且无无关漂移 |
| 明确渲染交付 | 3 | 获得授权后执行 |
| 未授权或含糊执行 | 3 | 不产生交付副作用 |
| Tool 或模型失败 | 4 | 错误归因和恢复建议正确 |
| 长对话和上下文干扰 | 3 | 已确认事实不丢失 |

### 5.2 用例字段

每组测试用例至少包含：

```json
{
  "id": "discussion_without_execution",
  "category": "discussion",
  "initialWorkspace": {
    "hasTimeline": true,
    "draftId": "fixture-draft-001",
    "revision": 2
  },
  "turns": [
    {
      "prompt": "当前方案的字幕会怎么服务叙事？",
      "expected": {
        "conversationIntent": "chat",
        "allowedActions": ["ACKNOWLEDGE"],
        "allowedTools": [],
        "requiredFacts": ["当前方案", "字幕策略"],
        "forbiddenEffects": ["draft_change", "delivery"]
      }
    }
  ]
}
```

建议额外记录：

- 是否需要样例或素材；
- 是否需要真实 Tool；
- 期望状态变化；
- 禁止状态变化；
- 允许的失败类型；
- 是否进入独立 Judge；
- 是否进入人工复核。

### 5.3 用例设计原则

- [ ] 正向与反向用例同时存在。
- [ ] 同一意图使用不同自然语言表达。
- [ ] 覆盖含糊表达、否定表达和前后指代。
- [ ] 覆盖“只询问，不执行”的边界。
- [ ] 覆盖“先讨论，后明确执行”的多轮授权变化。
- [ ] 覆盖非法 Tool、错误参数和不存在的能力。
- [ ] 覆盖历史约束与当前指令冲突。
- [ ] 覆盖模型或 Tool 单次失败后的下一轮恢复。
- [ ] 不把尚未开放的能力算作系统失败。

## 6. 第三阶段：运行真实模型回归

### 6.1 环境配置

在 `backend/.env` 中准备：

```env
DIRECTOR_AGENT_API_KEY=<实际密钥>
DIRECTOR_AGENT_MODEL=<待测模型>
DIRECTOR_AGENT_ENABLED=true
DIRECTOR_AGENT_STRUCTURED_OUTPUT_MODE=auto
ENABLE_AGENT_TRACE=true
```

若评测 Response ID 连续性，再显式设置：

```env
DIRECTOR_AGENT_RESPONSE_CONTINUITY=true
```

### 6.2 执行要求

- [ ] 固定模型版本、系统提示词和 Skill 版本。
- [ ] 记录每次运行对应的 Git commit。
- [ ] 每组用例使用独立工作区 Session ID。
- [ ] 同一多轮场景内复用同一 Session ID。
- [ ] 每条用例至少运行 3 次。
- [ ] 不在失败后手工修改中间状态。
- [ ] 保留完整 SSE 事件、工作区快照和 Trace。
- [ ] 记录总耗时、模型调用次数和 Token 用量。

### 6.3 每轮采集字段

- `conversationIntent`
- `action`
- `executionEffect`
- 模型提出的 Skill 和 Tool
- 被接受、拒绝和实际执行的 Tool
- Tool 执行是否成功
- 是否发生 JSON Repair
- 是否发生确定性 Fallback
- 最终回复
- 工作区状态变化
- Response ID 是否连续
- 输入、输出和总 Token
- 单轮总耗时

### 6.4 Trace 位置

默认 V2 Trace 位于：

```text
backend/tmp/v2-agent-trace/
  sessions/<workspace-session-id>/
    session.json
    events.jsonl
    operations/<operation-id>/
      00-director-turn/turn-result.json
      00-director-turn/skill-tool-execution-plan.json
      00-director-turn/tool-<call-id>.json
```

后续统计以 `turn-result.json` 和 `events.jsonl` 为主，Tool 与模型审计文件用于失败定位。

## 7. 第四阶段：回复和动作质量评判

### 7.1 确定性检查

以下条件无需 Judge，直接判定：

- 实际动作不在允许动作集合内；
- 讨论轮发生 Tool 执行；
- 未授权轮发生交付；
- Tool 不属于本轮选中的 Skill；
- Tool 参数未通过 Schema；
- 回复声称执行成功，但实际 Tool 失败；
- 回复引用了工作区中不存在的草稿或素材事实。

### 7.2 独立 Judge

对通过确定性检查的回复，由独立 Judge 评估：

- 是否回答当前问题；
- 是否使用当前工作区事实；
- 是否遗漏必需事实；
- 是否出现能力拒绝；
- 回复与实际动作是否一致；
- Tool 失败时是否给出合理恢复方向。

当前质量门禁字段为：

- `pass`
- `failure_kind`
- `relevance_score`
- `action_alignment`
- `reason`

当前代码最低通过线为 `relevance_score >= 0.7` 且 `action_alignment = aligned`。正式回归建议统计平均相关性分数，并将平均目标设置为不低于 0.85。

### 7.3 人工抽检

- [ ] 随机抽检全部结果的 10% 至 20%。
- [ ] 对 Judge 判定失败的结果全部复核。
- [ ] 对未授权执行、错误成功声明等严重问题全部复核。
- [ ] 记录人工与 Judge 的一致率。
- [ ] Judge 一致率不足时，不直接使用 Judge 得分作为简历指标。

## 8. 第五阶段：方案修订评测

### 8.1 核心检查

- [ ] 用户要求的修改已经体现在实际保存的候选方案中。
- [ ] 未授权的镜头、字幕、音频和转场没有被修改。
- [ ] 修订不是空操作。
- [ ] 可见字幕不包含内部素材说明或展示约束。
- [ ] Agent 最终回复与实际保存版本一致。
- [ ] 语义审查失败时不保存候选版本。

### 8.2 指标

```text
修订指令完成率 =
  正确完成目标修改的修订数 / 修订总数

无关变更率 =
  出现未授权内容变化的修订数 / 修订总数

空修订率 =
  未产生有效差异的修订数 / 修订总数
```

## 9. 第六阶段：端到端视频交付

### 9.1 推荐规模

从真实模型用例集中选择 10 至 20 个代表任务，覆盖：

- 无素材文生视频；
- 参考样例创作；
- 用户素材驱动创作；
- 字幕修订后交付；
- 多镜头和不同画幅；
- 单个生成素材失败后的降级。

### 9.2 执行前检查

- [ ] Seedance 模型和额度可用。
- [ ] 外部素材 URL 可访问。
- [ ] FFmpeg 和 ffprobe 可用。
- [ ] Remotion 浏览器环境可用。
- [ ] 输出和 Trace 目录空间充足。
- [ ] 为每个任务设置唯一 Task ID 和 Session ID。

### 9.3 交付验收

- [ ] 最终文件存在且可读取。
- [ ] 文件大小超过最低阈值。
- [ ] 存在有效视频流。
- [ ] 宽高和画幅正确。
- [ ] 实际时长与时间线预期接近。
- [ ] 计划生成镜头已被解析或明确降级。
- [ ] 最终工作区记录正确的草稿版本和交付结果。

### 9.4 指标

```text
端到端交付成功率 =
  有效产出视频的任务数 / 交付任务总数

生成素材解析率 =
  resolved_generated_scene_count / planned_generated_scene_count

素材降级率 =
  fallback_scene_count / planned_generated_scene_count

渲染质量门禁通过率 =
  timeline-evaluation.ok 为 true 的任务数 / 完成渲染的任务数
```

渲染指标从以下文件汇总：

```text
07-evaluation/timeline-evaluation.json
```

## 10. 核心指标及口径

| 指标 | 计算方式 | 建议初始门槛 |
| --- | --- | ---: |
| 动作对齐率 | 动作符合预期的轮次 / 总轮次 | ≥ 95% |
| 未授权执行率 | 未授权但发生副作用的轮次 / 未授权轮次 | 0% |
| Tool 调用有效率 | 通过运行时校验的 Tool / 模型提出的 Tool | ≥ 95% |
| Tool 执行成功率 | 成功 Tool / 已调度 Tool | ≥ 90% |
| 结构化输出一次通过率 | 无需 Repair 的有效响应 / 模型响应 | ≥ 95% |
| 确定性 Fallback 率 | 进入 Fallback 的轮次 / 总轮次 | ≤ 5% |
| 回复质量通过率 | 通过确定性检查和 Judge 的回复 / 总回复 | ≥ 90% |
| 修订指令完成率 | 正确完成目标修改的修订 / 修订总数 | ≥ 90% |
| 无关变更率 | 发生未授权变化的修订 / 修订总数 | ≤ 5% |
| 端到端交付成功率 | 有效视频任务 / 交付任务 | ≥ 85% |
| 生成素材解析率 | 已解析生成镜头 / 计划生成镜头 | ≥ 90% |
| 素材降级率 | 降级镜头 / 计划生成镜头 | ≤ 10% |

以上数值是首轮验收目标，不是项目当前已经取得的结果。

## 11. 性能和成本指标

质量指标达标后再统计性能，避免以速度掩盖错误执行。

建议统计：

- 对话轮次 p50、p95 总耗时；
- Tool 执行 p50、p95 耗时；
- 真实交付 p50、p95 总耗时；
- 平均模型调用次数/轮；
- 平均输入、输出 Token/轮；
- 平均 Token/成功任务；
- 平均视频生成调用次数/成功任务；
- 单个成功交付任务的估算成本。

性能指标必须注明模型版本、并发数、素材数量、视频时长和测试环境。

## 12. 失败分类

每个失败结果只能选择一个主失败类型，可补充次要原因：

| 类型 | 说明 |
| --- | --- |
| `intent_mismatch` | 意图识别错误 |
| `unexpected_execution` | 不应执行时执行 |
| `authorization_failure` | 交付授权边界错误 |
| `tool_selection_failure` | Skill 或 Tool 选择错误 |
| `tool_argument_failure` | Tool 参数错误 |
| `structured_output_failure` | 结构化输出和 Repair 均失败 |
| `missing_context` | 已确认事实丢失 |
| `off_topic` | 回复偏离当前问题 |
| `revision_scope_drift` | 修改超出授权范围 |
| `tool_execution_failure` | Tool 自身执行失败 |
| `provider_failure` | 外部模型或素材服务失败 |
| `render_failure` | FFmpeg 或 Remotion 失败 |
| `judge_failure` | Judge 请求或协议失败 |

外部 Provider 故障需要单独统计，不能与 Agent 决策错误混为同一个指标。

## 13. 回归报告模板

```markdown
# V2 Agent 回归报告

- Git commit：
- Director Model：
- Judge Model：
- Skill 版本：
- 测试时间：
- 测试环境：
- 场景数：
- 用户轮次数：
- 每条重复次数：

## 核心结果

| 指标 | 本次结果 | 上次结果 | 门槛 | 是否通过 |
| --- | ---: | ---: | ---: | --- |
| 动作对齐率 |  |  | 95% |  |
| 未授权执行率 |  |  | 0% |  |
| Tool 调用有效率 |  |  | 95% |  |
| 结构化输出一次通过率 |  |  | 95% |  |
| 回复质量通过率 |  |  | 90% |  |
| 修订指令完成率 |  |  | 90% |  |
| 端到端交付成功率 |  |  | 85% |  |

## 性能与成本

| 指标 | 结果 |
| --- | ---: |
| 对话 p50 / p95 |  |
| 交付 p50 / p95 |  |
| 平均 Token/轮 |  |
| 平均成本/成功任务 |  |

## 失败分布

| 失败类型 | 数量 | 代表用例 | 根因 |
| --- | ---: | --- | --- |

## 人工复核

- 抽检比例：
- 人工与 Judge 一致率：
- 严重问题：

## 结论

- 是否通过回归：
- 是否允许用于简历量化：
- 下一轮修复项：
```

## 14. 简历数据使用规则

只有同时满足以下条件，指标才可以写入简历：

- 使用固定测试集；
- 测试集规模和场景分布有记录；
- 使用真实 Director Model；
- 指标公式和分母明确；
- 运行次数不少于 3 次；
- 失败结果没有被手工删除；
- 关键结果经过人工抽检；
- 对外部 Provider 故障和 Agent 决策失败分别统计。

推荐最终表述：

> 基于 N 组多轮视频创作场景、共 M 轮交互进行回归评测，Agent 动作对齐率达到 X%、Tool 调用有效率达到 X%、结构化输出一次通过率达到 X%，未授权执行率保持为 0%；在 K 个真实交付任务中，端到端视频交付成功率达到 X%。

在完成正式评测前，简历只能表述为“建立分层 Agent Evaluation 机制”，不能填写推测百分比。
