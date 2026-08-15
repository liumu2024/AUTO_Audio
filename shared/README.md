# Shared

`shared/` contains protocol types and deterministic logic used by backend,
frontend, and Remotion-adjacent tooling. The active creation contract is
`RemotionTimelineSpecV1`.

## Layout

| Path | Responsibility |
| --- | --- |
| `types/` | Cross-runtime contracts for V2 timelines, director coordination, sample understanding, and material facts. |
| `lib/remotion-timeline-validator.ts` | Active V2 timeline structural validation. |
| `lib/material-analysis-heuristic.ts` | Local, deterministic material facts for V2 material selection. |
| `lib/director-action-engine.ts` | Convert director intent into executable action plans. |

## V2 Tool Boundaries

| Tool | Can Do | Must Not Do |
| --- | --- | --- |
| Timeline validator | Check scene timing, asset references, transitions, overlays, audio, and material job boundaries. | Create missing media or change creative intent. |
| Material adapter | Convert local uploaded assets into local render paths and public provider URLs. | Treat localhost/private URLs as provider-readable. |
| Material resolver | Reuse supplied assets or call configured AI video providers for planned jobs. | Exceed the reviewed timeline plan silently. |
| Remotion timeline renderer | Render deterministic composition, overlays, transitions, image motion, and text cards. | Invent realistic video content. |

## Generated Runtime Artifacts

This package is compiled in-place by:

```powershell
npm.cmd --prefix backend run build:shared
```

The emitted `.js`, `.d.ts`, and source-map files are used by backend NodeNext
imports that include `.js` specifiers. Do not delete them as cleanup unless you
regenerate them before running backend or desktop mode.

Frontend builds use `fonted/vite.config.ts` to prefer the `.ts` source files
when bundling shared imports.
