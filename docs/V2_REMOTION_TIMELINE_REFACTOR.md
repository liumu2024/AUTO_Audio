# V2 Remotion Timeline Refactor

V2 已从 overlay-first 迁移为 Remotion timeline-first。

旧 V2 已删除：

```text
PlannerDraft
  -> TimelinePlanV1
  -> one main video clip
  -> Remotion transparent overlay frames
  -> FFmpeg overlay composition
```

当前 V2：

```text
Planner
  -> RemotionTimelineSpecV1
  -> material jobs for missing real scenes
  -> standardized user/generated assets
  -> Remotion full timeline composition
```

Remotion 负责可编辑、确定性的程序化画面层：多镜头、转场、字幕、图片运动、标题卡、标签、简单图形。外部视觉模型负责真实画面生成。FFmpeg 负责素材标准化和后续媒体封装能力。

## 当前主线文件

```text
shared/types/remotion-timeline-spec.v1.ts
shared/lib/remotion-timeline-validator.ts
shared/lib/remotion-timeline-fixtures.ts

backend/src/pipeline-v2/v2-input.ts
backend/src/pipeline-v2/remotion-timeline-planner.ts
backend/src/pipeline-v2/remotion-timeline-llm-planner.ts
backend/src/pipeline-v2/remotion-timeline-material-resolver.ts
backend/src/pipeline-v2/remotion-timeline-renderer.ts
backend/src/pipeline-v2/remotion-timeline-review.ts
backend/src/pipeline-v2/remotion-timeline-service.ts
backend/src/pipeline-v2/material-generation-adapter.ts
backend/src/pipeline-v2/ark-seedance-adapter.ts
backend/src/pipeline-v2/media-standardizer.ts
backend/src/pipeline-v2/ffmpeg-binary.ts
backend/src/pipeline-v2/ffmpeg-preflight.ts

remotion/src/timeline/
remotion/scripts/render-timeline-video.mjs

fonted/src/components/shell/V2TimelineView.tsx
```

## API

```text
POST /api/director/chat
POST /api/v2/timeline-drafts/:draftId/runs
```

`preview` 负责规划、审查并保存草稿版本。`runs` 只消费指定 revision，执行素材补全、视频标准化、Remotion 渲染、RenderRun 和 trace 落盘。

## 已清理内容

以下旧 V2 overlay-first 内容已删除：

```text
backend/src/pipeline-v2/service.ts
backend/src/pipeline-v2/planner.ts
backend/src/pipeline-v2/llm-planner.ts
backend/src/pipeline-v2/planning-review.ts
backend/src/pipeline-v2/overlay-renderer.ts
backend/src/pipeline-v2/composer.ts
backend/src/pipeline-v2/evaluation.ts
backend/src/pipeline-v2/material-resolver.ts
backend/src/pipeline-v2/precompose_overlay.py

backend/scripts/smoke-v2-overlay-compose.ts
backend/scripts/smoke-v2-planner-draft.ts
backend/scripts/smoke-v2-generated-main.ts
backend/scripts/run-v2-seedance-real.ts

remotion/src/OverlayRenderer.tsx
remotion/scripts/render-overlay-frames.mjs

shared/types/timeline-plan.v1.ts
shared/types/v2-planner-draft.v1.ts
shared/lib/timeline-plan-validator.ts
shared/lib/v2-planner-draft-validator.ts
```

旧 V1 主应用仍保留 `RenderPlanV1`、任务编辑器、视频理解和原有 Remotion 成片能力。这些不属于 V2 overlay-first 清理对象。

## 验证命令

```bash
npm run v2:check
```

该命令不触发真实外部视频生成，不会产生付费模型调用。
