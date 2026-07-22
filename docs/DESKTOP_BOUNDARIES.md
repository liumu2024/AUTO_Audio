# Desktop Runtime Boundaries

The desktop runtime has one primary path. It does not require PostgreSQL,
external queue services, or separate frontend/backend terminals.

```text
npm run desktop:dev
  -> desktop/scripts/dev.mjs
  -> Electron main process
  -> backend API process + Vite frontend process
  -> V2 Timeline preview/run APIs
  -> optional Ark Seedance material generation
  -> FFmpeg standardization
  -> Remotion timeline render
```

## Responsibilities

| Step | Owner | Responsibility | Must Not Do |
| --- | --- | --- | --- |
| Desktop launcher | `desktop/scripts/dev.mjs` | Start Electron only. Verify root Electron dependency exists. | Start Docker, run Prisma setup, or decide analysis/render behavior. |
| Electron shell | `desktop/main.cjs` | Allocate local ports, start/stop backend and frontend processes, open the app window. | Own video planning or render logic. |
| Frontend | `fonted/` | Collect user intent, upload/attach materials, show V2 timeline review, request render, and display output. | Talk directly to Ark, Remotion CLI, local database, or FFmpeg. |
| Backend API | `backend/src/app.ts` and modules | Own uploads, public asset publishing, V2 timeline preview/run, static output serving, and trace paths. | Depend on external queues for the V2 path. |
| Desktop local store | `backend/src/shared/local-prisma.service.ts` | Persist compatibility task/material rows when old panels need them. | Interpret video semantics or render media. |
| V2 timeline service | `backend/src/pipeline-v2/` | Plan/validate `RemotionTimelineSpecV1`, resolve material jobs, normalize media, render, and write compact trace. | Let provider output bypass validation or normalization. |
| Remotion boundary | `remotion/` | Render deterministic timeline composition, overlays, transitions, image motion, and text cards. | Invent realistic missing video content. |

## Desktop Data Contract

- `RemotionTimelineSpecV1` is the active renderable execution contract.
- `PipelineBundle` is compatibility hydration for older frontend panels.
- `RenderPlanV1` is legacy-only and must not be used as the active creation
  entry point.

## Legacy Notes

Some legacy RenderPlan modules remain so historical UI pieces and task rows can
still be inspected. The old queue-based launch path has been removed from the
active runtime.
