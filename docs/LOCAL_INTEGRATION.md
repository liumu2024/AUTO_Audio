# Local Integration

Run the V2 app locally with one desktop command, or run backend/frontend
terminals manually when needed. The old queue-based process model is no longer
part of the active V2 path.

## Start Data Services

PostgreSQL is optional for server-style development. Desktop mode does not need
it.

```powershell
.\script\docker\db-up.ps1
```

Defaults:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/dpl304?schema=public"
```

## Backend Setup

```powershell
cd backend
copy .env.example .env
npm install
npm run db:generate
npm run db:push
npm run db:seed
```

Add the model keys to `backend/.env`:

```env
ARK_API_KEY=ark-your-key
VIDEO_UNDERSTANDING_MODEL=doubao-seed-2-0-mini-260428
V2_VIDEO_GENERATION_MODEL=doubao-seedance-1-5-pro-251215
```

For Remotion, the defaults usually work:

```env
REMOTION_ROOT=../remotion
REMOTION_COMPOSITION_ID=Dpl304Video
RENDER_OUTPUT_DIR=renders
```

By default, Remotion uses its managed compatible browser. Set an executable only for an explicit, tested override:

```env
# 可选：仅在需要显式覆盖 Remotion 管理的浏览器时设置
REMOTION_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
```

## Start Processes

Recommended:

```powershell
npm.cmd run desktop:dev
```

Manual backend/frontend mode:

```powershell
cd backend
npm run dev
```

```powershell
cd fonted
copy .env.example .env.development
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Frontend Environment

```env
VITE_USE_BACKEND=true
VITE_API_BASE=http://localhost:3001
VITE_WS_BASE=ws://localhost:3001
VITE_WS_PATH=/ws/tasks
VITE_USER_ID=1
```

V2 tasks do not use the legacy WebSocket progress stream; the frontend receives
preview/run results directly and writes local task-store logs.

## Expected Flow

1. Upload one sample video as structure/style reference.
2. Upload image/video/audio materials for the actual output.
3. The director uses the shared draft planning service to save a revision.
4. The frontend shows the Chinese planning review and timeline.
5. The user revises or confirms the plan.
6. `POST /api/v2/timeline-drafts/:draftId/runs` resolves material jobs, optionally calls the
   video model, normalizes media, and renders MP4.
7. V2 trace is written under `backend/tmp/v2-traces/tasks/<taskId>/` (director sessions use `sessions/<workspace>/operations/<operation>/`).

## Quick Checks

| Check | Command or signal |
| --- | --- |
| Backend | Open `http://localhost:3001/health` |
| V2 check | `npm.cmd run v2:timeline:check` |
| V2 render | `/api/v2/timeline-drafts/:draftId/runs` returns `outputUrl` and `traceDir` |

## Common Issues

**Files API 401 or key format error**

- The key in `.env` is invalid or incomplete.
- Do not use an endpoint id (`ep-...`) as the API key.
- Update `ARK_API_KEY` or `VIDEO_UNDERSTANDING_API_KEY`, then restart backend
  process.

**Preview or render fails**

- Backend is not running.
- Local uploaded images were requested by an external provider but public asset
  publishing is not configured.
- `FFMPEG_BIN` is missing or points to a limited FFmpeg build.

**AI video generation fails**

- `V2_VIDEO_GENERATION_API_KEY` or `ARK_API_KEY` is missing.
- The provider rejected the prompt/image.
- The run should fall back when the reviewed material job contains a usable
  fallback scene or image.

**WebSocket does not connect**

- Backend is not running on port 3001.
- `VITE_WS_BASE` or `VITE_WS_PATH` does not match backend config.
