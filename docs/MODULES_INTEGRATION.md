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
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `ARK_API_KEY` | Ark video understanding key | none |
| `VIDEO_UNDERSTANDING_API_KEY` | Optional understanding-only override | `ARK_API_KEY` |
| `VIDEO_UNDERSTANDING_MODEL` | Ark endpoint/model id | project-specific |
| `REMOTION_ROOT` | Remotion package path from `backend/` | `../remotion` |
| `REMOTION_COMPOSITION_ID` | Remotion composition id | `Dpl304Video` |
| `RENDER_OUTPUT_DIR` | Render output directory | `renders` |

## Understanding Module

Trigger: `analyzer.worker` calls `ArkVideoAnalyzerService` when
`VIDEO_UNDERSTANDING_API_KEY` or `ARK_API_KEY` is configured.

Flow:

1. `resolveVideoInput(videoUrl)` resolves local upload paths or remote URLs.
2. `ArkFilesResponsesAnalyzer` uploads the sample video to Ark Files and calls
   the Responses API.
3. The analyzer normalizes the model output into sample-understanding data.
4. `templateToMigrationProtocolV12()` adapts the result into the editor
   structure.

Main files:

| File | Purpose |
| --- | --- |
| `backend/src/modules/video-understanding/` | Ark integration and normalization |
| `backend/src/workers/analyzer.worker.ts` | Queue worker |
| `shared/lib/template-to-migration.adapter.ts` | Understanding to editor protocol |

## Generation Module

Generation is Remotion-only.

Trigger: `generator.worker` loads the task structure and saved render plan, then
calls `remotionVideoGenerator`.

Flow:

1. Load `MigrationProtocolV12` from the task row.
2. Load the latest `RenderPlanV1`.
3. Validate/sanitize the render plan for supported Remotion features.
4. `remotionRenderer.renderMedia()` writes render props and invokes Remotion.
5. Save `finalVideoUrl`, task status, and completed timestamp.

Main files:

| File | Purpose |
| --- | --- |
| `backend/src/modules/generator/generation-job.processor.ts` | Generation job orchestration |
| `backend/src/modules/generator/remotion-generator.service.ts` | Remotion generator port implementation |
| `backend/src/modules/render-engine/` | Render props and Remotion CLI bridge |
| `remotion/src/RenderPlanVideo.tsx` | Actual Remotion composition |

## Failure Policy

| Stage | Missing dependency | Behavior |
| --- | --- | --- |
| Understanding | Missing Ark key | Analyzer job fails with a configuration error |
| Generation | Missing `RenderPlanV1` | Generation job fails |
| Generation | Remotion render error | Generation job fails and broadcasts the error |
