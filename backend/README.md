# Backend

The backend owns upload APIs, V2 timeline preview/run APIs, public asset
publishing, Remotion invocation, FFmpeg preflight/standardization, trace output,
and compatibility reads for historical tasks.

## Module Boundaries

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | Express app, static uploads/renders, API route wiring, WebSocket server. |
| `src/config/` | Environment configuration. |
| `src/shared/prisma.service.ts` | Selects Prisma or local JSON adapter depending on runtime mode. |
| `src/shared/local-prisma.service.ts` | Desktop local storage adapter. It stores data; it does not interpret video semantics. |
| `src/modules/video-task/` | Historical task list/detail/cancel APIs. It no longer creates V1 analyzer/generator jobs. |
| `src/modules/video-understanding/` | Legacy Ark Files/Responses integration retained for older analysis modules. |
| `src/modules/sample-understanding/` | Legacy sample-understanding schema, grounding, normalization, and prompts. |
| `src/modules/render-plan/` | Legacy RenderPlan read/write and validation endpoints retained for old editor surfaces. |
| `src/modules/render-engine/` | Legacy RenderPlan Remotion renderer retained for compatibility. |
| `src/pipeline-v2/` | Active V2 timeline planning, material resolution, AI video adapter, FFmpeg standardization, Remotion rendering, and trace. |

## Active V2 Gates

The backend treats `RemotionTimelineSpecV1` as the active renderable plan.

1. `POST /api/v2/timeline/preview` creates or repairs a timeline spec and
   returns a Chinese planning review.
2. The frontend lets the user revise before an expensive render run.
3. `POST /api/v2/timeline/run` resolves material jobs, normalizes assets, and
   renders through Remotion.
4. V2 trace is written under `backend/tmp/v2-agent-trace/<taskId>/`.

`RenderPlanV1` endpoints remain legacy compatibility APIs. They are not called
by the migrated director chat or export flow.

## Render Output Gate

After Remotion returns an output path, the V2 service records evaluation data
and checks:

- file exists and is readable;
- file size is above the minimum threshold;
- a video stream exists;
- dimensions are valid;
- actual duration is close to the expected timeline duration when ffprobe is
  available.

The frontend marks the run complete only after `/api/v2/timeline/run` returns a
rendered output and trace path.

## Desktop Local Mode

When `DPL304_LOCAL_MODE=true`, PostgreSQL, Prisma setup, and external worker
processes are not required. The backend:

- uses the local JSON adapter;
- exposes the same V2 preview/run APIs as server mode;
- writes runtime artifacts under `tmp/`, `uploads/`, and `v2-renders/`.

The desktop launcher sets this mode automatically.

## Server Mode

Use this mode when developing against PostgreSQL:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:push
npm.cmd run dev
```

## Key APIs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check. |
| `POST` | `/api/uploads` | Upload sample or material files; optionally publish them for external image-to-video providers. |
| `POST` | `/api/v2/timeline/preview` | Create a V2 timeline spec and Chinese planning review. |
| `POST` | `/api/v2/timeline/run` | Resolve materials, standardize media, render, and return output/trace. |
| `GET` | `/api/tasks/:taskId` | Get task row. |
| `GET` | `/api/tasks/:taskId/pipeline` | Get `PipelineBundle`. |
| `PATCH` | `/api/tasks/:taskId/structure` | Save edited `MigrationProtocolV12`. |
| `PATCH` | `/api/tasks/:taskId/render-plan` | Legacy RenderPlan compatibility save. |
| `POST` | `/api/tasks/:taskId/cancel` | Cancel a historical task or an active Remotion render. |
| `WS` | `/ws/tasks?taskId=...` | Legacy progress events. V2 runs use direct API responses and task-store logs. |

## Runtime Artifacts

These directories are ignored and can be deleted:

- `tmp/`
- `uploads/`
- `renders/`
- `dist/`

They are recreated by the app when needed.

## Asset Publication

Uploads are always stored under `backend/uploads/` for local Remotion use. When
the multipart form includes `requirePublicUrl=true`, the upload controller also
requires an externally reachable URL. In formal V2 image-to-video testing, set:

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

The upload response includes `localPath` for Remotion and `publicUrl` for
Seedance. If the asset cannot be published or the URL still points to localhost
or a private network, or the uploaded object cannot be read back from the
published URL, the request fails before the video-generation adapter is called.

## Verification

```powershell
npm.cmd run build
```

`npm run build` type-checks backend and regenerates shared runtime artifacts via
`build:shared`.
