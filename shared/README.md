# Shared

`shared/` contains protocol types and deterministic logic used by backend,
frontend, Remotion-adjacent tooling, and smoke scripts. The active creation
contract is `RemotionTimelineSpecV1`; `RenderPlanV1` remains for legacy
compatibility only.

## Layout

| Path | Responsibility |
| --- | --- |
| `types/` | Cross-runtime contracts: V2 timeline, director, compatibility pipeline, capability, and legacy RenderPlan. |
| `lib/remotion-timeline-validator.ts` | Active V2 timeline structural validation. |
| `lib/remotion-timeline-fixtures.ts` | V2 timeline fixtures used by smoke tests. |
| `lib/pipeline-builder.ts` | Compatibility outline/timeline derivation for older frontend panels. |
| `lib/render-plan-builder.ts` | Legacy `RenderPlanV1` builder, retained outside the V2 main path. |
| `lib/render-plan-materials.ts` | Legacy RenderPlan material binder. |
| `lib/render-plan-validator.ts` | Legacy RenderPlan structural validation. |
| `lib/render-plan-repair.ts` | Legacy deterministic RenderPlan repair. |
| `lib/render-plan-candidates.ts` | Legacy RenderPlan candidate scoring. |
| `lib/director-action-engine.ts` | Convert director intent into executable action plans. |
| `mocks/` | Development fixtures and smoke-test data only. |

## V2 Tool Boundaries

| Tool | Can Do | Must Not Do |
| --- | --- | --- |
| Timeline validator | Check scene timing, asset references, transitions, overlays, audio, and material job boundaries. | Create missing media or change creative intent. |
| Material adapter | Convert local uploaded assets into local render paths and public provider URLs. | Treat localhost/private URLs as provider-readable. |
| Material resolver | Reuse supplied assets or call configured AI video providers for planned jobs. | Exceed the reviewed timeline plan silently. |
| Remotion timeline renderer | Render deterministic composition, overlays, transitions, image motion, and text cards. | Invent realistic video content. |

## Legacy RenderPlan Tool Boundaries

| Tool | Can Do | Must Not Do |
| --- | --- | --- |
| Builder | Convert structure/materials into an initial plan. | Judge final renderability alone. |
| Material binder | Rebind scenes to existing user assets. | Invent missing media. |
| Validator | Report schema/resource/timing/effect/audio issues. | Mutate the plan. |
| Repair | Fix deterministic structural issues and revalidate. | Rewrite creative intent or create assets/presets. |
| Candidate selector | Compare small plan variants by transparent metrics. | Run LLM self-evaluation. |

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

## Fixture Rules

- `mocks/` is for local development and tests.
- Sample video data is structure/style evidence only.
- Final renderable media must come from user materials, system assets, or
  existing sample-reference audio when explicitly configured.
- Do not store real API keys, signed private URLs, or private generated media.
