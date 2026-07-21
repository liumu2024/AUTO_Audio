# Desktop Runtime Boundaries

The desktop runtime has one primary path. It does not require PostgreSQL, Redis,
BullMQ workers, or separate frontend/backend terminals.

```text
npm run desktop:dev
  -> desktop/scripts/dev.mjs
  -> Electron main process
  -> backend API process + Vite frontend process
  -> backend in-process analyzer/generator jobs
  -> Ark understanding / local RenderPlan storage / Remotion render
```

## Responsibilities

| Step | Owner | Responsibility | Must Not Do |
| --- | --- | --- | --- |
| Desktop launcher | `desktop/scripts/dev.mjs` | Start Electron only. Verify root Electron dependency exists. | Start Docker, run Prisma setup, or decide analysis/render behavior. |
| Electron shell | `desktop/main.cjs` | Allocate local ports, start/stop backend and frontend processes, open the app window. | Start BullMQ workers or own video business logic. |
| Frontend | `fonted/` | Collect user intent, upload/attach materials, edit timeline and `RenderPlanV1`, call backend APIs. | Talk directly to Ark, Remotion CLI, local database, or job runner. |
| Backend API | `backend/src/app.ts` and modules | Own task APIs, uploads, pipeline hydration, render-plan persistence, progress events. | Depend on PostgreSQL/Redis in desktop mode. |
| Desktop local store | `backend/src/shared/local-prisma.service.ts` | Persist users, materials, tasks, structures, and render plans in local JSON through the same repository-shaped calls. | Interpret video semantics or render media. |
| Job runner | `backend/src/modules/video-task/task.service.ts` | In desktop mode, dispatch analyzer/generator jobs in-process. | Require BullMQ/Redis for desktop operation. |
| Analyzer job | `backend/src/workers/analyzer.worker.ts` | Convert sample video plus user materials into `MigrationProtocolV12` and `RenderPlanV1`. | Render final MP4. |
| Generator job | `backend/src/workers/generator.worker.ts` | Load saved structure/render plan and call Remotion generation. | Re-understand sample video or rewrite the full plan. |
| Remotion boundary | `backend/src/modules/render-engine/` and `remotion/` | Convert `RenderPlanV1` to Remotion props and render MP4. | Consume raw `MigrationProtocolV12` directly. |

## Desktop Data Contract

- `MigrationProtocolV12` remains the editable semantic structure.
- `RenderPlanV1` remains the only renderable execution plan.
- `PipelineBundle` remains the frontend hydration payload.
- RenderPlan persistence uses `replicationTask.renderPlanJson`; database column
  names such as `render_plan_json` must not leak into module logic.

## Legacy Server Mode

The backend still contains Prisma/PostgreSQL and BullMQ worker support for
server-style development and deployment. That path is separate from the desktop
launcher and should not be used to explain the desktop runtime.
