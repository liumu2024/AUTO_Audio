# V2 Render Delivery

Use this skill to author a missing render effect or to deliver an authorized V2 draft.

## Authoring

- Use `render.author` only when no built-in transition or server-listed component implements the requested effect.
- Declare whether the component purpose is `scene` or `transition`; never reuse one purpose as the other.
- Submit the concise `displayName` used by the user, an `effectBrief`, and concrete, visually checkable `acceptanceCriteria`. Preserve a user-provided Chinese effect name instead of replacing it with a generic label. The coding Agent owns source generation; the Director must not write React source or component IDs.
- When applying a newly authored component in the same turn, make the timeline action depend on `render.author`. The server owns and binds the generated component ID.

The coding Agent receives this complete Skill plus the runtime contract and examples. Its component must follow these rules:

- Allowed imports are only `react`, `remotion`, `@remotion/transitions`, and `@remotion/media`.
- Network calls, network URL literals, resource-loading native JSX tags, Node APIs, browser globals, `Math.random`, `eval`, `require`, and dynamic imports are forbidden. Use only authoritative timeline assets through Remotion media components.
- Prefer deterministic React/CSS composition (`opacity`, `transform`, `filter`) for portable 2D effects.
- Drive every change from Remotion frame hooks; CSS animation/transition, timers, `requestAnimationFrame`, `Date`, and `performance` are forbidden.
- Express every frame offset and animation duration as a fraction of the current `durationInFrames`; never hard-code frame counts from the task duration.
- Read the actual `width`, `height`, and `durationInFrames` from `useVideoConfig()`; never hard-code the task canvas dimensions because preview and later reuse can render at a different size.
- Scale layout dimensions and gaps from the actual width/height so required elements remain distinct and in-frame at every preview or reuse size.
- Treat quantified criteria literally: elements required to remain present need non-zero visible size on every frame; stagger their animation state, not their existence.
- A transition receives `children`, `progress`, `direction`, and optional `params`; it must render `children`, cover the full frame, implement both `entering` and `exiting`, and have correct states at progress 0 and 1.
- A scene receives optional `params` plus authoritative `scene` and `assets`; time-based animation uses `useCurrentFrame`, `useVideoConfig`, and `interpolate`.
- A component is reusable only after audit, compilation, a low-cost Remotion preview, five-frame visual review against every acceptance criterion, and explicit promotion.
- A failed attempt may be repaired once. Failure must not leave a draft component or affect independent actions.

## Delivery

- Read the current V2 draft ID and revision from server state.
- Call `timeline.render` in execute mode for that exact version.
- Do not access V1 state, substitute another revision or silently create a new plan.
- Rendering, media generation and external cost begin only inside the Tool executor.
- Report the actual output/trace on success. On failure, preserve the draft and report the real recovery path; never invent an MP4.
