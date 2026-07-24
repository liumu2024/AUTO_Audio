# DPL304 V2 Remotion Renderer

This package renders `RemotionTimelineSpecV1` through the V2 timeline renderer.

```bash
cd remotion
npm install
npm run preview
```

Backend render flow:

```text
RemotionTimelineSpecV1
  -> backend pipeline-v2 remotion-timeline-renderer
  -> backend/v2-renders/<taskId>/remotion-timeline-props.json
  -> remotion render src/index.ts V2TimelineVideo <output.mp4> --props <props.json>
```

The composition renders the V2 scene, overlay, transition, and audio tracks:

- `scenes[]` -> visual layer
- `overlays[]` -> subtitles and captions
- `audio[]` -> bgm, sfx, and voiceover layers
