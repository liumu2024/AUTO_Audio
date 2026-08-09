import { TransitionSeries, linearTiming } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide } from '@remotion/transitions/slide'
import { wipe } from '@remotion/transitions/wipe'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { createElement } from 'react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'

import {
  normalizeCustomTransitionProgress,
  type CustomTransitionProps,
} from '../../../shared/types/remotion-custom-component'
import type { RemotionTimelineTransition } from '../../../shared/types/remotion-timeline-spec.v1'
import { customComponentRegistry } from './custom-components/index'

export function transitionFrames(transition: RemotionTimelineTransition | undefined, fps: number): number {
  if (!transition || transition.type === 'cut') return 0
  return Math.max(1, Math.round(transition.duration_sec * fps))
}

export function buildTransitionElement(transition: RemotionTimelineTransition, fps: number) {
  const durationInFrames = transitionFrames(transition, fps)
  if (durationInFrames <= 0) return null
  if (transition.custom_render) {
    const Component = customComponentRegistry[transition.custom_render.component_id]?.default as
      | ComponentType<CustomTransitionProps<ReactNode>>
      | undefined
    if (Component) {
      const params = transition.custom_render.params
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={{
            component: (props) => {
              const { children, presentationProgress, presentationDirection, presentationDurationInFrames, passedProps } = props as {
                children: ReactNode
                presentationProgress: number
                presentationDirection: 'entering' | 'exiting'
                presentationDurationInFrames: number
                passedProps: Record<string, unknown>
              }
              return createElement(Component, {
                children,
                progress: normalizeCustomTransitionProgress(presentationProgress, presentationDurationInFrames),
                direction: presentationDirection,
                params: (passedProps?.params as Record<string, unknown> | undefined) ?? params,
              })
            },
            props: { params },
          }}
          timing={linearTiming({ durationInFrames })}
        />
      )
    }
  }
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
  if (transition.type === 'blur') {
    return (
      <TransitionSeries.Transition
        key={transition.id}
        presentation={{
          component: ({ children, presentationProgress, presentationDirection }) => {
            const progress = presentationProgress
            const style: CSSProperties = {
              filter: presentationDirection === 'exiting'
                ? `blur(${Math.round(18 * progress)}px)`
                : `blur(${Math.round(18 * (1 - progress))}px)`,
              height: '100%',
              opacity: presentationDirection === 'exiting' ? 1 - progress : progress,
              width: '100%',
            }
            return <div style={style}>{children}</div>
          },
          props: {},
        }}
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
