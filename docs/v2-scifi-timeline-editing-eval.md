# 科幻场景可编辑时间线测试方案（≥50 轮）

## 1. 目标

验证 V2 导演在“可编辑时间线”语义下的完整闭环：

1. 从科幻构想出发，多次精确修改方案、调整构想，且每次修改只作用于指定片段；
2. 生成视频后，基于成片反馈再次精确修改方案，并二次渲染；
3. 能证明“确实只改/只重渲染了部分片段”，而不是整案替换或覆盖历史版本。

## 2. 数据集

文件：`backend/evals/v2-agent/sci-fi-timeline-editing.v1.json`（6 个 case，共 58 轮）。

> 2026-08-04 更新：所有 prompt 已改写为自然/商量语气；新增 `scifi_draft` 评测 fixture（5 镜、4 段字幕、2 个 material job）与 `revisionScope`/`revisionSceneId` 通用断言；渲染前/渲染间已补充 scene（转场）、visual_strategy（视觉策略）、global（镜头数）真实执行轮。

| Case | 类别 | 轮数 | 覆盖点 |
|---|---|---:|---|
| `sci_fi_concept_pitch` | 构想与要求 | 9 | 构想提出、构想调整、要求台账 add/replace、状态复述、UI 配置权威 |
| `sci_fi_create_and_concept_adjust` | 创建与构想调整 | 6 | 创建可编辑草稿、以字幕修改承载叙事调整、精确修改第 2/3 段字幕、画幅时长不被改动 |
| `sci_fi_precise_segment_revision` | 修订范围 | 12 | 只改第 2/4/1 段字幕（subtitle）、scene 改第 2 镜转场、visual_strategy 换第 2 镜视觉策略、global 改镜头数 5→4、恢复修改、版本询问、修改范围总结 |
| `sci_fi_render_then_revise_then_rerender` | 渲染生命周期 | 13 | 授权渲染第一版；渲染间多轮修改：改第 4 段字幕（subtitle）、scene 改转场、visual_strategy 换视觉策略、global 改镜头数 5→6；再次授权渲染、确认第二次渲染用新版本、第一版产物保留、恢复修改 |
| `sci_fi_memory_sedimentation` | 知识沉淀 | 10 | 长期偏好 user/draft/candidate、撤销、召回、当前输入覆盖记忆、闲聊不沉淀 |
| `sci_fi_continuity_recovery` | 连续性 | 9 | 指代“刚才那版”、失败后恢复、要求跨轮保留、记忆引用、最终状态复述 |

## 3. 运行方式

确定性（无模型 key，验证部分片段修改与渲染绑定语义）：

```powershell
npm.cmd run test:smoke:v2:sci-fi-scoped-edit
```

真实模型（有 key 时，54 轮逐轮跑）：

```powershell
npm.cmd run eval:v2:agent -- --suite sci-fi-timeline-editing.v1
```

正式回归已内置该 smoke 与该数据集（`eval:v2:formal`，live 部分需 key）。

## 4. “仅针对部分片段的修改和渲染”判定方法

判定分成三层，全部有确定性断言（见 `smoke-v2-scifi-scoped-edit.ts`）：

### 4.1 修改范围层（方案没有越界改）

- 候选方案先过 `applyV2TimelineRevisionScope(scope=subtitle)`：**只保留字幕事实**，其余字段（scenes / transitions / material_jobs / 非字幕 overlays / audio / canvas）必须与基线逐字段相等；
- 语义审查后过 `evaluateV2TimelineRevisionCommit`：**零差异候选被拒绝**（防止“声称改过但实际没改”），越界改动不会进入保存；
- 断言方式：`deepEqual(scoped.scenes, base.scenes)`、`deepEqual(scoped.material_jobs, base.material_jobs)`。

### 4.2 版本层（修订不可变、可追溯）

- 每次精确修改保存为**新修订号**（revision +1，冲突保护）；
- 旧修订快照**不可变**（`getRevision(1)` 内容与创建时完全一致）；
- 断言方式：`getRevision(1).spec === base`，`saved.revision === 2`，`history.latestRevision.revision === 2`。

### 4.3 渲染层（第二次渲染只基于新版本，且不覆盖第一次）

- 每次渲染生成**独立 render run**，绑定 `sourceRevision` 与 `sourceSpec`（本次执行的真实输入快照）；
- 二次渲染必须 `sourceRevision = 2`、`sourceSpec = 修订 2 的 scoped 方案`；
- 未触达片段的 `material_jobs` 在 run 2 的 source 中**原样保留**（可复用，不重新生成）；
- 第一次渲染的产物记录（`run_1`、`/v2-renders/run_1.mp4`）仍然存在，不被覆盖；
- 断言方式：两条 run 记录并存，`run_2.sourceRevision === 2`、`run_1.sourceSpecJson === base`、`run_2.sourceSpecJson.material_jobs === base.material_jobs`。

## 5. 与可编辑时间线定义的一致性

仓库定义（CONTEXT.md）：

- Timeline Draft = 可编辑意图（当前修订即用户可编辑的版本）；
- Timeline Revision = 不可变保存快照；
- Timeline Render Run = 针对某个已保存修订的一次执行，**永不回写修订**。

本方案的第 4 节三层次断言正好对应这三条：修改只落进新修订（4.1+4.2），渲染绑定修订且不回写（4.3），因此“部分片段修改 + 部分片段重渲染”成立的条件是：修订 diff 范围可控、旧修订不可变、新渲染源快照只含被授权修改的事实。

## 6. 说明与边界

- 当前 Tool 层开放的修订范围是 `subtitle`；“改转场/改镜头”的 turn 设计为能力边界说明（模型应诚实拒绝或说明），不产生执行；
- 当前渲染策略是整案重渲染；“只重渲染受影响片段”的 turn 用于确认模型不谎称支持局部渲染，未来若引入增量渲染，需在同一修订/渲染绑定语义上扩展断言；
- 数据集为 live 评测输入，期望值只校验模型意图与结果事实（工具选择、范围、字幕文本、渲染授权），确定性语义由 smoke 保证。
