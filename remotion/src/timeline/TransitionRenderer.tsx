import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide } from '@remotion/transitions/slide'
import { wipe } from '@remotion/transitions/wipe'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'

import type { RemotionTimelineTransition } from '../../../shared/types/remotion-timeline-spec.v1'

export function transitionFrames(transition: RemotionTimelineTransition | undefined, fps: number): number {
  if (!transition || transition.type === 'cut') return 0
  return Math.max(1, Math.round(transition.duration_sec * fps))
}

export function buildTransitionElement(transition: RemotionTimelineTransition, fps: number) {
  const durationInFrames = transitionFrames(transition, fps)
  if (durationInFrames <= 0) return null
  if (transition.type === 'light_flash') {
    return (
      <TransitionSeries.Overlay key={transition.id} durationInFrames={durationInFrames}>
        <LightFlash />
      </TransitionSeries.Overlay>
    )
  }

  const timing = linearTiming({ durationInFrames })
  if (transition.type === 'slide') {
    return (
      <TransitionSeries.Transition
        key={transition.id}
        presentation={slide({ direction: transition.direction ?? 'from-right' })}
        timing={timing}
      />
    )
  }
  if (transition.type === 'wipe') {
    return (
      <TransitionSeries.Transition
        key={transition.id}
        presentation={wipe({ direction: transition.direction ?? 'from-left' })}
        timing={timing}
      />
    )
  }
  return <TransitionSeries.Transition key={transition.id} presentation={fade()} timing={timing} />
}

function LightFlash() {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 5, 18], [0, 0.78, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill
      style={{
        background: `rgba(255,255,255,${opacity})`,
        mixBlendMode: 'screen',
      }}
    />
  )
}
