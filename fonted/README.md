# Frontend

`fonted/` is the React + Vite editor UI. It owns user interaction, director
chat, material selection, V2 timeline preview state, and rendered output state.
It does not call Ark, Remotion CLI, local databases, or worker processes
directly.

## Main Areas

| Path | Responsibility |
| --- | --- |
| `src/components/sidebar/` | Director chat, sample/material input, material library UI. |
| `src/components/canvas/` | Preview and generated-player surfaces. |
| `src/components/layout/` | Editor layout and property panels. |
| `src/services/director/` | Frontend director context, action execution, and action-to-tool wiring. |
| `src/services/director/v2DirectorTimeline.ts` | Adapter from director actions to `/api/v2/timeline/preview` and `/api/v2/timeline/run`. |
| `src/stores/` | Zustand stores for creation, V2 timeline, compatibility pipeline hydration, task progress, and director state. |
| `src/types/` | Frontend-facing protocol aliases. Shared protocol source remains in `../shared`. |

## Current Agentic Frontend Flow

```text
Chat / UI intent
  -> director decision context
  -> backend director router or rule fallback
  -> DirectorAction
  -> frontend action executor
  -> V2 timeline preview, material analysis, revision, or render
```

The frontend adapts V2 timeline specs into older timeline/pipeline stores only
so existing panels can keep displaying outline and preview data. It does not
submit the old V1 analyze/copilot task flow.

## V2 Trace

V2 preview/run responses return `traceDir`, which points to:

```text
backend/tmp/v2-agent-trace/<taskId>/
```

Old WebSocket task progress is skipped for `v2_` task IDs to avoid writing V1
`agent-trace` artifacts during the migrated flow.

## Shared Imports

Frontend imports shared TypeScript through the `@shared` alias. The Vite plugin
in `vite.config.ts` redirects shared `.js` specifiers to `.ts` source so browser
builds do not consume NodeNext emitted files.

## Run

```powershell
npm.cmd install
npm.cmd run dev
```

Recommended full local run is the desktop launcher from the project root:

```powershell
npm.cmd run desktop:dev
```

## Build

```powershell
npm.cmd run build
```

The production build writes `dist/`, which is ignored and safe to delete.
