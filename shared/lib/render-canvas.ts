import type { RenderPlanV1 } from '../types/render-plan.v1.js'

export type RenderAspectRatio = RenderPlanV1['canvas']['ratio']

export const DEFAULT_RENDER_ASPECT_RATIO: RenderAspectRatio = '9:16'

export const RENDER_ASPECT_RATIO_OPTIONS: Array<{
  value: RenderAspectRatio
  label: string
}> = [
  { value: '9:16', label: 'Vertical 9:16' },
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '4:3', label: 'Landscape 4:3' },
  { value: '1:1', label: 'Square 1:1' },
]

const CANVAS_PRESETS: Record<
  RenderAspectRatio,
  { width: number; height: number; fps: number }
> = {
  '9:16': { width: 1080, height: 1920, fps: 30 },
  '16:9': { width: 1920, height: 1080, fps: 30 },
  '4:3': { width: 1440, height: 1080, fps: 30 },
  '1:1': { width: 1080, height: 1080, fps: 30 },
}

export function normalizeRenderAspectRatio(value: unknown): RenderAspectRatio {
  if (
    value === '9:16' ||
    value === '16:9' ||
    value === '4:3' ||
    value === '1:1'
  ) {
    return value
  }
  return DEFAULT_RENDER_ASPECT_RATIO
}

export function buildRenderCanvas(
  aspectRatio?: RenderAspectRatio | unknown,
): RenderPlanV1['canvas'] {
  const ratio = normalizeRenderAspectRatio(aspectRatio)
  const preset = CANVAS_PRESETS[ratio]
  return {
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
    ratio,
  }
}

export function applyAspectRatioToRenderPlan(
  plan: RenderPlanV1,
  aspectRatio: RenderAspectRatio,
): RenderPlanV1 {
  return {
    ...plan,
    canvas: buildRenderCanvas(aspectRatio),
  }
}

export function aspectRatioToTailwindClass(ratio: RenderAspectRatio): string {
  if (ratio === '16:9') return 'aspect-video'
  if (ratio === '4:3') return 'aspect-[4/3]'
  if (ratio === '1:1') return 'aspect-square'
  return 'aspect-[9/16]'
}
