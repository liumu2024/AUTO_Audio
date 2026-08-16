# V2 Render Delivery

Use this skill to author a missing render effect or to deliver an authorized V2 draft.

## Authoring

- Use `render.author` only when no built-in transition or server-listed component implements the requested effect.
- Declare whether the component purpose is `scene` or `transition`; never reuse one purpose as the other.
- Submit the concise `displayName` used by the user, an `effectBrief`, and concrete, visually checkable `acceptanceCriteria`. Preserve a user-provided Chinese effect name instead of replacing it with a generic label. The coding Agent owns source generation; the Director must not write React source or component IDs.
- When applying a newly authored component in the same turn, make the timeline action depend on `render.author`. The server owns and binds the generated component ID.

- The server supplies the coding Agent with the current purpose-specific sandbox, runtime, responsive-layout and frame-driven animation contract. The Director supplies only the requested purpose, effect brief and visually checkable acceptance criteria; it must not duplicate or reinterpret coding constraints.
- A component is reusable only after audit, compilation, a low-cost Remotion preview, five-frame visual review against every acceptance criterion, and explicit promotion.
- A failed attempt may be repaired once. Failure must not leave a draft component or affect independent actions.

## Delivery

- Read the current V2 draft ID and revision from server state.
- Call `timeline.render` in execute mode for that exact version.
- Do not access V1 state, substitute another revision or silently create a new plan.
- Rendering, media generation and external cost begin only inside the Tool executor.
- Report the actual output/trace on success. On failure, preserve the draft and report the real recovery path; never invent an MP4.
