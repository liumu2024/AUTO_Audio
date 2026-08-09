import type {
  RemotionTimelineAsset,
  RemotionTimelineScene,
} from './remotion-timeline-spec.v1.js'

export interface CustomTransitionProps<TChildren = unknown> {
  children: TChildren
  progress: number
  direction: 'entering' | 'exiting'
  params?: Record<string, unknown>
}

export interface CustomSceneProps {
  params?: Record<string, unknown>
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}

export function normalizeCustomTransitionProgress(progress: number, durationInFrames: number): number {
  if (durationInFrames <= 1) return 1
  return Math.max(0, Math.min(1, progress / ((durationInFrames - 1) / durationInFrames)))
}

export const CUSTOM_TRANSITION_PROPS_CONTRACT = `interface CustomTransitionProps {
  children: React.ReactNode
  progress: number
  direction: 'entering' | 'exiting'
  params?: Record<string, unknown>
}`

export const CUSTOM_SCENE_PROPS_CONTRACT = `interface CustomSceneProps {
  params?: Record<string, unknown>
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}`
