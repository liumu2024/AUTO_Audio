# Local Integration

Run the app locally with PostgreSQL, Redis, backend workers, and the frontend.

## Start Data Services

Docker Desktop is recommended.

```powershell
.\script\docker\db-up.ps1
```

Defaults:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/dpl304?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
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

Add the understanding key to `backend/.env`:

```env
ARK_API_KEY=ark-your-key
# or VIDEO_UNDERSTANDING_API_KEY=ark-your-key
```

For Remotion, the defaults usually work:

```env
REMOTION_ROOT=../remotion
REMOTION_COMPOSITION_ID=Dpl304Video
RENDER_OUTPUT_DIR=renders
```

If Windows cannot locate Chrome or Edge automatically:

```env
REMOTION_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
```

## Start Processes

Use separate terminals.

```powershell
cd backend
npm run dev
```

```powershell
cd backend
npm run worker:analyzer
```

```powershell
cd backend
npm run worker:generator
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

## Expected Flow

1. Upload one sample video and optional reference materials.
2. Send an analysis request through `POST /api/tasks/analyze`.
3. `analyzer.worker` writes `structureJson` to the task row.
4. The frontend loads `GET /api/tasks/:id/pipeline`.
5. The user edits structure and render plan.
6. `POST /api/tasks/:id/copilot` enqueues Remotion generation.
7. `generator.worker` renders MP4 and pushes progress over WebSocket.

## Quick Checks

| Check | Command or signal |
| --- | --- |
| Backend | Open `http://localhost:3001/health` |
| Redis | `redis-cli ping` returns `PONG` |
| Analyzer worker | Analysis task reaches `WAITING_USER_EDIT` |
| Generator worker | Generation task reaches `COMPLETED` and has `finalVideoUrl` |

## Common Issues

**Files API 401 or key format error**

- The key in `.env` is invalid or incomplete.
- Do not use an endpoint id (`ep-...`) as the API key.
- Update `ARK_API_KEY` or `VIDEO_UNDERSTANDING_API_KEY`, then restart backend
  and workers.

**Waiting for structureJson times out**

- `worker:analyzer` is not running.
- Redis is down or BullMQ could not enqueue the job.
- `DATABASE_URL` points to the wrong database.

**Generation fails**

- `worker:generator` is not running.
- `render_plan` is missing for the task.
- Remotion dependencies or browser executable are missing.

**WebSocket does not connect**

- Backend is not running on port 3001.
- `VITE_WS_BASE` or `VITE_WS_PATH` does not match backend config.
