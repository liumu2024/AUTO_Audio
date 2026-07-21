import { interpolate } from 'remotion'

import type { AudioReactiveCutDriverEffects, PrimitiveBeatPulseEffects } from '../../types'

export function pulseAt(timeSec: number, beats: number[], durationSec: number) {
  return beats.reduce((maxPulse, beat) => {
    const elapsed = timeSec - beat
    if (elapsed < 0 || elapsed > durationSec) return maxPulse
    const pulse = 1 - elapsed / Math.max(0.001, durationSec)
    return Math.max(maxPulse, pulse)
  }, 0)
}

export function energyAt(
  timeSec: number,
  peaks: AudioReactiveCutDriverEffects['energy_peaks'] | undefined,
) {
  return (peaks ?? []).reduce((maxEnergy, peak) => {
    const duration = peak.duration_sec ?? 0.18
    const elapsed = timeSec - peak.time
    if (elapsed < 0 || elapsed > duration) return maxEnergy
    return Math.max(maxEnergy, peak.intensity * Math.sin((elapsed / duration) * Math.PI))
  }, 0)
}

export function beatFlashOpacity(
  timeSec: number,
  input: {
    strong_beats?: number[]
    energy_peaks?: AudioReactiveCutDriverEffects['energy_peaks']
    flash: NonNullable<AudioReactiveCutDriverEffects['flash']>
  },
): number {
  const duration = input.flash.duration_sec ?? 0.12
  const flashPulse = Math.max(
    pulseAt(timeSec, input.strong_beats ?? [], duration * 1.25),
    energyAt(timeSec, input.energy_peaks),
  )
  return interpolate(flashPulse, [0, 1], [0, input.flash.opacity ?? 0.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

export function beatPulseTransform(
  frame: number,
  fps: number,
  effects: PrimitiveBeatPulseEffects | undefined,
): string {
  if (!effects) return 'scale(1)'
  const timeSec = frame / fps
  const pulseDuration = effects.pulse?.duration_sec ?? 0.18
  const beatPulse = pulseAt(timeSec, effects.beat_times, pulseDuration)
  const strongPulse = pulseAt(timeSec, effects.strong_beats ?? [], pulseDuration * 1.25)
  const energyPulse = energyAt(timeSec, effects.energy_peaks)
  const pulse = Math.max(beatPulse * 0.65, strongPulse, energyPulse)
  const scale = 1 + pulse * (effects.pulse?.scale ?? 0.045)
  const shakeEnabled = effects.shake?.enabled
  const shakeDuration = effects.shake?.duration_sec ?? 0.16
  const shakePulse = shakeEnabled
    ? Math.max(strongPulse, pulseAt(timeSec, effects.strong_beats ?? [], shakeDuration))
    : 0
  const shakePx = (effects.shake?.amplitude_px ?? 0) * shakePulse
  return `translate(${Math.sin(frame * 1.7) * shakePx}px, ${Math.cos(frame * 1.3) * shakePx}px) scale(${scale})`
}
