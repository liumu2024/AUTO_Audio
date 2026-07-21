import path from 'node:path'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  type RemotionTimelineAsset,
  type RemotionTimelineScene,
  type RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2PlannerInput } from './v2-input.js'

export interface V2RemotionTimelinePlannerInput extends V2PlannerInput {
  imageSrc?: string
}

function resolveRepoPath(value: string): string {
  if (path.isAbsolute(value)) return value
  return path.resolve(process.cwd(), '..', value)
}

function sceneDurationParts(durationSec: number): [number, number, number] {
  const first = Number((durationSec * 0.42).toFixed(3))
  const second = Number((durationSec * 0.28).toFixed(3))
  return [first, second, Number((durationSec - first - second).toFixed(3))]
}

function textFromPrompt(prompt: string): {
  title: string
  subtitle: string
  body: string
} {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return {
      title: 'Timeline-first V2',
      subtitle: 'Remotion + generated material',
      body: 'Scenes are planned as an editable video timeline.',
    }
  }
  return {
    title: trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed,
    subtitle: 'Timeline-first V2',
    body: 'Remotion controls scenes, transitions, captions, and image motion.',
  }
}

export function buildDeterministicRemotionTimelineSpec(
  input: V2RemotionTimelinePlannerInput,
): RemotionTimelineSpecV1 {
  const durationSec = input.durationSec ?? 6
  const width = input.canvas?.width ?? 720
  const height = input.canvas?.height ?? 1280
  const fps = input.canvas?.fps ?? 24
  const [firstDuration, secondDuration, thirdDuration] = sceneDurationParts(durationSec)
  const copy = textFromPrompt(input.prompt)
  const assets: RemotionTimelineAsset[] = [
    {
      id: 'main_video_asset',
      type: 'video',
      src: resolveRepoPath(input.mainVideoPath),
      source: 'user_asset',
      label: 'User main video',
    },
  ]
  const hasImage = Boolean(input.imageSrc || input.inputImageUrl)
  if (hasImage) {
    assets.push({
      id: 'planner_image_asset',
      type: 'image',
      src: input.imageSrc ? resolveRepoPath(input.imageSrc) : input.inputImageUrl as string,
      source: input.imageSrc ? 'user_asset' : 'stock_asset',
      label: 'Planner image asset',
    })
  }

  const secondScene: RemotionTimelineScene = hasImage
    ? {
        id: 'scene_002',
        type: 'image_motion',
        start_sec: firstDuration,
        duration_sec: secondDuration,
        asset_id: 'planner_image_asset',
        fit: 'cover',
        motion: 'slow_zoom_in',
        title: 'Image-driven beat',
        subtitle: 'Remotion motion',
        visual_role: 'feature',
      }
    : {
        id: 'scene_002',
        type: 'remotion_card',
        start_sec: firstDuration,
        duration_sec: secondDuration,
        title: 'Programmatic beat',
        subtitle: 'Remotion scene',
        body: 'A generated card fills the structure when no image asset is provided.',
        accent_color: '#f59e0b',
        visual_role: 'feature',
      }

  const spec: RemotionTimelineSpecV1 = {
    schema_version: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
    task_id: input.taskId,
    canvas: {
      width,
      height,
      fps,
      duration_sec: durationSec,
      background: '#09090b',
    },
    assets,
    scenes: [
      {
        id: 'scene_001',
        type: 'user_video',
        start_sec: 0,
        duration_sec: firstDuration,
        asset_id: 'main_video_asset',
        fit: 'cover',
        title: 'Source video beat',
        subtitle: 'User material',
        visual_role: 'hook',
      },
      secondScene,
      {
        id: 'scene_003',
        type: 'remotion_card',
        start_sec: firstDuration + secondDuration,
        duration_sec: thirdDuration,
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        accent_color: '#38bdf8',
        visual_role: 'cta',
      },
    ],
    transitions: [
      {
        id: 'transition_001',
        from_scene_id: 'scene_001',
        to_scene_id: 'scene_002',
        type: 'fade',
        duration_sec: Math.min(0.35, firstDuration / 3, secondDuration / 3),
      },
      {
        id: 'transition_002',
        from_scene_id: 'scene_002',
        to_scene_id: 'scene_003',
        type: 'light_flash',
        duration_sec: Math.min(0.3, secondDuration / 3, thirdDuration / 3),
      },
    ],
    overlays: [
      {
        id: 'caption_001',
        type: 'caption',
        scene_id: 'scene_001',
        start_sec: 0.25,
        end_sec: Math.max(0.35, firstDuration - 0.2),
        text: 'User material anchors the opening beat.',
        x_pct: 50,
        y_pct: 86,
        width_pct: 78,
        background: 'rgba(15, 23, 42, 0.66)',
        animation: 'slide_up_fade',
      },
      {
        id: 'caption_002',
        type: 'label',
        scene_id: 'scene_002',
        start_sec: firstDuration + 0.15,
        end_sec: Math.max(firstDuration + 0.25, firstDuration + secondDuration - 0.15),
        text: hasImage ? 'Image motion by Remotion' : 'Card scene by Remotion',
        x_pct: 50,
        y_pct: 18,
        width_pct: 74,
        animation: 'pop',
      },
    ],
    material_jobs: [
      {
        id: 'job_reuse_main_video',
        scene_id: 'scene_001',
        type: 'reuse_asset',
        status: 'fulfilled',
        output_asset_id: 'main_video_asset',
        provider: 'none',
        fallback_kind: 'none',
      },
    ],
    render_policy: {
      renderer: 'remotion_timeline',
      allow_custom_component: false,
      fallback_renderer: 'overlay_compose',
    },
    notes: [
      'Deterministic timeline planner uses Remotion for scene composition and does not generate custom components.',
    ],
  }

  return assertValidRemotionTimelineSpec(spec)
}
