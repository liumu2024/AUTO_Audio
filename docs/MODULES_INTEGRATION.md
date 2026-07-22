# Module Integration

All runtime secrets are managed through `backend/.env`. Example files may be
committed, but real keys must stay local.

## Environment

```env
ARK_API_KEY=ark-your-key
# Optional: use a different key only for understanding
# VIDEO_UNDERSTANDING_API_KEY=ark-your-key

VIDEO_UNDERSTANDING_MODEL=
ARK_API_BASE=https://ark.cn-beijing.volces.com/api/v3
VIDEO_UNDERSTANDING_FILES_URL=https://ark.cn-beijing.volces.com/api/v3/files
VIDEO_UNDERSTANDING_RESPONSES_URL=https://ark.cn-beijing.volces.com/api/v3/responses

REMOTION_ROOT=../remotion
REMOTION_COMPOSITION_ID=Dpl304Video
RENDER_OUTPUT_DIR=renders
V2_VIDEO_GENERATION_MODEL=doubao-seedance-1-5-pro-251215
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `ARK_API_KEY` | Ark video understanding key | none |
| `VIDEO_UNDERSTANDING_API_KEY` | Optional understanding-only override | `ARK_API_KEY` |
| `VIDEO_UNDERSTANDING_MODEL` | Ark endpoint/model id | project-specific |
| `REMOTION_ROOT` | Remotion package path from `backend/` | `../remotion` |
| `REMOTION_COMPOSITION_ID` | Remotion composition id | `Dpl304Video` |
| `RENDER_OUTPUT_DIR` | Legacy RenderPlan output directory | `renders` |
| `V2_VIDEO_GENERATION_MODEL` | V2 AI-video model id | `doubao-seedance-1-5-pro-251215` |
| `ASSET_PUBLISHER_PROVIDER` | Public asset publisher for external providers | `local` |

## V2 Timeline Module

Trigger: the director executor or V2 page calls `/api/v2/timeline/preview` and
then `/api/v2/timeline/run`.

Flow:

1. Resolve uploaded sample/material URLs into local paths and, when required,
   public provider URLs.
2. Planner creates or repairs `RemotionTimelineSpecV1`.
3. Validator checks timing, assets, transitions, overlays, audio, and material
   job boundaries.
4. Preview returns a Chinese planning review and compact trace path.
5. Run resolves material jobs, calls Seedance only for reviewed AI-video jobs,
   normalizes all media, then renders through Remotion.

Main files:

| File | Purpose |
| --- | --- |
| `backend/src/pipeline-v2/controller.ts` | V2 preview/run HTTP handlers |
| `backend/src/pipeline-v2/remotion-timeline-service.ts` | V2 orchestration |
| `backend/src/pipeline-v2/remotion-timeline-llm-planner.ts` | LLM planner adapter |
| `backend/src/pipeline-v2/ark-seedance-adapter.ts` | Ark Seedance image-to-video adapter |
| `backend/src/pipeline-v2/ffmpeg-standardizer.ts` | Provider/local media standardization |
| `shared/types/remotion-timeline-spec.v1.ts` | Active render contract |
| `shared/lib/remotion-timeline-validator.ts` | Active validator |
| `remotion/src/RemotionTimelineVideo.tsx` | V2 Remotion composition |

## Failure Policy

| Stage | Missing dependency | Behavior |
| --- | --- | --- |
| Planning | Invalid planner JSON | Fallback deterministic timeline is used when allowed |
| Material generation | Missing provider key or provider failure | Use planned fallback/static Remotion scene when available |
| Material generation | Local image is not public | Upload fails before provider call when public URL is required |
| Rendering | Remotion render error | `/api/v2/timeline/run` returns an explicit failure |
