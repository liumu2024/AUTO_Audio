import {
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineSpecV1,
} from '@shared/types/remotion-timeline-spec.v1'

import type { TimelineProject } from '@/types/timeline'

const TRANSITION_LABELS: Record<RemotionTimelineSpecV1['transitions'][number]['type'], string> = {
  cut: '硬切',
  fade: '淡化',
  slide: '滑动',
  wipe: '擦除',
  light_flash: '闪光',
  blur: '模糊',
}

const SCENE_TYPE_LABELS: Record<RemotionTimelineSpecV1['scenes'][number]['type'], string> = {
  user_video: '用户视频',
  ai_video: 'AI 视频',
  image_motion: '图片动态呈现',
  remotion_card: '程序化画面',
  caption_scene: '文字画面',
  data_viz: '数据可视化',
}

const OVERLAY_TYPE_LABELS: Record<RemotionTimelineSpecV1['overlays'][number]['type'], string> = {
  caption: '字幕',
  title: '标题',
  label: '标签',
  shape: '图形',
  image_badge: '图片标记',
  light_sweep: '扫光效果',
}

const TRANSITION_DIRECTION_LABELS: Record<
  NonNullable<RemotionTimelineSpecV1['transitions'][number]['direction']>,
  string
> = {
  'from-left': '从左侧',
  'from-right': '从右侧',
  'from-top': '从上方',
  'from-bottom': '从下方',
}

function transitionLabel(type: RemotionTimelineSpecV1['transitions'][number]['type']): string {
  return TRANSITION_LABELS[type]
}

export function v2TransitionDisplayText(
  transition: Pick<
    RemotionTimelineSpecV1['transitions'][number],
    'type' | 'duration_sec' | 'direction' | 'custom_render'
  >,
): string {
  if (transition.custom_render) {
    return `${transition.custom_render.display_name?.trim() || '未命名转场'} · ${transition.duration_sec}秒`
  }
  const direction = (transition.type === 'slide' || transition.type === 'wipe') && transition.direction
    ? ` · ${TRANSITION_DIRECTION_LABELS[transition.direction]}`
    : ''
  return `${transitionLabel(transition.type)} · ${transition.duration_sec}秒${direction}`
}

function sceneTitle(scene: RemotionTimelineSpecV1['scenes'][number]): string {
  return scene.creative_intent?.title ?? scene.title ?? scene.note ?? '未命名镜头'
}

/** A view-only projection. It does not create or update any V1 workflow state. */
export function buildV2TimelineProject(spec: RemotionTimelineSpecV1): TimelineProject {
  return {
    duration_sec: spec.canvas.duration_sec,
    tracks: [
      { id: 'video', label: '画面轨', sublabel: '用户素材 / AI 视频 / 程序化画面' },
      { id: 'overlay', label: '文字与效果', sublabel: '字幕 / 标题 / 标签 / 光效' },
      { id: 'effect', label: '转场轨', sublabel: REMOTION_TIMELINE_TRANSITION_TYPES.map(transitionLabel).join(' / ') },
      { id: 'audio', label: '音频轨', sublabel: '音频素材与后续混音' },
    ],
    clips: [
      ...spec.scenes.map((scene) => ({
        id: `v2-scene-${scene.id}`,
        track_id: 'video' as const,
        start_sec: scene.start_sec,
        end_sec: scene.start_sec + scene.duration_sec,
        label: `${SCENE_TYPE_LABELS[scene.type]}：${sceneTitle(scene)}`,
        anchor_id: scene.id,
        visual_generation_prompt:
          scene.note ?? scene.creative_intent?.description ?? scene.title,
        content_rewrite_instruction:
          scene.type === 'user_video' || scene.type === 'ai_video' || scene.type === 'image_motion'
            ? undefined
            : scene.subtitle ?? scene.body,
      })),
      ...spec.overlays.map((overlay) => ({
        id: `v2-overlay-${overlay.id}`,
        track_id: 'overlay' as const,
        start_sec: overlay.start_sec,
        end_sec: overlay.end_sec,
        label: `${OVERLAY_TYPE_LABELS[overlay.type]}：${overlay.text ?? '未命名内容'}`,
        anchor_id: overlay.scene_id,
        content_rewrite_instruction: overlay.text,
      })),
      ...spec.transitions.map((transition) => {
        const from = spec.scenes.find((scene) => scene.id === transition.from_scene_id)
        const start_sec = Math.max(
          0,
          (from ? from.start_sec + from.duration_sec : 0) - transition.duration_sec,
        )
        return {
          id: `v2-transition-${transition.id}`,
          track_id: 'effect' as const,
          start_sec,
          end_sec: start_sec + transition.duration_sec,
          label: v2TransitionDisplayText(transition),
          anchor_id: transition.from_scene_id,
        }
      }),
    ],
  }
}
