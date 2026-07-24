import type {
  RemotionTimelineOverlay,
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'

export interface V2TimelineHardRequirements {
  schema_version: 'v2_timeline_hard_requirements.v1'
  required_captions: string[]
  use_all_visual_materials: boolean
}

function uniqueText(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function normalizeCaptionText(value: string): string {
  return value
    .trim()
    .replace(/^["“”'「『]+|["“”'」』]+$/g, '')
    .trim()
}

export function extractV2TimelineHardRequirements(prompt: string): V2TimelineHardRequirements {
  const requiredCaptions: string[] = []
  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim()
    const quotedSegmentMatch = line.match(
      /^片段\s*\d+\s*[:：]\s*["“](.+?)["”](?:\s*[（(][^）)]*[）)])?\s*$/,
    )
    if (quotedSegmentMatch?.[1]) {
      requiredCaptions.push(normalizeCaptionText(quotedSegmentMatch[1]))
      continue
    }
    const segmentMatch = line.match(/^片段\s*\d+\s*[:：]\s*(.+)$/)
    if (segmentMatch?.[1]) {
      requiredCaptions.push(
        normalizeCaptionText(
          segmentMatch[1].replace(/\s*["”]?\s*[（(][^）)]*[）)]\s*$/, ''),
        ),
      )
      continue
    }
    const quoted = line.match(/^[\d一二三四五六七八九十]+[、.．)]?\s*["“](.+?)["”]\s*$/)
    if (quoted?.[1]) requiredCaptions.push(normalizeCaptionText(quoted[1]))
  }

  return {
    schema_version: 'v2_timeline_hard_requirements.v1',
    required_captions: uniqueText(requiredCaptions),
    use_all_visual_materials:
      /全部|所有|每张|每个|都用|用完|全用|use all/i.test(prompt),
  }
}

function sceneForCaption(
  scenes: RemotionTimelineScene[],
  captionIndex: number,
  captionCount: number,
): RemotionTimelineScene | undefined {
  if (!scenes.length) return undefined
  if (captionCount <= 1) return scenes[0]
  const index = Math.min(
    scenes.length - 1,
    Math.round((captionIndex * (scenes.length - 1)) / (captionCount - 1)),
  )
  return scenes[index]
}

function captionOverlayFor(input: {
  scene: RemotionTimelineScene
  index: number
  text: string
}): RemotionTimelineOverlay {
  const start = Number((input.scene.start_sec + Math.min(0.25, input.scene.duration_sec / 5)).toFixed(3))
  const end = Number((input.scene.start_sec + Math.max(0.45, input.scene.duration_sec - 0.2)).toFixed(3))
  return {
    id: `required_caption_${String(input.index + 1).padStart(3, '0')}`,
    type: input.index === 0 ? 'title' : 'caption',
    scene_id: input.scene.id,
    start_sec: start,
    end_sec: Math.min(end, input.scene.start_sec + input.scene.duration_sec),
    text: input.text,
    x_pct: 50,
    y_pct: input.index === 0 ? 78 : 86,
    width_pct: 78,
    background: 'rgba(15, 23, 42, 0.66)',
    animation: input.index === 0 ? 'pop' : 'slide_up_fade',
  }
}

export function applyV2TimelineHardRequirements(input: {
  spec: RemotionTimelineSpecV1
  requirements: V2TimelineHardRequirements
}): RemotionTimelineSpecV1 {
  const captions = input.requirements.required_captions
  if (!captions.length) return input.spec

  const scenes = input.spec.scenes.slice().sort((a, b) => a.start_sec - b.start_sec)
  const requiredOverlays = captions
    .map((text, index) => {
      const scene = sceneForCaption(scenes, index, captions.length)
      return scene ? captionOverlayFor({ scene, index, text }) : undefined
    })
    .filter((overlay): overlay is RemotionTimelineOverlay => Boolean(overlay))

  const requiredText = new Set(captions)
  const otherOverlays = input.spec.overlays.filter((overlay) => {
    if (!overlay.text) return true
    return !requiredText.has(overlay.text)
  })

  return {
    ...input.spec,
    overlays: [...requiredOverlays, ...otherOverlays.filter((overlay) => !overlay.id.startsWith('required_caption_'))],
    notes: [
      ...(input.spec.notes ?? []),
      `Hard requirements applied: ${captions.length} required captions.`,
    ],
  }
}

export function evaluateV2TimelineHardRequirements(input: {
  spec: RemotionTimelineSpecV1
  requirements: V2TimelineHardRequirements
}): {
  ok: boolean
  missing_captions: string[]
} {
  const overlayTexts = new Set(
    input.spec.overlays
      .map((overlay) => overlay.text?.trim())
      .filter((text): text is string => Boolean(text)),
  )
  const missing = input.requirements.required_captions.filter((caption) => !overlayTexts.has(caption))
  return {
    ok: missing.length === 0,
    missing_captions: missing,
  }
}
