# V2 Deferred Capabilities

This document records V2 interfaces that deliberately do **not** execute in the current release. Planned tools are excluded from the director's available tool catalog, so the model cannot claim they ran.

| Capability | Current state | Target Tool / Skill | V2 extension point | Preconditions | Acceptance case | Non-negotiable boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Long-term creative memory | Interface defined, not implemented | `memory.search`, `memory.propose_write` | `CreativeMemoryRecord`, chunks, hybrid retrieval result | Explicit consent; scope and ownership filtering | Confirmed preference is retrieved as a labeled suggestion, never silently applied | Current prompt and current V2 draft always win; unconfirmed memories do not affect a project |
| Hybrid memory retrieval | Interface defined, not implemented | `memory.search` | filter → keyword/vector recall → fusion → small rerank → dedupe/conflict resolution | Embedding provider and persistent store | Large corpus returns 3–5 source-labelled, relevant memories | No raw historical chat used as hidden instruction |
| Project audio plan | Interface defined, not implemented | `audio.plan`, `audio.mix` | `V2AudioAssetDescriptor` and V2 audio clips | Licensed/user assets and audio policy | BGM, embedded generated sound and independent tracks are distinguishable | Generated-video embedded audio is never misreported as editable project BGM |
| TTS narration and subtitle alignment | Interface defined, not implemented | `audio.generate_tts`, `audio.align` | `V2SubtitleNarrationAlignment` | TTS provider with duration/word timing | Caption narration fits caption and scene ranges; large mismatch returns to revision | No speech generation without explicit authorization |
| Remotion-first component sandbox | Interface defined, disabled | `component.sandbox_preview`, `component.promote` | fixed component contract, isolated build/preview/promote lifecycle | Sandboxed compilation, validation and rollback | Approved component can be promoted after preview | `allow_custom_component=false` remains true for the current V2 renderer |

## Future retrieval contract

Retrieval must first apply owner/project permissions and structured constraints (format, industry, aspect ratio, visual strategy), then hybrid keyword/vector recall, fusion ranking, small-candidate semantic reranking, deduplication and conflict resolution. Return only a few editable suggestions with their source and confidence.

## Subtitle narration contract

For subtitle-style narration: lock visible caption text → generate TTS → obtain actual duration and word timings → validate caption/audio/scene ranges → make small timing adjustments or return a revision request for large deviation. FFmpeg may normalize/mix existing audio but cannot synthesize speech.
