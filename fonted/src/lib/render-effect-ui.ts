import type { RenderPlanV1 } from '@/types/render-plan'

export const EFFECT_LABELS: Record<string, string> = {
  primitive_color_transform: '灰度底图',
  primitive_mask_reveal: '遮罩揭示',
  primitive_ring_overlay: '发光圆环',
  primitive_orb_motion: '光球运动',
  primitive_orb_ring_overlay: '光球拖尾环',
  primitive_directional_wave_reveal: '方向波纹',
  primitive_texture_grade: '电影调色',
  primitive_bloom_overlay: '辉光',
  primitive_vignette_overlay: '暗角',
  primitive_grain_overlay: '胶片颗粒',
  primitive_letterbox_overlay: '宽银幕',
  primitive_chromatic_aberration_overlay: '色散边缘',
  primitive_light_sweep_overlay: '光扫氛围',
  primitive_beat_pulse: '节拍缩放',
  primitive_beat_flash_overlay: '节拍闪白',
  primitive_slice_reveal: '切片动效',
  primitive_ripple_displacement: '水波位移',
  primitive_ripple_ring_overlay: '水波光环',
  primitive_collage_layout: '分屏拼贴',
}

export interface BeatMarker {
  time: number
  intensity: number
  source: 'beat' | 'strong' | 'peak'
}

export interface WaveformSample {
  time: number
  value: number
}

export function effectLabel(preset?: string): string {
  if (!preset) return '无特效'
  return EFFECT_LABELS[preset] ?? preset.replace(/^primitive_/, '').replaceAll('_', ' ')
}

export function effectShortLabel(preset?: string): string {
  return effectLabel(preset).slice(0, 4)
}

function beatEffectsFromScene(scene: RenderPlanV1['scenes'][number]) {
  const primary = scene.effects as
    | {
        preset?: string
        beat_times?: number[]
        strong_beats?: number[]
        energy_peaks?: Array<{ time: number; intensity?: number }>
        waveform?: WaveformSample[]
      }
    | undefined

  if (primary?.preset === 'primitive_beat_pulse') return primary

  const layer = scene.effect_layers?.find((item) => item.preset === 'primitive_beat_pulse')
  return layer?.effects as typeof primary
}

export function extractBeatMarkers(plan: RenderPlanV1 | null): BeatMarker[] {
  if (!plan) return []

  const markers = plan.scenes.flatMap((scene) => {
    const effects = beatEffectsFromScene(scene)
    if (!effects) return []

    const toAbsolute = (time: number) =>
      Math.max(scene.start_sec, Math.min(scene.end_sec, scene.start_sec + time))

    return [
      ...(effects.beat_times ?? []).map((time) => ({
        time: toAbsolute(time),
        intensity: 0.42,
        source: 'beat' as const,
      })),
      ...(effects.strong_beats ?? []).map((time) => ({
        time: toAbsolute(time),
        intensity: 0.78,
        source: 'strong' as const,
      })),
      ...(effects.energy_peaks ?? []).map((peak) => ({
        time: toAbsolute(peak.time),
        intensity: Math.max(0.55, Math.min(1, peak.intensity ?? 0.86)),
        source: 'peak' as const,
      })),
    ]
  })

  return markers
    .filter((marker) => marker.time >= 0 && marker.time <= plan.duration_sec)
    .sort((a, b) => a.time - b.time)
}

export function extractWaveformForAnchor(
  plan: RenderPlanV1 | null,
  anchorId: string | undefined,
): WaveformSample[] {
  if (!plan || !anchorId) return []
  const scene = plan.scenes.find((item) => item.source_anchor_id === anchorId)
  const effects = beatEffectsFromScene(scene!)
  if (!scene || !effects) return []
  return (effects.waveform ?? [])
    .filter((sample) => sample.value >= 0)
    .map((sample) => ({
      time: sample.time,
      value: Math.max(0.02, Math.min(1, sample.value)),
    }))
}
