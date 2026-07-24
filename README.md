# ByteDance DPL304 AI Video Studio

## V2 Direction

The project is being refactored toward a V2 timeline-first hybrid
video-production pipeline:

```text
Agent planner -> RemotionTimelineSpec v1 -> material jobs -> standardized assets -> Remotion full timeline renderer
```

In V2, external video models own realistic visual content that is not practical
to produce with code. Remotion owns deterministic programmatic video work:
multi-scene timeline composition, transitions, captions, image motion, text
cards, product callouts, and other editable graphics. FFmpeg owns media
standardization and final packaging.

Run the V2 timeline smoke:

```powershell
npm.cmd run v2:smoke
```

Run the default V2 timeline contract check:

```powershell
npm.cmd run v2:check
```

In desktop dev mode, open the left navigation item `Timeline` to run the new
timeline-first path against a local video path such as
`../example_videos/9.mp4`. The page first produces a Chinese planning review
and editable `RemotionTimelineSpecV1`; only after review does it run material
resolution, media standardization, Remotion rendering, and trace output.

The old overlay-first V2 path has been removed from the active V2 code. Real
Seedance calls are triggered only when a reviewed timeline contains
`generate_video` material jobs and `/api/v2/timeline/run` executes them.

Read the V2 architecture notes:

- [V2 Architecture](docs/V2_ARCHITECTURE.md)

AI Video Studio is now a V2 timeline-first hybrid video-production prototype.
It uses a director agent to turn user intent, sample references, and creative
materials into a strict `RemotionTimelineSpecV1`. External video models can
produce realistic missing shots, Remotion renders deterministic timeline
graphics and transitions, and FFmpeg normalizes media before the final package.

The previous `RenderPlanV1` workflow is no longer an active creation path. Some
types and read APIs remain only for historical data and older editor surfaces.

## Current Architecture

```text
User intent + sample video + user materials
  -> Director agent routing
  -> V2 Timeline preview
  -> RemotionTimelineSpecV1 validation and Chinese planning review
  -> User review / revision
  -> Material job resolution
  -> AI video generation when planned and available
  -> FFmpeg standardization
  -> Remotion full timeline render
  -> V2 evaluation trace
  -> completed MP4 or explicit fallback/failure
```

The system is not an open-ended video generator. Remotion is the only final
render path, and it can only render from available assets, generated props, and
implemented effects. Missing media is never silently invented.

## Package Ownership

| Path | Owner / Role |
| --- | --- |
| `desktop/` | Electron shell and one-command local launcher. It starts backend and frontend, but owns no video logic. |
| `fonted/` | React + Vite editor, director chat, material library, V2 timeline preview, and render state. |
| `backend/` | Express APIs, uploads/public asset publishing, V2 timeline preview/run services, Remotion calls, FFmpeg checks, and trace output. |
| `shared/` | Cross-runtime protocols and deterministic tools: V2 timeline spec, validator, fixtures, material adapters, and legacy compatibility types. |
| `remotion/` | Remotion compositions. Legacy consumes `RenderPlanV1`; V2 Timeline consumes `RemotionTimelineSpecV1`. |
| `docs/` | Architecture and runtime boundary notes. |
| `script/docker/` | PostgreSQL helper scripts for server-style development. |

## Core Contracts

| Contract | Responsibility |
| --- | --- |
| `RemotionTimelineSpecV1` | Active V2 render contract: canvas, assets, scenes, overlays, transitions, audio, and material jobs. |
| `V2TimelinePlanningReview` | Human-readable Chinese review of the generated timeline before expensive generation/rendering. |
| `PipelineBundle` | Compatibility hydration payload for existing frontend panels. V2 adapts timeline specs into this shape. |
| `DirectorSessionState` | Agent-side execution state, action ledger, render revision status, and recoverable error context. |
| `RenderPlanV1` | Legacy render contract retained for historical task reading and older UI pieces only. |

## Agentic Optimizations

| Area | Current behavior |
| --- | --- |
| Intent routing | Director agent routes user messages into natural chat, V2 preview, revision, material analysis, or render actions. |
| Timeline validation | V2 validator checks scene timing, asset references, overlay ranges, transitions, audio ranges, and material job boundaries. |
| Soft review gate | Planner output is converted into a Chinese planning review so the user can revise before costly generation. |
| Material fallback | Planned AI-video jobs can fall back to static image motion or Remotion card scenes when generation is unavailable. |
| Media normalization | FFmpeg preflight and standardization protect Remotion/FFmpeg composition from provider format drift. |
| Output trace | Every V2 run writes a compact task-scoped trace under `backend/tmp/v2-agent-trace/<taskId>/`. |

## Local Desktop Run

Install dependencies once:

```powershell
npm.cmd install
npm.cmd --prefix backend install
npm.cmd --prefix fonted install
npm.cmd --prefix remotion install
npm.cmd --prefix backend run build:shared
```

Start the local desktop app:

```powershell
npm.cmd run desktop:dev
```

Desktop mode does not require PostgreSQL, Redis, Prisma setup, or separate
worker terminals. Electron starts the backend API and Vite frontend; the active
creation path is the V2 Timeline preview/run API.

Use this smoke check when you only want to verify startup:

```powershell
$env:DPL304_DESKTOP_SMOKE_MS='8000'; npm.cmd run desktop:dev
```

## Server-Style Development

Use this mode when you specifically want PostgreSQL-backed task storage:

```powershell
.\script\docker\db-up.ps1

npm.cmd --prefix backend run db:generate
npm.cmd --prefix backend run db:push
npm.cmd --prefix backend run dev
npm.cmd --prefix fonted run dev
```

