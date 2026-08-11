import type { V2SampleEvidenceRange, V2SampleUnderstandingResult } from '@shared/types/v2-sample-understanding'

import type { TimelineProject } from '@/types/timeline'

export const V2_SAMPLE_SHOT_CLIP_PREFIX = 'v2-sample-shot-'

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

export function v2SampleShotIdFromClipId(clipId: string | null): string | undefined {
  if (!clipId?.startsWith(V2_SAMPLE_SHOT_CLIP_PREFIX)) return undefined
  return clipId.slice(V2_SAMPLE_SHOT_CLIP_PREFIX.length) || undefined
}

function overlaps(range: V2SampleEvidenceRange, startSec: number, endSec: number): boolean {
  return range.start_sec < endSec && range.end_sec > startSec
}

/** Read-only projection of observed shots; it never treats shot boundaries as a future plan. */
export function buildV2SampleTimelineProject(
  understanding: V2SampleUnderstandingResult,
): TimelineProject {
  const clips = understanding.shot_evidence.map((shot, index) => {
    const content = understanding.content_observations
      .filter((item) => item.evidence_ranges.some((range) => overlaps(range, shot.start_sec, shot.end_sec)))
      .map((item) => item.statement)
    const methods = understanding.method_observations
      .filter((item) => item.evidence_ranges.some((range) => overlaps(range, shot.start_sec, shot.end_sec)))
      .map((item) => `${item.expression}（${item.purpose}）`)
    return {
      id: `${V2_SAMPLE_SHOT_CLIP_PREFIX}${shot.id}`,
      track_id: 'video' as const,
      start_sec: shot.start_sec,
      end_sec: shot.end_sec,
      anchor_id: shot.id,
      label: `${index + 1}. ${shot.description || shot.boundary}`,
      visual_generation_prompt: [...content, ...methods].join(' / '),
    }
  })

  return {
    duration_sec: understanding.sample.duration_sec,
    tracks: [{ id: 'video', label: '样例镜头证据', sublabel: '观察结果，不代表新方案镜头数' }],
    clips,
  }
}

export function buildV2SampleProgressSegments(
  understanding: V2SampleUnderstandingResult,
): V2TimedSegment[] {
  return understanding.shot_evidence.map((shot, index) => ({
    id: shot.id,
    label: shot.description || `镜头 ${index + 1}`,
    startSec: shot.start_sec,
    endSec: shot.end_sec,
  }))
}
