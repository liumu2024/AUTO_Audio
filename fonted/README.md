# Frontend

`fonted/` is the React + Vite editor UI. It owns user interaction, director
chat, material selection, timeline/preview state, and editable `RenderPlanV1`
state. It does not call Ark, Remotion CLI, local databases, or worker processes
directly.

## Main Areas

| Path | Responsibility |
| --- | --- |
| `src/components/sidebar/` | Director chat, sample/material input, material library UI. |
| `src/components/canvas/` | Preview and generated-player surfaces. |
| `src/components/layout/` | Editor layout and property panels. |
| `src/services/director/` | Frontend director context, action execution, and action-to-tool wiring. |
| `src/services/pipeline/` | Analysis/generation API calls, uploads, cache reuse, polling, restore. |
| `src/stores/` | Zustand stores for creation, pipeline, render plan, timeline, task progress, and director state. |
| `src/types/` | Frontend-facing protocol aliases. Shared protocol source remains in `../shared`. |

## Current Agentic Frontend Flow

```text
Chat / UI intent
  -> director decision context
  -> backend director router or rule fallback
  -> DirectorAction
  -> frontend action executor
  -> sample/material analysis, RenderPlan generation, edit, or render
```

The frontend may select a RenderPlan candidate and run validation/repair before
submitting, but the backend still repeats the critical save/render checks.

## Analysis Cache

`src/services/pipeline/analysisCache.ts` stores only a small local mapping from
an exact input fingerprint to a completed backend `taskId`.

Cache key inputs:

- sample media fingerprint;
- material fingerprints;
- prompt;
- aspect ratio;
- duration;
- style intensity.

On a cache hit, the frontend still asks the backend for the pipeline bundle. If
the backend task is gone or incomplete, the cache entry is dropped and normal
analysis runs.

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
