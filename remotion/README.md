# DPL304 Remotion Renderer

This package renders `RenderPlanV1` through the backend-generated
`RemotionRenderProps`.

```bash
cd remotion
npm install
npm run preview
```

Backend render flow:

```text
RenderPlanV1
  -> backend buildRemotionRenderProps()
  -> backend/tmp/agent-trace/<taskId>/artifacts/render/<taskId>.render-props.json
  -> remotion render src/index.ts Dpl304Video <output.mp4> --props <props.json>
```

The composition keeps the same three track model as the editor:

- `scene.visual` -> main visual layer
- `scene.overlays[]` -> subtitles / big captions / stickers
- `scene.audio[]` -> bgm / sfx / voiceover asset layers
