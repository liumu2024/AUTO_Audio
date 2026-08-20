# Backend

The backend owns upload APIs, V2 timeline preview/run APIs, public asset
publishing, Remotion invocation, FFmpeg preflight/standardization, and V2 trace
output.

## Module Boundaries

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | Express app, static uploads/renders, API route wiring, WebSocket server. |
| `src/config/` | Environment configuration. |
| `src/shared/prisma.service.ts` | Selects Prisma or local JSON adapter depending on runtime mode. |
| `src/shared/local-prisma.service.ts` | Desktop local storage adapter. It stores data; it does not interpret video semantics. |
| `src/pipeline-v2/` | Active V2 timeline planning, material resolution, AI video adapter, FFmpeg standardization, Remotion rendering, and trace. |

## Active V2 Gates

The backend treats `RemotionTimelineSpecV1` as the active renderable plan.

1. `POST /api/director/chat` proposes a server-owned creative summary; planning
   starts only after the user confirms it and then saves the resulting revision.
2. The frontend lets the user revise before an expensive render run.
3. `POST /api/v2/timeline-drafts/:draftId/runs` consumes a saved revision,
   resolves material jobs, normalizes assets, and renders through Remotion.
4. V2 trace is written under `backend/tmp/v2-traces/`.

## Render Output Gate

After Remotion returns an output path, the V2 service records evaluation data
and checks:

- file exists and is readable;
- file size is above the minimum threshold;
- a video stream exists;
- dimensions are valid;
- actual duration is close to the expected timeline duration when ffprobe is
  available.

The frontend marks the run complete only after the draft RenderRun returns a
rendered output and trace path.

## Desktop Local Mode

When `DPL304_LOCAL_MODE=true`, PostgreSQL, Prisma setup, and external worker
processes are not required. The backend:

- uses the local JSON adapter;
- exposes the same V2 draft preview/RenderRun APIs as server mode;
- writes runtime artifacts under `tmp/`, `uploads/`, and `v2-renders/`.

The desktop launcher sets this mode automatically.

## Server Mode

Use this mode when developing against PostgreSQL:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run dev
```

## Key APIs

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check. |
| `POST` | `/api/uploads` | Upload sample or material files; optionally publish them for external image-to-video providers. |
| `POST` | `/api/director/chat` | Discuss, confirm, create, or revise a V2 timeline through the Director boundary. |
| `POST` | `/api/v2/timeline-drafts/:draftId/runs` | Render a saved revision and persist its output/trace. |
| `WS` | `/ws/tasks?taskId=...` | Optional task progress and trace events. V2 runs remain driven by their direct API responses. |

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
