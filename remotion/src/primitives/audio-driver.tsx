import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import type { PrimitiveBeatFlashOverlayEffects } from '../types'
import { beatFlashOpacity } from './utils/audio-pulse'

export function BeatFlashOverlay({ effects }: { effects: PrimitiveBeatFlashOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  if (!effects.flash.enabled) return null
  const opacity = beatFlashOpacity(timeSec, effects)
  return (
    <AbsoluteFill
      style={{
        background: effects.flash.color,
        mixBlendMode: 'screen',
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}
