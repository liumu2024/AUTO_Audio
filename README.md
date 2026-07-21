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

AI Video Studio is a local-first short-video understanding, planning, editing,
and Remotion rendering prototype. It analyzes a sample video as structure and
style reference, binds user materials into an editable `RenderPlanV1`, validates
and repairs that plan within deterministic boundaries, then renders the final
MP4 with Remotion.

The `RenderPlanV1` path below is now considered the legacy v1 pipeline while V2
is developed in parallel.

## Current Architecture

```text
User intent + sample video + user materials
  -> Director agent routing
  -> Sample understanding / material analysis
  -> MigrationProtocolV12
  -> RenderPlanV1 candidate generation and scoring
  -> RenderPlan hard validation
  -> Deterministic repair when safe
  -> Frontend editing
  -> Backend before-save / before-render validation
  -> Remotion render
  -> Render output quality gate
  -> completed MP4 or explicit failure
```

The system is not an open-ended video generator. Remotion is the only final
render path, and it can only render from available assets, generated props, and
implemented effects. Missing media is never silently invented.

## Package Ownership

| Path | Owner / Role |
| --- | --- |
| `desktop/` | Electron shell and one-command local launcher. It starts backend and frontend, but owns no video logic. |
| `fonted/` | React + Vite editor, director chat, material library, timeline, preview, and RenderPlan editing. |
| `backend/` | Express APIs, task persistence, local/Prisma adapters, analyzer/generator orchestration, Remotion calls, output quality checks. |
| `shared/` | Cross-runtime protocols and deterministic tools: timeline derivation, RenderPlan builder, validator, repair, candidate scoring. |
| `remotion/` | Remotion compositions. Legacy consumes `RenderPlanV1`; V2 Timeline consumes `RemotionTimelineSpecV1`. |
| `docs/` | Architecture and runtime boundary notes. |
| `script/docker/` | PostgreSQL and Redis helpers for server-style development. |

## Core Contracts

| Contract | Responsibility |
| --- | --- |
| `MigrationProtocolV12` | Semantic source of truth for editable structure, timing, intent, and sample-derived guidance. |
| `RenderPlanV1` | Only renderable execution plan: scenes, assets, overlays, audio, effects, and transitions. |
| `PipelineBundle` | Frontend hydration payload containing structure, timeline, outline, materials, render plan, and generation state. |
| `DirectorSessionState` | Agent-side execution state, action ledger, render revision status, and recoverable error context. |

## Agentic Optimizations

| Area | Current behavior |
| --- | --- |
| Intent routing | Director agent routes user messages into explicit actions and execution steps. |
| RenderPlan validation | Hard validator checks schema, assets, scene timing, effect layers, overlays, audio, and placeholder URLs. |
| Deterministic repair | Repairs only safe structural issues such as missing asset refs, invalid time ranges, unsupported effects, and non-renderable assets. |
| Candidate scoring | Builds a small set of RenderPlan candidates and selects by transparent metrics: validation status, asset coverage, unique material use, timeline fit, effect readiness, and prompt fit. |
| Cache reuse | Reuses completed analysis tasks only when sample, materials, prompt, aspect ratio, duration, and style intensity match exactly. |
| Output quality | Rendered files are checked for readability, minimum size, video stream, dimensions, and duration drift before task completion. |
| Optional LLM review | Disabled by default. When enabled, it can provide structured review findings but cannot bypass validator/repair or invent assets. |

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
worker terminals. Electron starts the backend API and Vite frontend, while the
backend runs analyzer and generator jobs in-process. Local desktop task data is
stored outside the repo under Electron user data.

Use this smoke check when you only want to verify startup:

```powershell
$env:DPL304_DESKTOP_SMOKE_MS='8000'; npm.cmd run desktop:dev
```

## Server-Style Development

Use this mode when you specifically want PostgreSQL, Redis, and BullMQ workers:

```powershell
.\script\docker\db-up.ps1

npm.cmd --prefix backend run db:generate
npm.cmd --prefix backend run db:push
npm.cmd --prefix backend run dev
npm.cmd --prefix backend run worker:analyzer
npm.cmd --prefix backend run worker:generator
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

Optional LLM RenderPlan review is off by default:

```env
ENABLE_RENDER_PLAN_LLM_REVIEW=false
```

Set it to `true` only when you want advisory review findings. Hard validation
and deterministic repair remain the final gates.

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

## Runtime Trace

Runtime trace is written under one task-scoped directory by default:

```text
backend/tmp/agent-trace/<taskId>/
  trace.jsonl
  manifest.json
  artifacts/
    sample_understanding/
    effect_planning/
    render_plan/
    component_authoring/
    render/
    quality_gate/
```

`trace.jsonl` is the ordered event stream. Each line uses
`agent_trace_event.v1` and records `phase`, `actor`, `event`, `status`,
`summary`, optional metrics, and artifact references. `manifest.json` is the
current index of trace files for quick inspection.

Relevant settings:

```env
ENABLE_AGENT_TRACE=true
AGENT_TRACE_DIR=tmp/agent-trace
```

Leave `VIDEO_UNDERSTANDING_DEBUG_ARTIFACT_DIR`,
`EFFECT_DEBUG_ARTIFACT_DIR`, and `REMOTION_COMPONENT_AUTHORING_DEBUG_DIR`
unset unless you intentionally want to split module artifacts away from the
unified trace directory.

V2 Timeline trace is written separately under:

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
