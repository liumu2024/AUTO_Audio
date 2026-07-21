# Backend

The backend owns task APIs, task persistence, analyzer/generator orchestration,
RenderPlan persistence, Remotion invocation, WebSocket progress, and final
output quality gates.

## Module Boundaries

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | Express app, static uploads/renders, API route wiring, WebSocket server. |
| `src/config/` | Environment and Redis/BullMQ configuration. |
| `src/shared/prisma.service.ts` | Selects Prisma or local JSON adapter depending on runtime mode. |
| `src/shared/local-prisma.service.ts` | Desktop local storage adapter. It stores data; it does not interpret video semantics. |
| `src/modules/video-task/` | Task creation, cancellation, list/detail APIs, queue or in-process job dispatch. |
| `src/modules/video-understanding/` | Ark Files/Responses integration and normalization. |
| `src/modules/sample-understanding/` | Sample-understanding schema, grounding, normalization, and prompts. |
| `src/modules/render-plan/` | RenderPlan read/write, server-side validation/repair, optional LLM review. |
| `src/modules/generator/` | Generator job processor and Remotion generator port. |
| `src/modules/render-engine/` | Render props creation, Remotion CLI call, output quality inspection. |
| `src/workers/` | Analyzer and generator worker entrypoints for BullMQ or local in-process execution. |

## RenderPlan Gates

The backend treats `RenderPlanV1` as the only renderable plan.

1. `PATCH /api/tasks/:taskId/render-plan` validates with `before_save`.
2. `POST /api/tasks/:taskId/copilot` persists any submitted plan through the
   same save gate.
3. Generator jobs load the saved plan and run `before_render` validation/repair
   before calling Remotion.
4. Optional LLM review can add advisory findings only. It does not decide
   whether a plan is valid.

## Render Output Gate

After Remotion returns an output path, the generator checks:

- file exists and is readable;
- file size is above the minimum threshold;
- a video stream exists;
- dimensions are valid;
- actual duration is close to the expected RenderPlan duration when ffprobe is
  available.

The task is marked `COMPLETED` only after this check passes.

## Desktop Local Mode

When `DPL304_LOCAL_MODE=true`, PostgreSQL, Redis, Prisma setup, and external
BullMQ worker processes are not required. The backend:

- uses the local JSON adapter;
- dispatches analyzer/generator jobs in-process;
- still uses the same API, RenderPlan gates, Remotion renderer, and quality
  checks.

The desktop launcher sets this mode automatically.

## Server Mode

Use this mode when developing against PostgreSQL, Redis, and BullMQ:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run dev
npm.cmd run worker:analyzer
npm.cmd run worker:generator
```

The worker commands should run in separate terminals.

## Key APIs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check. |
| `POST` | `/api/uploads` | Upload sample or material files. |
| `POST` | `/api/tasks/analyze` | Create sample-understanding task. |
| `GET` | `/api/tasks/:taskId` | Get task row. |
| `GET` | `/api/tasks/:taskId/pipeline` | Get `PipelineBundle`. |
| `PATCH` | `/api/tasks/:taskId/structure` | Save edited `MigrationProtocolV12`. |
| `PATCH` | `/api/tasks/:taskId/render-plan` | Save edited `RenderPlanV1` through validation/repair. |
| `POST` | `/api/tasks/:taskId/copilot` | Enqueue or run Remotion generation. |
| `POST` | `/api/tasks/:taskId/cancel` | Cancel queued/running generation. |
| `WS` | `/ws/tasks?taskId=...` | Progress events. |

## Runtime Artifacts

These directories are ignored and can be deleted:

- `tmp/`
- `uploads/`
- `renders/`
- `dist/`

They are recreated by the app when needed.

## Verification

```powershell
npm.cmd run build
```

`npm run build` type-checks backend and regenerates shared runtime artifacts via
`build:shared`.