## Environment Notes

Backend keys live in `backend/.env`:

```env
ARK_API_KEY=...
ARK_API_KEY_NAME=api-key-...
# or VIDEO_UNDERSTANDING_API_KEY=...
VIDEO_UNDERSTANDING_MODEL=doubao-seed-2-0-mini-260428
VIDEO_UNDERSTANDING_FILES_URL=https://ark.cn-beijing.volces.com/api/v3/files
VIDEO_UNDERSTANDING_RESPONSES_URL=https://ark.cn-beijing.volces.com/api/v3/responses
```

Remotion settings:

```env
REMOTION_ROOT=../remotion
REMOTION_COMPOSITION_ID=Dpl304Video
RENDER_OUTPUT_DIR=renders
FFMPEG_BIN=C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe
# REMOTION_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Legacy RenderPlan review is off by default and is not part of the V2 main path:

```env
ENABLE_RENDER_PLAN_LLM_REVIEW=false
```

Set it to `true` only when explicitly inspecting the legacy RenderPlan path.

V2 generated main-video model configuration:

```env
V2_VIDEO_GENERATION_PROVIDER=ark-seedance
V2_VIDEO_GENERATION_API_KEY=...
V2_VIDEO_GENERATION_MODEL=doubao-seedance-1-5-pro-251215
V2_VIDEO_GENERATION_SUBMIT_URL=https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
V2_VIDEO_GENERATION_STATUS_URL_TEMPLATE=https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
# V2_VIDEO_GENERATION_DOWNLOAD_URL_TEMPLATE=
# V2_VIDEO_GENERATION_DEFAULT_IMAGE_URL=
V2_VIDEO_GENERATION_TIMEOUT_MS=180000
V2_VIDEO_GENERATION_POLL_INTERVAL_MS=3000
V2_GENERATED_VIDEO_WIDTH=1080
V2_GENERATED_VIDEO_HEIGHT=1920
V2_GENERATED_VIDEO_FPS=30
```

`V2_VIDEO_GENERATION_API_KEY` can be left empty when `ARK_API_KEY` is already
configured. Ark Seedance image-to-video jobs need either `input_image_url` in
the reviewed planner draft, the V2 frontend `I2V input image URL` field, or
`V2_VIDEO_GENERATION_DEFAULT_IMAGE_URL`.

For real image-to-video calls with locally uploaded images, configure the asset
publisher instead of manually editing a per-file URL:

```env
ASSET_PUBLISHER_PROVIDER=tos
ASSET_PUBLISHER_PUBLIC_BASE_URL=https://<bucket-or-cdn-domain>
TOS_ACCESS_KEY_ID=...
TOS_ACCESS_KEY_SECRET=...
TOS_REGION=cn-beijing
TOS_ENDPOINT=tos-cn-beijing.volces.com
TOS_BUCKET=...
TOS_OBJECT_PREFIX=dpl304/uploads
ASSET_PUBLISHER_VERIFY_PUBLIC_URL=true
ASSET_PUBLISHER_VERIFY_TIMEOUT_MS=10000
```

`POST /api/uploads` stores the file locally for Remotion and, when requested by
the V2 page, publishes it to TOS for Seedance. The response contains `localPath`
for local rendering and `publicUrl` for external providers. If public publishing
is required but not configured, or if the uploaded object cannot be read from the
published URL, upload fails before the provider call.

## Runtime Trace

The active desktop flow writes V2 Timeline trace under:

```text
backend/tmp/v2-agent-trace/<taskId>/
  00-summary/summary.zh.md
  01-input/timeline-planner-input.json
  02-planning/timeline-spec.json
  02-plan-review/timeline-review.zh.md
  03-material-jobs/timeline-material-resolution.json
  04-material-assets/timeline-standardized-assets.json
  05-remotion-props/timeline-render-spec.json
  06-remotion-render/timeline-render.log
  07-evaluation/timeline-evaluation.json
```

If PowerShell displays Chinese text as mojibake, inspect the files in an editor
with UTF-8 enabled. The trace writer stores these files as UTF-8.

The old V1 trace writer and its environment settings are retained only for
legacy tooling that is not called by the current desktop UI flow.

## Generated And Runtime Artifacts

Safe to delete at any time:

| Path | Why |
| --- | --- |
| `fonted/dist/` | Vite production build output. |
| `backend/tmp/` | debug artifacts, render props, local smoke DB. |
| `backend/uploads/` | local uploaded files. |
| `backend/renders/` | rendered MP4 outputs. |
| `backend/v2-renders/` | V2 Timeline rendered MP4 outputs and render props. |
| `tmp/`, `output/` | ad hoc local artifacts. |
| `remotion/public/render-lab-cache/` | render lab frame cache. |

Do not casually delete `shared/**/*.js`, `shared/**/*.d.ts`, or their maps.
They are generated from shared TypeScript, but backend runtime imports use
NodeNext `.js` specifiers. Regenerate them with:

```powershell
npm.cmd --prefix backend run build:shared
```

## Verification

```powershell
npm.cmd --prefix backend run build
npm.cmd --prefix fonted run build
$env:DPL304_DESKTOP_SMOKE_MS='8000'; npm.cmd run desktop:dev
```

Known non-fatal warnings:

- Frontend build may warn that the main chunk is larger than 500 kB.
- Backend startup may warn if Ark keys look truncated.

## More Docs

- [Desktop Runtime Boundaries](docs/DESKTOP_BOUNDARIES.md)
- [V2 Architecture](docs/V2_ARCHITECTURE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Mock Data](docs/MOCK_DATA.md)
