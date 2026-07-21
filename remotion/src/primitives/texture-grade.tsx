import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'

import type {
  PrimitiveBloomOverlayEffects,
  PrimitiveChromaticAberrationOverlayEffects,
  PrimitiveGrainOverlayEffects,
  PrimitiveLetterboxOverlayEffects,
  PrimitiveLightSweepOverlayEffects,
  PrimitiveVignetteOverlayEffects,
  RemotionSceneProps,
  RenderAsset,
} from '../types'
import { SceneMedia } from './SceneMedia'
import { interpolateNumberKeyframes, interpolatePositionKeyframes } from './utils/keyframes'

export function BloomOverlay({ effects }: { effects: PrimitiveBloomOverlayEffects }) {
  if (!effects.bloom.enabled) return null
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at center, rgba(255,255,255,0.18), rgba(125,211,252,0.08) 35%, transparent 68%)',
          filter: `blur(${Math.max(18, effects.bloom.blur_px)}px)`,
          mixBlendMode: 'screen',
          opacity: Math.min(0.42, effects.bloom.opacity),
        }}
      />
    </AbsoluteFill>
  )
}

export function VignetteOverlay({ effects }: { effects: PrimitiveVignetteOverlayEffects }) {
  if (!effects.vignette.enabled) return null
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ${effects.vignette.radius_pct}%, rgba(0,0,0,${effects.vignette.opacity}) 100%)`,
        pointerEvents: 'none',
      }}
    />
  )
}

export function GrainOverlay({ effects }: { effects: PrimitiveGrainOverlayEffects }) {
  if (!effects.grain.enabled) return null
  return (
    <AbsoluteFill
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(255,255,255,0.22) 0 1px, transparent 1px)',
        backgroundSize: `${effects.grain.size_px}px ${effects.grain.size_px}px`,
        mixBlendMode: 'overlay',
        opacity: effects.grain.opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

export function LetterboxOverlay({ effects }: { effects: PrimitiveLetterboxOverlayEffects }) {
  if (!effects.letterbox.enabled) return null
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: '#050505',
          height: `${effects.letterbox.height_pct}%`,
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      />
      <div
        style={{
          background: '#050505',
          bottom: 0,
          height: `${effects.letterbox.height_pct}%`,
          left: 0,
          position: 'absolute',
          right: 0,
        }}
      />
    </AbsoluteFill>
  )
}

export function ChromaticAberrationOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveChromaticAberrationOverlayEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const chroma = effects.chromatic_aberration
  if (!chroma.enabled) return null
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          filter: 'saturate(1.8) hue-rotate(140deg)',
          mixBlendMode: 'screen',
          opacity: chroma.opacity,
          transform: `translateX(${-chroma.offset_px}px)`,
        }}
      >
        <SceneMedia scene={scene} assets={assets} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          filter: 'saturate(1.8) hue-rotate(280deg)',
          mixBlendMode: 'screen',
          opacity: chroma.opacity,
          transform: `translateX(${chroma.offset_px}px)`,
        }}
      >
        <SceneMedia scene={scene} assets={assets} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function LightSweepOverlay({ effects }: { effects: PrimitiveLightSweepOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const { xPct, yPct } = interpolatePositionKeyframes(effects.sweep.position_keyframes, timeSec)
  const opacity = interpolateNumberKeyframes(effects.sweep.opacity_keyframes, timeSec)
  const cx = (width * xPct) / 100
  const cy = (height * yPct) / 100
  const sweepWidth = (Math.max(width, height) * effects.sweep.width_pct) / 100
  const sweepHeight = Math.sqrt(width * width + height * height) * 1.25
  const colors =
    effects.sweep.colors.length >= 3
      ? effects.sweep.colors
      : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']
  const blendMode = (effects.sweep.blend_mode ?? 'screen') as CSSProperties['mixBlendMode']
  const blur = effects.sweep.blur_px ?? 18

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: `linear-gradient(90deg, ${colors.join(', ')})`,
          filter: `blur(${blur}px)`,
          height: sweepHeight,
          left: cx,
          mixBlendMode: blendMode,
          opacity,
          position: 'absolute',
          top: cy,
          transform: `translate(-50%, -50%) rotate(${effects.sweep.angle_deg}deg)`,
          width: sweepWidth,
        }}
      />
    </AbsoluteFill>
  )
}
