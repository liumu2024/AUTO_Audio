# V2 Timeline Authoring

Use this skill only when the user asks to create or revise a V2 video plan.

- Read the current user request, effective UI constraints, actual sample/material state and persisted V2 draft facts.
- Use `material.inspect` when the user asks about currently uploaded candidates and the answer requires their registered V2 facts.
- Use `timeline.plan` for a new complete draft. Use `timeline.patch` only for an available scoped revision.
- Use `timeline.pending.dismiss` only when the user explicitly abandons one recorded failed revision and wants to keep the current saved draft unchanged.
- Choose AI video, user material, Remotion-native composition or a mixed strategy per scene from the actual creative need; do not force one owner for every scene.
- Preserve confirmed facts and all content outside the requested revision scope.
- Treat `RemotionTimelineSpecV1` as the executable boundary. Do not emit renderer code, V1 RenderPlan state or arbitrary JSX.
- The initial reply may announce the operation, but only the backend Tool result can establish that a draft was saved.
