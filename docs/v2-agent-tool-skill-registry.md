# V2 Agent Tool / Skill Registry

All entries below belong to the V2 main chain. `RemotionTimelineSpecV1` is the versioned V2 timeline protocol; no V1 RenderPlan state is read by this registry or dispatcher.

## Execution boundary

The director model returns `skillRequests` and provider-neutral `toolRequests`. The backend Registry validates status, Skill–Tool compatibility, arguments, authorization and duplicate call ids; the backend Dispatcher executes and writes the V2 draft/session/trace. The browser only displays selection, proposal, progress and returned V2 snapshots. Direct preview/run HTTP endpoints remain test/direct-API endpoints, not the formal director execution authority.

## Available now

| Skill | Tool | Boundary |
| --- | --- | --- |
| `v2-timeline-authoring` | `timeline.plan` | Explicitly authorized initial V2 plan or whole-plan revision |
| `sample-reference-analysis` | `sample.analyze`, `timeline.plan` | User-selected sample only; it remains a style/structure reference |
| `subtitle-track-authoring` | `timeline.patch(scope=subtitle)` | Only captions and `caption_tracks` may change |
| `v2-render-delivery` | `timeline.render` | Explicit delivery authorization and current V2 draft required |

## Official Remotion references

`official.remotion-captions` and `official.remotion-render` are controlled, read-only references for V2 skills. `official.remotion-markup` and `official.remotion-best-practices` are maintainer-only. None authorizes arbitrary JSX, package installation, or custom component execution; `allow_custom_component=false` remains enforced.

## Deferred interfaces

Audio, TTS, long-term memory/retrieval and component sandbox tools have definitions but `planned` or `disabled` status, so they are absent from the model-visible available catalog. See [v2-deferred-capabilities.md](./v2-deferred-capabilities.md).
