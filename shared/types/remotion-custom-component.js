export function normalizeCustomTransitionProgress(progress, durationInFrames) {
    if (durationInFrames <= 1)
        return 1;
    return Math.max(0, Math.min(1, progress / ((durationInFrames - 1) / durationInFrames)));
}
export const CUSTOM_TRANSITION_PROPS_CONTRACT = `interface CustomTransitionProps {
  children: React.ReactNode
  progress: number
  direction: 'entering' | 'exiting'
  params?: Record<string, unknown>
}`;
export const CUSTOM_SCENE_PROPS_CONTRACT = `interface CustomSceneProps {
  params?: Record<string, unknown>
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}`;
//# sourceMappingURL=remotion-custom-component.js.map