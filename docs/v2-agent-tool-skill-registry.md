# V2 Agent Tool / Skill Registry

All entries below belong to the V2 main chain. `RemotionTimelineSpecV1` is the versioned V2 timeline protocol; no V1 RenderPlan state is read by this registry or dispatcher.

## Execution boundary

The director model returns `skillRequests` and provider-neutral `toolRequests`. The backend resolves them into one authoritative execution plan: every Tool must bind to a Skill selected in the same turn; that Skill's package manifest and `SKILL.md` are loaded with declared read-only dependencies; Tool arguments are normalized against the model-visible input schema. The Dispatcher then executes and writes real V2 state.

After execution, actual Tool results and the updated workspace facts are sent back to the director model in a non-executing result pass. That pass produces the final natural reply and cannot request more Tools. If it fails, the reply is grounded directly in the Tool result instead of using the pre-execution message.

Read and draft tools run from the coherent model decision without a second textual authorization check. Delivery tools require a coherent current-turn `delivery + RENDER + execute` decision because they consume external resources or produce final output; no exact prompt substring is used. The browser only displays selection, loaded instructions, proposal, progress, returned V2 snapshots and final reply. Direct preview/run HTTP endpoints remain test/direct-API endpoints, not the formal director execution authority.

## Runtime Skill package

Each V2 Skill directory has one authoritative `manifest.ts` and one `SKILL.md`. The manifest supplies version, card, stage, Tools, dependencies, prerequisites, required V2 facts, output requirements, validation and recovery. The full instructions are loaded only after the model selects the Skill. Trace records source, version, SHA-256 and the exact loaded instructions.

Declared dependencies such as `official.remotion-captions` are loaded as controlled references. A dependency cannot independently select or authorize a Tool.

## Tool contract

Available Tool cards expose their input JSON Schema to the director model. Runtime validation rejects unknown fields, unsupported modes, invalid scopes, Skill/Tool mismatches and Tool Skills not selected in the same turn. Normalized arguments are the only arguments passed to the executor.

The current executors consume:

- selected sample ID for `sample.analyze`;
- optional material IDs for `material.inspect`;
- planning instruction and stage context for `timeline.plan`;
- subtitle scope, instruction and target IDs for `timeline.patch`;
- draft ID and revision for `timeline.render`.

Each Tool exception is converted to a structured failed result with recovery guidance. The workspace, idempotency ledger and trace are still saved.

## Available now

| Skill | Tool | Boundary |
| --- | --- | --- |
| `v2-timeline-authoring` | `timeline.plan` | Model-selected initial V2 plan or whole-plan revision |
| `sample-reference-analysis` | `sample.analyze`, `timeline.plan` | User-selected sample only; it remains a style/structure reference |
| `subtitle-track-authoring` | `timeline.patch(scope=subtitle)` | Model-selected draft change; only captions and `caption_tracks` may change |
| `v2-render-delivery` | `timeline.render` | Explicit delivery authorization and current V2 draft required |

## Official Remotion references

`official.remotion-captions` and `official.remotion-render` are controlled, read-only references for V2 skills. `official.remotion-markup` and `official.remotion-best-practices` are maintainer-only. None authorizes arbitrary JSX, package installation, or custom component execution; `allow_custom_component=false` remains enforced.

## Trace evidence

Every Tool-bearing director turn records:

- `skill-tool-execution-plan.json`: requested/selected/rejected Skills, rejected Tools, loaded hashes and normalized stages;
- `loaded-skill-instructions.md`: the exact instruction packages used;
- `tool-<callId>.json`: normalized request and actual result;
- `tool-result-model-response.audit.json`: the result-model response or grounded fallback;
- `turn-result.json`: initial/result model calls, Tool outcomes, state diff and response continuity.

## Deferred interfaces

Audio, TTS, long-term memory/retrieval and component sandbox tools have definitions but `planned` or `disabled` status, so they are absent from the model-visible available catalog. See [v2-deferred-capabilities.md](./v2-deferred-capabilities.md).
