import { Composition, getInputProps } from 'remotion'
import type { ComponentType } from 'react'

import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1'
import { TimelineComposition } from './timeline/TimelineComposition'
import { fallbackTimelineProps } from './timeline/defaultTimelineProps'

function resolveTimelineProps(): RemotionTimelineSpecV1 {
  const inputProps = getInputProps() as Partial<RemotionTimelineSpecV1>
  if (inputProps.schema_version !== 'remotion_timeline_spec.v1') {
    return fallbackTimelineProps
  }

  return {
    ...fallbackTimelineProps,
    ...inputProps,
    canvas: {
      ...fallbackTimelineProps.canvas,
      ...inputProps.canvas,
    },
    assets: inputProps.assets ?? fallbackTimelineProps.assets,
    scenes: inputProps.scenes?.length ? inputProps.scenes : fallbackTimelineProps.scenes,
    transitions: inputProps.transitions ?? fallbackTimelineProps.transitions,
    overlays: inputProps.overlays ?? fallbackTimelineProps.overlays,
    material_jobs: inputProps.material_jobs ?? fallbackTimelineProps.material_jobs,
    render_policy: inputProps.render_policy ?? fallbackTimelineProps.render_policy,
  }
}

export function RemotionRoot() {
  const timelineProps = resolveTimelineProps()

  return (
    <Composition
      id="V2TimelineVideo"
      component={TimelineComposition as unknown as ComponentType<Record<string, unknown>>}
      durationInFrames={Math.max(
        1,
        Math.round(timelineProps.canvas.duration_sec * timelineProps.canvas.fps),
      )}
      fps={timelineProps.canvas.fps}
      width={timelineProps.canvas.width}
      height={timelineProps.canvas.height}
      defaultProps={timelineProps}
    />
  )
}
