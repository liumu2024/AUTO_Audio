import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import type { PrimitiveOrbMotionEffects, PrimitiveOrbRingOverlayEffects } from '../types'
import { interpolatePositionKeyframes } from './utils/keyframes'

function orbPosition(
  orb: PrimitiveOrbMotionEffects['orb'],
  timeSec: number,
): { xPct: number; yPct: number } {
  return interpolatePositionKeyframes(
    orb.path_keyframes.map((keyframe) => ({
      time: keyframe.time,
      x_pct: keyframe.x_pct,
      y_pct: keyframe.y_pct,
    })),
    timeSec,
  )
}

export function OrbMotionOverlay({ effects }: { effects: PrimitiveOrbMotionEffects }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const { xPct, yPct } = orbPosition(effects.orb, timeSec)
  const radius = effects.orb.radius_pct
  const colors = effects.orb.colors ?? ['#6d5cff', '#ff5fd7', '#22d3ee']
  const trailCount = effects.orb.trail_enabled ? 8 : 0
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
      {Array.from({ length: trailCount }).map((_, index) => {
        const trailTime = Math.max(0, timeSec - (index + 1) / fps * 2.5)
        const trail = orbPosition(effects.orb, trailTime)
        const opacity = Math.pow(effects.orb.trail_decay ?? 0.72, index + 1) * 0.42
        return (
          <div
            key={`orb-trail-${index}`}
            style={{
              background: colors[1] ?? '#ff5fd7',
              borderRadius: '50%',
              filter: `blur(${Math.max(2, effects.orb.glow_px * 0.18)}px)`,
              height: `${radius * 1.5}vmin`,
              left: `${trail.xPct}%`,
              opacity,
              position: 'absolute',
              top: `${trail.yPct}%`,
              transform: 'translate(-50%, -50%)',
              width: `${radius * 1.5}vmin`,
            }}
          />
        )
      })}
      <div
        style={{
          background: `radial-gradient(circle, ${colors[0] ?? '#6d5cff'} 0%, transparent 72%)`,
          borderRadius: '50%',
          boxShadow: `0 0 ${effects.orb.glow_px}px ${colors[2] ?? '#22d3ee'}, 0 0 ${effects.orb.glow_px * 1.6}px ${colors[1] ?? '#ff5fd7'}`,
          height: `${radius * 2}vmin`,
          left: `${xPct}%`,
          position: 'absolute',
          top: `${yPct}%`,
          transform: 'translate(-50%, -50%)',
          width: `${radius * 2}vmin`,
        }}
      />
    </AbsoluteFill>
  )
}

export function OrbRingFollowOverlay({ effects }: { effects: PrimitiveOrbRingOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const laggedTime = Math.max(0, (frame - effects.ring.lag_frames) / fps)
  const { xPct, yPct } = orbPosition(effects.orb, laggedTime)
  const radius = effects.orb.radius_pct * effects.ring.radius_multiplier
  const colors = effects.ring.colors ?? ['#ffffff', '#ff55dd', '#22d3ee']
  const chroma = effects.ring.chromatic_aberration_px ?? 0
  const offsets = chroma > 0 ? [-chroma, chroma, 0] : [0]
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
      {offsets.map((offset, index) => (
        <div
          key={`orb-ring-${index}`}
          style={{
            border: `${effects.ring.stroke_px}px solid ${colors[index % colors.length] ?? '#ffffff'}`,
            borderRadius: '50%',
            boxShadow: `0 0 ${effects.ring.glow_px}px ${colors[2] ?? '#22d3ee'}`,
            height: `${radius * 2}vmin`,
            left: `calc(${xPct}% + ${offset}px)`,
            opacity: offsets.length > 1 && index < 2 ? 0.7 : 1,
            position: 'absolute',
            top: `${yPct}%`,
            transform: 'translate(-50%, -50%)',
            width: `${radius * 2}vmin`,
          }}
        />
      ))}
    </AbsoluteFill>
  )
}
