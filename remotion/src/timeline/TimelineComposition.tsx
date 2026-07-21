import { AbsoluteFill } from 'remotion'
import { TransitionSeries } from '@remotion/transitions'

import type {
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
  RemotionTimelineTransition,
} from '../../../shared/types/remotion-timeline-spec.v1'
import { OverlayRendererV2 } from './OverlayRendererV2'
import { SceneRenderer } from './SceneRenderer'
import { buildTransitionElement, transitionFrames } from './TransitionRenderer'

function sortedScenes(spec: RemotionTimelineSpecV1): RemotionTimelineScene[] {
  return spec.scenes.slice().sort((a, b) => a.start_sec - b.start_sec)
}

function transitionAfter(
  transitions: RemotionTimelineTransition[],
  scene: RemotionTimelineScene,
  nextScene: RemotionTimelineScene | undefined,
) {
  if (!nextScene) return undefined
  return transitions.find(
    (transition) =>
      transition.from_scene_id === scene.id &&
      transition.to_scene_id === nextScene.id,
  )
}

export function TimelineComposition(props: RemotionTimelineSpecV1) {
  const scenes = sortedScenes(props)
  const fps = props.canvas.fps

  return (
    <AbsoluteFill style={{ background: props.canvas.background ?? '#09090b' }}>
      <TransitionSeries>
        {scenes.flatMap((scene, index) => {
          const nextScene = scenes[index + 1]
          const transition = transitionAfter(props.transitions, scene, nextScene)
          const transitionDuration = transitionFrames(transition, fps)
          const sceneDuration = Math.max(1, Math.round(scene.duration_sec * fps))
          const items = [
            <TransitionSeries.Sequence
              key={scene.id}
              durationInFrames={sceneDuration + transitionDuration}
              name={scene.id}
            >
              <SceneRenderer scene={scene} assets={props.assets} />
            </TransitionSeries.Sequence>,
          ]
          if (transition) {
            const transitionElement = buildTransitionElement(transition, fps)
            if (transitionElement) items.push(transitionElement)
          }
          return items
        })}
      </TransitionSeries>
      <OverlayRendererV2 overlays={props.overlays} assets={props.assets} />
    </AbsoluteFill>
  )
}
