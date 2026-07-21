import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import type {
  PrimitiveBeatColorUnlockEffects,
  PrimitiveColorHintOverlayEffects,
  PrimitiveFadeOverlayEffects,
  PrimitiveTransitionAccentOverlayEffects,
  RemotionSceneProps,
  RenderAsset,
} from '../types'
import { SceneMedia } from './SceneMedia'

function activeReveal(input: {
  timeSec: number
  triggerTimes: number[]
  durationSec: number
  holdAfter?: boolean
}): { trigger: number; progress: number } | null {
  const duration = Math.max(0.001, input.durationSec)
  let latest: { trigger: number; progress: number } | null = null
  for (const trigger of input.triggerTimes) {
    const elapsed = input.timeSec - trigger
    if (elapsed < 0) continue
    const progress = Math.min(1, elapsed / duration)
    if (progress < 1 || input.holdAfter) {
      latest = { trigger, progress }
    }
  }
  return latest
}

function colorUnlockMask(input: {
  effects: PrimitiveBeatColorUnlockEffects
  progress: number
  width: number
  height: number
}): { clipPath?: string; maskImage?: string } {
  const { effects, progress, width, height } = input
  const origin = effects.origin ?? { x_pct: 50, y_pct: 50 }
  const cx = (width * origin.x_pct) / 100
  const cy = (height * origin.y_pct) / 100
  const feather = Math.max(0, effects.feather_pct ?? 0)

  if (effects.reveal_mode === 'directional_wipe') {
    const pct = Math.max(0, Math.min(100, progress * 100))
    const direction = effects.direction ?? 'left_to_right'
    if (direction === 'right_to_left') {
      return { clipPath: `inset(0 0 0 ${100 - pct}%)` }
    }
    if (direction === 'top_to_bottom') {
      return { clipPath: `inset(0 0 ${100 - pct}% 0)` }
    }
    if (direction === 'bottom_to_top') {
      return { clipPath: `inset(${100 - pct}% 0 0 0)` }
    }
    return { clipPath: `inset(0 ${100 - pct}% 0 0)` }
  }

  const radiusPct = interpolate(progress, [0, 1], [0, effects.reveal_mode === 'soft_wave' ? 145 : 118], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const radiusPx = (Math.max(width, height) * radiusPct) / 100
  if (feather > 0 || effects.reveal_mode === 'soft_wave') {
    const featherPx = (Math.max(width, height) * Math.max(feather, 6)) / 100
    return {
      maskImage: `radial-gradient(circle at ${cx}px ${cy}px, #000 0 ${Math.max(0, radiusPx - featherPx)}px, rgba(0,0,0,0.45) ${radiusPx}px, transparent ${radiusPx + featherPx}px)`,
    }
  }
  return { clipPath: `circle(${radiusPx}px at ${cx}px ${cy}px)` }
}

export function BeatColorUnlockOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveBeatColorUnlockEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const reveal = activeReveal({
    timeSec,
    triggerTimes: effects.trigger_times,
    durationSec: effects.duration_sec,
    holdAfter: effects.hold_after,
  })
  if (!reveal) return null

  const mask = colorUnlockMask({
    effects,
    progress: reveal.progress,
    width,
    height,
  })
  return (
    <AbsoluteFill
      style={{
        clipPath: mask.clipPath,
        filter: effects.color_filter,
        maskImage: mask.maskImage,
        pointerEvents: 'none',
        WebkitClipPath: mask.clipPath,
        WebkitMaskImage: mask.maskImage,
      }}
    >
      <SceneMedia scene={scene} assets={assets} />
    </AbsoluteFill>
  )
}

export function ColorHintOverlay({ effects }: { effects: PrimitiveColorHintOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const fadeSec = Math.max(0.001, effects.fade_sec ?? 0.12)
  const squareSize = (Math.min(width, height) * effects.square_size_pct) / 100

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {effects.cues.map((cue) => {
        if (timeSec < cue.start_sec || timeSec > cue.end_sec + fadeSec) return null
        const inOpacity = interpolate(timeSec, [cue.start_sec, cue.start_sec + fadeSec], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        const outOpacity = interpolate(timeSec, [cue.end_sec, cue.end_sec + fadeSec], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        const opacity = Math.min(inOpacity, outOpacity)
        return (
          <div
            key={cue.id}
            style={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: effects.gap_px ?? 10,
              left: `${cue.x_pct}%`,
              opacity,
              position: 'absolute',
              top: `${cue.y_pct}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              style={{
                background: cue.color,
                boxShadow: `0 0 ${Math.round(squareSize * 0.42)}px ${cue.color}`,
                height: squareSize,
                width: squareSize,
              }}
            />
            {cue.label ? (
              <div
                style={{
                  color: effects.text_color ?? '#ffffff',
                  fontSize: effects.font_size_px ?? 42,
                  fontWeight: 800,
                  lineHeight: 1,
                  textShadow: '0 8px 24px rgba(0,0,0,0.55)',
                }}
              >
                {cue.label}
              </div>
            ) : null}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

export function FadeOverlay({ effects }: { effects: PrimitiveFadeOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const duration = Math.max(0.001, effects.duration_sec)
  const progress = interpolate(timeSec, [effects.start_sec, effects.start_sec + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const opacity = effects.direction === 'out' ? progress : 1 - progress
  if (!effects.hold && timeSec > effects.start_sec + duration) return null
  return (
    <AbsoluteFill
      style={{
        background: effects.color,
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

export function TransitionAccentOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveTransitionAccentOverlayEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const duration = Math.max(0.001, effects.duration_sec)
  if (timeSec < effects.start_sec || timeSec > effects.start_sec + duration) return null

  const progress = interpolate(timeSec, [effects.start_sec, effects.start_sec + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const bell = Math.sin(progress * Math.PI)
  const opacity = bell * effects.intensity
  const color = effects.color ?? 'rgba(255,255,255,1)'
  const secondary = effects.secondary_color ?? 'rgba(251,191,36,0.9)'
  const direction = effects.direction ?? 'left_to_right'
  const translate =
    direction === 'right_to_left'
      ? `${(1 - progress) * 80 - 40}%`
      : direction === 'top_to_bottom'
        ? `0, ${progress * 120 - 60}%`
        : direction === 'bottom_to_top'
          ? `0, ${(1 - progress) * 120 - 60}%`
          : `${progress * 120 - 60}%`

  if (effects.style === 'zoom_blur') {
    return (
      <AbsoluteFill style={{ opacity: opacity * 0.72, pointerEvents: 'none' }}>
        <AbsoluteFill
          style={{
            filter: `blur(${Math.round(10 * bell)}px) saturate(1.35)`,
            transform: `scale(${1 + bell * 0.08})`,
          }}
        >
          <SceneMedia scene={scene} assets={assets} />
        </AbsoluteFill>
      </AbsoluteFill>
    )
  }

  if (effects.style === 'color_wash') {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, ${color}, ${secondary})`,
          mixBlendMode: 'screen',
          opacity,
          pointerEvents: 'none',
        }}
      />
    )
  }

  if (effects.style === 'light_leak') {
    return (
      <AbsoluteFill style={{ mixBlendMode: 'screen', opacity, pointerEvents: 'none' }}>
        <div
          style={{
            background: `linear-gradient(90deg, transparent, ${secondary}, ${color}, transparent)`,
            filter: 'blur(18px)',
            height: '140%',
            left: '-30%',
            position: 'absolute',
            top: '-20%',
            transform: `translate(${translate}) rotate(-12deg)`,
            width: '70%',
          }}
        />
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill
      style={{
        background: color,
        mixBlendMode: 'screen',
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}
