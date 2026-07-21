# Shared

`shared/` contains protocol types and deterministic logic used by backend,
frontend, Remotion-adjacent tooling, and smoke scripts.

## Layout

| Path | Responsibility |
| --- | --- |
| `types/` | Cross-runtime contracts: migration, pipeline, director, RenderPlan, capability, timeline. |
| `lib/pipeline-builder.ts` | Derive outline and timeline models from `MigrationProtocolV12`. |
| `lib/render-plan-builder.ts` | Build initial `RenderPlanV1` from structure and materials. |
| `lib/render-plan-materials.ts` | Bind user materials into an existing RenderPlan. |
| `lib/render-plan-validator.ts` | Hard structural validation before save/render. |
| `lib/render-plan-repair.ts` | Deterministic repair for known recoverable RenderPlan errors. |
| `lib/render-plan-candidates.ts` | Generate and score a small set of RenderPlan candidates. |
| `lib/director-action-engine.ts` | Convert director intent into executable action plans. |
| `mocks/` | Development fixtures and smoke-test data only. |

## RenderPlan Tool Boundaries

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
