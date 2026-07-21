// 定义 Dpl304Video 合成，并将后端渲染参数与本地预览兜底参数合并。
import { Composition, getInputProps } from 'remotion'
import type { ComponentType } from 'react'

import { RenderPlanVideo } from './RenderPlanVideo'
import { TimelineComposition } from './timeline/TimelineComposition'
import { fallbackTimelineProps } from './timeline/defaultTimelineProps'
import type { RemotionRenderProps } from './types'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1'

const fallbackProps: RemotionRenderProps = {
  taskId: 'preview',
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 300,
  strategy: 'motion_graphics',
  assets: [],
  scenes: [
    {
      id: 'scene_preview',
      sourceAnchorId: 'preview',
      fromFrame: 0,
      durationInFrames: 300,
      sequence: {
        from_sec: 0,
        duration_sec: 10,
        layout: 'fill',
        premount_sec: 0.5,
      },
      role: 'hook',
      visual: {
        mode: 'solid_bg',
        fit: 'cover',
        motion: { preset: 'zoom_in', intensity: 0.5 },
        visual_prompt: 'RenderPlan preview',
      },
      overlays: [
        {
          id: 'overlay_preview',
          type: 'big_caption',
          start_sec: 0,
          end_sec: 10,
          text: 'RenderPlan Preview',
          layout: {
            position: 'center',
            align: 'center',
            max_width_pct: 86,
          },
          style: {
            font_size: 76,
            font_weight: 'black',
            color: '#ffffff',
            background: '#ef4444',
            stroke: '#111111',
            shadow: true,
          },
          animation: {
            in: 'pop',
            out: 'fade_out',
            emphasis: 'scale_pulse',
          },
        },
      ],
      audio: [],
    },
  ],
  transitions: [],
}

function resolveProps(): RemotionRenderProps {
  const inputProps = getInputProps() as Partial<RemotionRenderProps>
  return {
    ...fallbackProps,
    ...inputProps,
    assets: inputProps.assets ?? fallbackProps.assets,
    scenes: inputProps.scenes?.length ? inputProps.scenes : fallbackProps.scenes,
    transitions: inputProps.transitions ?? fallbackProps.transitions,
  }
}

function resolveTimelineProps(): RemotionTimelineSpecV1 {
  const inputProps = getInputProps() as Partial<RemotionTimelineSpecV1>
  if (inputProps.schema_version === 'remotion_timeline_spec.v1') {
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
  return fallbackTimelineProps
}

export function RemotionRoot() {
  const props = resolveProps()
  const timelineProps = resolveTimelineProps()

  return (
    <>
      <Composition
        id="Dpl304Video"
        component={
          RenderPlanVideo as unknown as ComponentType<Record<string, unknown>>
        }
        durationInFrames={props.durationInFrames}
        fps={props.fps}
        width={props.width}
        height={props.height}
        defaultProps={props}
      />
      <Composition
        id="V2TimelineVideo"
        component={
          TimelineComposition as unknown as ComponentType<Record<string, unknown>>
        }
        durationInFrames={Math.max(
          1,
          Math.round(timelineProps.canvas.duration_sec * timelineProps.canvas.fps),
        )}
        fps={timelineProps.canvas.fps}
        width={timelineProps.canvas.width}
        height={timelineProps.canvas.height}
        defaultProps={timelineProps}
      />
    </>
  )
}
