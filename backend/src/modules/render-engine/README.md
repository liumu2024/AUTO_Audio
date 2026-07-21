# render-engine

Remotion + FFmpeg render boundary.

Current flow:

```text
RenderPlanV1
  -> buildRemotionRenderProps()
  -> tmp/agent-trace/<taskId>/artifacts/render/<taskId>.render-props.json
  -> remotion render src/index.ts Dpl304Video
  -> renders/<taskId>.mp4
```

`RemotionRendererService.renderMedia()` is intentionally defensive:

- If `remotion/` dependencies are installed, it renders the MP4.
- If the CLI is unavailable and `requireRender` is false, it keeps the props file and returns `render_skipped`.
- The generator worker uses Remotion only. Render failures are surfaced as failed
  tasks; there is no external AIGC generator or fake-video fallback.

The Remotion component tree consumes only `RemotionRenderProps`, not raw
`MigrationProtocolV12`.
