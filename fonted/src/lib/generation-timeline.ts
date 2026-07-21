import { effectShortLabel } from '@/lib/render-effect-ui'
import type { RenderPlanV1 } from '@/types/render-plan'
import type { TimelineClip, TimelineProject } from '@/types/timeline'

const GENERATION_TRACKS: TimelineProject['tracks'] = [
  { id: 'video', label: '画面轨', sublabel: '素材 / 镜头运动 / 裁剪' },
  { id: 'overlay', label: '文字轨', sublabel: '字幕 / 花字 / 水印 / 角标' },
  { id: 'effect', label: '效果轨', sublabel: '插件 / 遮罩 / 畸变 / 调色' },
  { id: 'audio', label: '音频轨', sublabel: '配乐 / 节拍 / 音效 / 口播' },
]

export function buildGenerationTimeline(
  base: TimelineProject,
  renderPlan: RenderPlanV1,
): TimelineProject {
  const videoClips = base.clips.filter((clip) => clip.track_id === 'video')
  const clips: TimelineClip[] = [...videoClips]

  for (const scene of renderPlan.scenes) {
    for (const overlay of scene.overlays) {
      clips.push({
        id: `clip-o-${overlay.id}`,
        track_id: 'overlay',
        start_sec: overlay.start_sec,
        end_sec: overlay.end_sec,
        label: overlay.text.trim().slice(0, 16) || '文字层',
        anchor_id: scene.source_anchor_id,
        content_rewrite_instruction: overlay.text,
      })
    }

    if (scene.effects) {
      clips.push({
        id: `clip-fx-${scene.source_anchor_id}`,
        track_id: 'effect',
        start_sec: scene.start_sec,
        end_sec: scene.end_sec,
        label: effectShortLabel(scene.effects.preset),
        anchor_id: scene.source_anchor_id,
      })
    }

    for (const audio of scene.audio) {
      const asset = renderPlan.assets.find((item) => item.id === audio.asset_id)
      clips.push({
        id: `clip-a-${audio.id}`,
        track_id: 'audio',
        start_sec: audio.start_sec,
        end_sec: audio.end_sec ?? scene.end_sec,
        label: asset?.name ?? (audio.type === 'voiceover' ? '口播' : '配乐'),
        anchor_id: scene.source_anchor_id,
      })
    }
  }

  if (!clips.some((clip) => clip.track_id === 'audio')) {
    clips.push({
      id: 'clip-a-bgm',
      track_id: 'audio',
      start_sec: 0,
      end_sec: renderPlan.duration_sec,
      label: '参考配乐',
    })
  }

  return {
    ...base,
    duration_sec: renderPlan.duration_sec,
    tracks: GENERATION_TRACKS,
    clips,
  }
}
