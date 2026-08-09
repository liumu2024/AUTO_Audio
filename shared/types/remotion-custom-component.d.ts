import type { RemotionTimelineAsset, RemotionTimelineScene } from './remotion-timeline-spec.v1.js';
export interface CustomTransitionProps<TChildren = unknown> {
    children: TChildren;
    progress: number;
    direction: 'entering' | 'exiting';
    params?: Record<string, unknown>;
}
export interface CustomSceneProps {
    params?: Record<string, unknown>;
    scene: RemotionTimelineScene;
    assets: RemotionTimelineAsset[];
}
export declare function normalizeCustomTransitionProgress(progress: number, durationInFrames: number): number;
export declare const CUSTOM_TRANSITION_PROPS_CONTRACT = "interface CustomTransitionProps {\n  children: React.ReactNode\n  progress: number\n  direction: 'entering' | 'exiting'\n  params?: Record<string, unknown>\n}";
export declare const CUSTOM_SCENE_PROPS_CONTRACT = "interface CustomSceneProps {\n  params?: Record<string, unknown>\n  scene: RemotionTimelineScene\n  assets: RemotionTimelineAsset[]\n}";
//# sourceMappingURL=remotion-custom-component.d.ts.map