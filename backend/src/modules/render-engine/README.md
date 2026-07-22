# render-engine

Legacy RenderPlan Remotion + FFmpeg render boundary.

Legacy flow:

```text
RenderPlanV1
  -> buildRemotionRenderProps()
  -> tmp/agent-trace/<taskId>/artifacts/render/<taskId>.render-props.json
  -> remotion render src/index.ts Dpl304Video
  -> renders/<taskId>.mp4
```

`RemotionRendererService.renderMedia()` is intentionally defensive for the
legacy `RenderPlanV1` path:

- If `remotion/` dependencies are installed, it renders the MP4.
- If the CLI is unavailable and `requireRender` is false, it keeps the props file and returns `render_skipped`.
- The legacy generator uses Remotion only. Render failures are surfaced as
  failed tasks; there is no external AIGC generator or fake-video fallback.

The active V2 path uses `backend/src/pipeline-v2/` for timeline validation,
material resolution, FFmpeg standardization, Remotion rendering, and trace
output.

The Remotion component tree consumes only `RemotionRenderProps`, not raw
`MigrationProtocolV12`.
