import type { V2SampleUnderstandingResult } from '@shared/types/v2-sample-understanding'

import type { TimelineProject } from '@/types/timeline'

export const V2_SAMPLE_SEGMENT_CLIP_PREFIX = 'v2-sample-segment-'

export interface V2SampleSession {
  reference: {
    playbackUrl: string
    name?: string
  }
  understanding: V2SampleUnderstandingResult
  traceDir: string
}

export interface V2TimedSegment {
  id: string
  label: string
  startSec: number
  endSec: number
}

export function v2SampleSegmentIdFromClipId(clipId: string | null): string | undefined {
  if (!clipId?.startsWith(V2_SAMPLE_SEGMENT_CLIP_PREFIX)) return undefined
  const value = clipId.slice(V2_SAMPLE_SEGMENT_CLIP_PREFIX.length)
  return value.replace(/-(?:text|transition|rhythm)$/, '') || undefined
}

/** View-only projection of the V2 understanding result; no legacy protocol involved. */
export function buildV2SampleTimelineProject(
  understanding: V2SampleUnderstandingResult,
): TimelineProject {
  const clips = understanding.segments.flatMap((segment, index) => {
    const clipId = `${V2_SAMPLE_SEGMENT_CLIP_PREFIX}${segment.id}`
    const base = {
      start_sec: segment.start_sec,
      end_sec: segment.end_sec,
      anchor_id: segment.id,
    }
    return [
      {
        ...base,
        id: clipId,
        track_id: 'video' as const,
        label: `${index + 1}. ${segment.title_zh}`,
        visual_generation_prompt: [segment.visual_content_zh, segment.camera_zh, segment.motion_zh]
          .filter(Boolean)
          .join(' / '),
      },
      ...(segment.text_cues_zh
        ? [{
            ...base,
            id: `${clipId}-text`,
            track_id: 'overlay' as const,
            label: segment.text_cues_zh,
            content_rewrite_instruction: segment.text_cues_zh,
          }]
        : []),
      ...(segment.transition_after_zh
        ? [{
            ...base,
            id: `${clipId}-transition`,
            track_id: 'effect' as const,
            start_sec: Math.max(segment.start_sec, segment.end_sec - 0.3),
            label: segment.transition_after_zh,
          }]
        : []),
      {
        ...base,
        id: `${clipId}-rhythm`,
        track_id: 'audio' as const,
        label: segment.rhythm_zh,
      },
    ]
  })

  return {
    duration_sec: understanding.sample.duration_sec,
    tracks: [
      { id: 'video', label: '样例画面', sublabel: '镜头 / 场景 / 运镜' },
      { id: 'overlay', label: '文字线索', sublabel: '字幕 / 屏幕文字' },
      { id: 'effect', label: '转场线索', sublabel: '段落衔接' },
      { id: 'audio', label: '节奏线索', sublabel: '配乐 / 情绪 / 节拍' },
    ],
    clips,
  }
}

export function buildV2SampleProgressSegments(
  understanding: V2SampleUnderstandingResult,
): V2TimedSegment[] {
  return understanding.segments.map((segment) => ({
    id: segment.id,
    label: segment.title_zh,
    startSec: segment.start_sec,
    endSec: segment.end_sec,
  }))
}
