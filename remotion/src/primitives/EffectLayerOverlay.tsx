import { isPrimitivePreset } from '../../../shared/lib/primitive-presets'

import type {
  GeneratedComponentEffects,
  PrimitiveBeatColorUnlockEffects,
  PrimitiveBeatFlashOverlayEffects,
  PrimitiveBloomOverlayEffects,
  PrimitiveChromaticAberrationOverlayEffects,
  PrimitiveCollageLayoutEffects,
  PrimitiveColorHintOverlayEffects,
  PrimitiveDirectionalWaveRevealEffects,
  PrimitiveFadeOverlayEffects,
  PrimitiveGrainOverlayEffects,
  PrimitiveLetterboxOverlayEffects,
  PrimitiveLightSweepOverlayEffects,
  PrimitiveMaskRevealEffects,
  PrimitiveOrbMotionEffects,
  PrimitiveOrbRingOverlayEffects,
  PrimitiveRingOverlayEffects,
  PrimitiveRippleDisplacementEffects,
  PrimitiveRippleRingOverlayEffects,
  PrimitiveSliceRevealEffects,
  PrimitiveTransitionAccentOverlayEffects,
  PrimitiveVignetteOverlayEffects,
  RemotionSceneProps,
  RenderAsset,
  RenderEffectLayer,
} from '../types'
import { useBoundEffectLayer } from './effect-layer-bindings'
import { BeatFlashOverlay } from './audio-driver'
import { RippleDisplacementOverlay, RippleRingOverlay } from './distortion'
import { GeneratedComponentLayerOverlay } from './generated'
import { CollageLayoutOverlay } from './layout'
import {
  DirectionalWaveRevealOverlay,
  MaskRevealOverlay,
  RingOverlay,
  SliceRevealOverlay,
} from './mask-reveal'
import { OrbMotionOverlay, OrbRingFollowOverlay } from './motion-driver'
import {
  BloomOverlay,
  ChromaticAberrationOverlay,
  GrainOverlay,
  LetterboxOverlay,
  LightSweepOverlay,
  VignetteOverlay,
} from './texture-grade'
import {
  BeatColorUnlockOverlay,
  ColorHintOverlay,
  FadeOverlay,
  TransitionAccentOverlay,
} from './scenic-overlays'

export function EffectLayerOverlay({
  layer,
  scene,
  assets,
}: {
  layer: RenderEffectLayer
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const boundLayer = useBoundEffectLayer(layer, scene)
  if (boundLayer.is_primary && !isPrimitivePreset(boundLayer.effects.preset)) return null

  switch (boundLayer.effects.preset) {
    case 'primitive_mask_reveal':
      return (
        <MaskRevealOverlay
          effects={boundLayer.effects as PrimitiveMaskRevealEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_ring_overlay':
      return <RingOverlay effects={boundLayer.effects as PrimitiveRingOverlayEffects} />
    case 'primitive_directional_wave_reveal':
      return (
        <DirectionalWaveRevealOverlay
          effects={boundLayer.effects as PrimitiveDirectionalWaveRevealEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_orb_motion':
      return <OrbMotionOverlay effects={boundLayer.effects as PrimitiveOrbMotionEffects} />
    case 'primitive_orb_ring_overlay':
      return <OrbRingFollowOverlay effects={boundLayer.effects as PrimitiveOrbRingOverlayEffects} />
    case 'primitive_bloom_overlay':
      return <BloomOverlay effects={boundLayer.effects as PrimitiveBloomOverlayEffects} />
    case 'primitive_vignette_overlay':
      return <VignetteOverlay effects={boundLayer.effects as PrimitiveVignetteOverlayEffects} />
    case 'primitive_grain_overlay':
      return <GrainOverlay effects={boundLayer.effects as PrimitiveGrainOverlayEffects} />
    case 'primitive_letterbox_overlay':
      return <LetterboxOverlay effects={boundLayer.effects as PrimitiveLetterboxOverlayEffects} />
    case 'primitive_chromatic_aberration_overlay':
      return (
        <ChromaticAberrationOverlay
          effects={boundLayer.effects as PrimitiveChromaticAberrationOverlayEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_light_sweep_overlay':
      return <LightSweepOverlay effects={boundLayer.effects as PrimitiveLightSweepOverlayEffects} />
    case 'primitive_beat_flash_overlay':
      return <BeatFlashOverlay effects={boundLayer.effects as PrimitiveBeatFlashOverlayEffects} />
    case 'primitive_beat_color_unlock':
      return (
        <BeatColorUnlockOverlay
          effects={boundLayer.effects as PrimitiveBeatColorUnlockEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_color_hint_overlay':
      return <ColorHintOverlay effects={boundLayer.effects as PrimitiveColorHintOverlayEffects} />
    case 'primitive_fade_overlay':
      return <FadeOverlay effects={boundLayer.effects as PrimitiveFadeOverlayEffects} />
    case 'primitive_transition_accent_overlay':
      return (
        <TransitionAccentOverlay
          effects={boundLayer.effects as PrimitiveTransitionAccentOverlayEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_slice_reveal':
      return (
        <SliceRevealOverlay
          effects={boundLayer.effects as PrimitiveSliceRevealEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_ripple_displacement':
      return (
        <RippleDisplacementOverlay
          effects={boundLayer.effects as PrimitiveRippleDisplacementEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'primitive_ripple_ring_overlay':
      return <RippleRingOverlay effects={boundLayer.effects as PrimitiveRippleRingOverlayEffects} />
    case 'primitive_collage_layout':
      return (
        <CollageLayoutOverlay
          effects={boundLayer.effects as PrimitiveCollageLayoutEffects}
          scene={scene}
          assets={assets}
        />
      )
    case 'generated_component':
      return (
        <GeneratedComponentLayerOverlay
          effects={boundLayer.effects as GeneratedComponentEffects}
          scene={scene}
          assets={assets}
        />
      )
    default:
      return null
  }
}

export { isPrimitivePreset }
