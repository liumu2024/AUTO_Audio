# V2 Render Delivery

Use this skill only when the director model has concluded that the current user turn authorizes delivery.

- Read the current V2 draft ID and revision from server state.
- Call `timeline.render` in execute mode for that exact version.
- Do not access V1 state, substitute another revision or silently create a new plan.
- Rendering, media generation and external cost begin only inside the Tool executor.
- Report the actual output/trace on success. On failure, preserve the draft and report the real recovery path; never invent an MP4.
