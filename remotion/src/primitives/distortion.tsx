import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import type {
  PrimitiveRippleDisplacementEffects,
  PrimitiveRippleRingOverlayEffects,
  RemotionSceneProps,
  RenderAsset,
} from '../types'
import { SceneMedia } from './SceneMedia'
import { interpolateNumberKeyframes } from './utils/keyframes'

export function RippleDisplacementOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveRippleDisplacementEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const ripple = effects.ripple
  const elapsed = timeSec - ripple.start_sec
  const activeProgress = Math.max(
    0,
    Math.min(1, elapsed / Math.max(0.001, ripple.duration_sec)),
  )
  const activeEnvelope =
    elapsed < 0 || elapsed > ripple.duration_sec
      ? 0
      : Math.sin(activeProgress * Math.PI) * Math.pow(1 - activeProgress, ripple.decay * 0.3)

  const radiusPct = interpolateNumberKeyframes(ripple.radius_pct_keyframes, timeSec)
  const radiusPx = (Math.min(width, height) * radiusPct) / 100
  const bandPx = Math.max(8, (Math.min(width, height) * ripple.width_pct) / 100)
  const cx = (width * ripple.origin.x_pct) / 100
  const cy = (height * ripple.origin.y_pct) / 100
  const amplitude = ripple.amplitude_px * activeEnvelope
  const baseFrequency = Math.max(0.002, ripple.frequency * 0.006)
  const filterId = `ripple-displacement-${Math.round(width)}-${Math.round(height)}`
  const maskImage = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${Math.max(0, radiusPx - bandPx)}px, #fff ${Math.max(0, radiusPx - bandPx * 0.42)}px, #fff ${radiusPx + bandPx * 0.42}px, transparent ${radiusPx + bandPx}px)`

  if (elapsed < 0) return null

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <svg height="0" width="0">
        <filter id={filterId}>
          <feTurbulence
            baseFrequency={`${baseFrequency} ${baseFrequency * 1.8}`}
            numOctaves={2}
            seed={17}
            type="fractalNoise"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={amplitude}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      <AbsoluteFill
        style={{
          filter: `url(#${filterId})`,
          maskImage,
          WebkitMaskImage: maskImage,
          opacity: activeEnvelope > 0 ? 1 : 0,
          transform: `scale(${1 + activeEnvelope * 0.018})`,
          transformOrigin: `${ripple.origin.x_pct}% ${ripple.origin.y_pct}%`,
        }}
      >
        <SceneMedia scene={scene} assets={assets} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function RippleRingOverlay({ effects }: { effects: PrimitiveRippleRingOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const ripple = effects.ripple
  const elapsed = timeSec - ripple.start_sec
  if (elapsed < 0 || elapsed > ripple.duration_sec) return null
  const progress = elapsed / Math.max(0.001, ripple.duration_sec)
  const envelope = Math.sin(progress * Math.PI) * Math.pow(1 - progress, ripple.decay * 0.25)
  const radiusPct = interpolate(
    progress,
    [0, 0.32, 0.72, 1],
    [0, 28, 82, 126],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const minDim = Math.min(width, height)
  const radiusPx = (minDim * radiusPct) / 100
  const cx = (width * ripple.origin.x_pct) / 100
  const cy = (height * ripple.origin.y_pct) / 100
  const band = Math.max(10, (minDim * ripple.width_pct) / 100)
  const highlight = effects.lighting?.highlight_color ?? 'rgba(255,255,255,0.58)'
  const glow = effects.lighting?.glow_color ?? 'rgba(125,211,252,0.38)'
  const shadow = effects.lighting?.shadow_color ?? 'rgba(0,0,0,0.26)'
  const ringOpacity = (effects.lighting?.ring_opacity ?? 0.72) * envelope

  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
      {[0, 1, 2].map((index) => {
        const r = Math.max(0, radiusPx - index * band * 0.82)
        if (r <= 0) return null
        return (
          <div
            key={`ripple-ring-${index}`}
            style={{
              border: `${Math.max(1.5, band * 0.12)}px solid ${highlight}`,
              borderRadius: '50%',
              boxShadow: `0 0 ${band * 0.9}px ${glow}`,
              height: r * 2,
              left: cx - r,
              opacity: envelope * (0.58 - index * 0.13),
              position: 'absolute',
              top: cy - r,
              width: r * 2,
            }}
          />
        )
      })}
      <div
        style={{
          border: `2px solid ${highlight}`,
          borderRadius: '50%',
          boxShadow: `0 0 ${band * 0.8}px ${glow}, inset 0 0 ${band * 0.45}px ${shadow}`,
          height: Math.max(0, radiusPx * 2),
          left: cx - radiusPx,
          opacity: ringOpacity,
          position: 'absolute',
          top: cy - radiusPx,
          width: Math.max(0, radiusPx * 2),
        }}
      />
    </AbsoluteFill>
  )
}
