import type {
  PrimitiveBeatPulseEffects,
  PrimitiveColorTransformEffects,
  PrimitiveTextureGradeEffects,
  RenderEffectLayer,
} from '../types'
import { beatPulseTransform } from './utils/audio-pulse'

function gradeFilterFor(effect: PrimitiveTextureGradeEffects): string {
  const grade = effect.color_grade ?? {}
  return [
    effect.base_filter,
    grade.saturate === undefined ? undefined : `saturate(${grade.saturate})`,
    grade.contrast === undefined ? undefined : `contrast(${grade.contrast})`,
    grade.brightness === undefined ? undefined : `brightness(${grade.brightness})`,
    grade.hue_rotate_deg === undefined ? undefined : `hue-rotate(${grade.hue_rotate_deg}deg)`,
    grade.sepia === undefined ? undefined : `sepia(${grade.sepia})`,
  ]
    .filter(Boolean)
    .join(' ')
}

export function resolveSceneBaseFilter(layers: RenderEffectLayer[]): string | undefined {
  const parts: string[] = []
  const colorTransform = layers.find(
    (layer) => layer.effects.preset === 'primitive_color_transform',
  )?.effects as PrimitiveColorTransformEffects | undefined
  if (colorTransform?.base_filter) parts.push(colorTransform.base_filter)

  const textureGrade = layers.find(
    (layer) => layer.effects.preset === 'primitive_texture_grade',
  )?.effects as PrimitiveTextureGradeEffects | undefined
  if (textureGrade) {
    const filter = gradeFilterFor(textureGrade)
    if (filter) parts.push(filter)
  }

  return parts.length ? parts.join(' ') : undefined
}

export function resolveBeatPulseLayer(
  layers: RenderEffectLayer[],
): PrimitiveBeatPulseEffects | undefined {
  return layers.find((layer) => layer.effects.preset === 'primitive_beat_pulse')?.effects as
    | PrimitiveBeatPulseEffects
    | undefined
}

export function composeSceneTransform(input: {
  layers: RenderEffectLayer[]
  frame: number
  fps: number
  motionTransform: string
}): string {
  const beatTransform = beatPulseTransform(
    input.frame,
    input.fps,
    resolveBeatPulseLayer(input.layers),
  )
  if (beatTransform === 'scale(1)' && input.motionTransform === 'scale(1)') return 'scale(1)'
  if (beatTransform === 'scale(1)') return input.motionTransform
  if (input.motionTransform === 'scale(1)') return beatTransform
  return `${input.motionTransform} ${beatTransform}`
}
