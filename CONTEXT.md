# Context

## Terms

- **Timeline Specification**: The authoritative, renderable content document represented by `RemotionTimelineSpecV1`.
- **Timeline Draft**: A V2 creation aggregate whose current revision is the user's editable intent; it is not a render output.
- **Timeline Revision**: An immutable saved version of a Timeline Draft's specification and preview review.
- **Timeline Render Run**: One execution attempt for a specific saved Timeline Revision; its resolved assets, fallback state, trace, and output never overwrite the revision.
- **V2 Timeline**: The V2 workflow around a Timeline Specification, Draft, Revision, and Render Run.
- **V2 preview**: Plans and reviews a V2 Timeline without resolving materials or rendering a video.
- **V2 run**: Resolves V2 Timeline materials, standardizes them, and renders the resulting video.
- **sample_replicate**: A V2 creation mode with a sample video used only for understanding style and structure.
- **material_brief**: A V2 creation mode based on user-provided visual materials, with no sample requirement.
- **text_to_video**: A V2 creation mode based only on a text brief, with no sample or user-material requirement.
- **Legacy bridge**: A one-way, read-only projection used only to display V2 sample understanding in retained V1 views; it cannot decide V2 planning or rendering.
- **TL debug workbench**: A standalone development surface, not part of the formal creation workflow.
- **Reference summary**: The compact, V2-facing creative facts distilled from a sample video; it guides style and structure but is never a final-video asset.
- **Material summary**: The compact, V2-facing creative facts for one candidate user material; it guides timeline placement without exposing a legacy asset-analysis protocol.
- **Timeline action**: A Director instruction to generate, revise, validate, or render a V2 Timeline. It is distinct from legacy RenderPlan actions.
