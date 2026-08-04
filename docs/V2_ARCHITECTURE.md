# V2 Timeline Architecture

V2 的主线已经调整为 timeline-first：

```text
用户输入
  -> Planner 生成 RemotionTimelineSpecV1
  -> Validator 校验结构、时间、素材引用、渲染边界
  -> 用户审查中文分镜摘要和可编辑 JSON
  -> Material Resolver 补全 generate_video 等素材任务
  -> FFmpeg 标准化用户/生成视频素材
  -> Remotion V2TimelineVideo 渲染完整多镜头 MP4
  -> Trace 记录规划、素材、渲染和评估过程
```

## 分工边界

Remotion 负责确定性的程序化视频层：多镜头编排、转场、字幕、标题、图片运动、卡片场景、标签和简单图形。

外部视觉模型负责 Remotion 不擅长的真实画面生成。模型输出视频进入主链路前必须落地为文件，并经过 FFmpeg 标准化。

FFmpeg 负责视频资产标准化、编码能力预检和最终媒体格式稳定性。当前 Timeline 成片由 Remotion 直接渲染 MP4，后续如果增加多路音频混音或最终封装，也应放在 FFmpeg 边界内。

## 关键代码

```text
shared/types/remotion-timeline-spec.v1.ts
shared/lib/remotion-timeline-validator.ts
shared/lib/remotion-timeline-fixtures.ts

backend/src/pipeline-v2/v2-input.ts
backend/src/pipeline-v2/remotion-timeline-planner.ts
backend/src/pipeline-v2/remotion-timeline-llm-planner.ts
backend/src/pipeline-v2/remotion-timeline-material-resolver.ts
backend/src/pipeline-v2/remotion-timeline-renderer.ts
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

```http
POST /api/v2/timeline/preview
POST /api/v2/timeline/run
```

`preview` 只生成 `RemotionTimelineSpecV1`、校验报告、中文审查摘要和 trace，不生成外部素材，也不渲染视频。

`run` 接收相同输入，也可以接收用户修改后的 `timelineSpecOverride`。它会执行素材补全、视频标准化、Remotion 渲染和最终评估。

## Planner 模式

```text
deterministic  默认模式，不调用外部 LLM
llm            调用配置的 Director Agent Responses API，要求模型直接输出 RemotionTimelineSpecV1
```

LLM planner 不能输出 React、HTML、CSS、FFmpeg 命令或自由组件代码。它只能输出受 schema 约束的 JSON。所有输出必须通过 `validateRemotionTimelineSpec`，失败时只有在 `allowPlannerFallback=true` 时才回退 deterministic。

## 素材生成

视觉生成通过 `material_jobs` 表达。当前真实适配器是 Ark Seedance 图生视频：

```text
generate_video job
  -> ark-seedance adapter submit task
  -> poll task status
  -> download video
  -> FFmpeg standardize to configured width/height/fps
  -> attach as RemotionTimeline asset
```

外部模型要访问本地上传素材时，`PUBLIC_ASSET_BASE_URL` 必须是公网 HTTPS 地址或对象存储/CDN 地址。localhost、内网地址、file URL 都会在提交前被拦截。

## Trace 顺序

```text
backend/tmp/v2-traces/tasks/<taskId>/
  00-summary/summary.zh.md
  01-input/timeline-planner-input.json
  02-planning/timeline-spec.json
  02-planning/llm-timeline-planner-*     only in llm mode
  02-plan-review/timeline-review.zh.md
  03-material-jobs/timeline-material-resolution.json
  04-material-assets/timeline-standardized-assets.json
  05-remotion-props/timeline-render-spec.json
  06-remotion-render/timeline-render.log
  07-evaluation/timeline-evaluation.json
```

## 已清理的旧 V2

旧的 `PlannerDraft -> TimelinePlanV1 -> Remotion transparent overlay frames -> FFmpeg overlay composition` 链路已经从 V2 主线删除。V1 主应用仍保留 `RenderPlanV1` 编辑和渲染能力，不属于本次 V2 清理范围。

## 验证

```powershell
npm.cmd run v2:check
```

## Asset Publication Boundary

Local uploads serve two different consumers and must not be treated as one URL:

```text
/api/uploads
  -> backend/uploads/<file> for local Remotion rendering
  -> optional TOS object for cloud image-to-video providers
```

When the caller passes `requirePublicUrl=true`, the upload request must return
an externally reachable `publicUrl` or fail before any Seedance task is
submitted. TOS publication also verifies that the published URL can be read back
before handing it to the video-generation adapter. The frontend V2 timeline page
uses this mode for image-to-video inputs and separately keeps `localPath` for
Remotion preview/rendering.

The active implementation lives in:

```text
backend/src/modules/upload/asset-publisher.ts
backend/src/modules/upload/upload.controller.ts
fonted/src/components/shell/V2TimelineView.tsx
```

该命令覆盖后端构建、前端构建、V2 边界检查、FFmpeg 预检、Timeline spec/validator、planner、素材解析、Remotion 渲染和 service 全链路 smoke。
