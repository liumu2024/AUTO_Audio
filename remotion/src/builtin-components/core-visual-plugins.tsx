// Built-in reusable Remotion plugin components for common montage, reveal, layout, and overlay visual grammar.
import { AbsoluteFill, Img, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'

import type { GeneratedComponentRenderProps } from '../component-registry'

function propNumber(props: GeneratedComponentRenderProps, key: string, fallback: number): number {
  const value = props.effects.props[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function propString(props: GeneratedComponentRenderProps, key: string, fallback: string): string {
  const value = props.effects.props[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function propBool(props: GeneratedComponentRenderProps, key: string, fallback: boolean): boolean {
  const value = props.effects.props[key]
  return typeof value === 'boolean' ? value : fallback
}

function mediaStyle(extra?: CSSProperties): CSSProperties {
  return { height: '100%', objectFit: 'cover', width: '100%', ...extra }
}

function Media(props: GeneratedComponentRenderProps & { style?: CSSProperties }) {
  const { fps } = useVideoConfig()
  if (!props.src) return <AbsoluteFill style={{ background: '#050505' }} />
  if (props.assetType === 'image') return <Img src={props.src} style={mediaStyle(props.style)} />
  return (
    <Video
      muted
      src={props.src}
      startFrom={props.visual.trim ? Math.round(props.visual.trim.start_sec * fps) : 0}
      style={mediaStyle(props.style)}
    />
  )
}

function point(props: GeneratedComponentRenderProps, prefix: string, x: number, y: number) {
  return {
    x: propNumber(props, `${prefix}_x_pct`, x),
    y: propNumber(props, `${prefix}_y_pct`, y),
  }
}

export function OrbMotionDriverPlugin(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const p0 = point(props, 'start', 50, 105)
  const p1 = point(props, 'mid', 50, 48)
  const p2 = point(props, 'end', 74, 34)
  const duration = propNumber(props, 'duration_sec', Math.max(1, props.scene.durationInFrames / fps))
  const progress = Math.min(1, t / Math.max(0.001, duration))
  const split = progress < 0.45 ? progress / 0.45 : (progress - 0.45) / 0.55
  const x = progress < 0.45 ? interpolate(split, [0, 1], [p0.x, p1.x]) : interpolate(split, [0, 1], [p1.x, p2.x])
  const y = progress < 0.45 ? interpolate(split, [0, 1], [p0.y, p1.y]) : interpolate(split, [0, 1], [p1.y, p2.y])
  const radius = propNumber(props, 'radius_pct', 3.4)
  const color = propString(props, 'color', '#8b5cf6')
  return (
    <AbsoluteFill>
      <Media {...props} style={{ filter: propString(props, 'base_filter', 'grayscale(100%) contrast(1.2)') }} />
      <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
        <div style={{
          background: `radial-gradient(circle, #fff 0%, #22d3ee 20%, ${color} 54%, transparent 100%)`,
          borderRadius: '50%',
          boxShadow: `0 0 28px #22d3ee, 0 0 56px ${color}`,
          height: `${radius * 2}vmin`,
          left: `${x}%`,
          position: 'absolute',
          top: `${y}%`,
          transform: 'translate(-50%, -50%)',
          width: `${radius * 2}vmin`,
        }} />
        <div style={{
          border: '4px solid rgba(255,255,255,0.78)',
          borderRadius: '50%',
          boxShadow: `0 0 22px ${color}`,
          height: `${radius * 5.1}vmin`,
          left: `${x - Math.sin(frame * 0.08) * 1.2}%`,
          opacity: 0.85,
          position: 'absolute',
          top: `${y}%`,
          transform: 'translate(-50%, -50%)',
          width: `${radius * 5.1}vmin`,
        }} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function WaterRippleDistortionOverlayPlugin(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const origin = point(props, 'origin', 50, 50)
  const duration = propNumber(props, 'duration_sec', 1.2)
  const progress = Math.min(1, t / Math.max(0.001, duration))
  const radius = interpolate(progress, [0, 1], [3, 92])
  const opacity = Math.sin(progress * Math.PI)
  return (
    <AbsoluteFill>
      <Media {...props} />
      <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{
            border: `${Math.max(1, 4 - i * 0.7)}px solid rgba(255,255,255,0.62)`,
            borderRadius: '50%',
            boxShadow: '0 0 22px rgba(34,211,238,0.46), inset 0 0 14px rgba(255,95,215,0.24)',
            height: `${Math.max(0, radius - i * 8)}vmin`,
            left: `${origin.x}%`,
            opacity: opacity * (0.8 - i * 0.14),
            position: 'absolute',
            top: `${origin.y}%`,
            transform: `translate(-50%, -50%) scaleX(${1.18 + i * 0.08})`,
            width: `${Math.max(0, radius - i * 8)}vmin`,
          }} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function FinalBurstRevealPlugin(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = Math.min(1, frame / fps / propNumber(props, 'duration_sec', 0.75))
  const radius = interpolate(progress, [0, 1], [8, 160])
  return (
    <AbsoluteFill>
      <Media {...props} style={{ filter: 'grayscale(100%) contrast(1.2)' }} />
      <AbsoluteFill style={{ clipPath: `circle(${radius}% at 50% 50%)`, filter: 'saturate(1.55) contrast(1.08)' }}>
        <Media {...props} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#fff', mixBlendMode: 'screen', opacity: Math.max(0, 1 - progress * 2.2), pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export function BeatCutDriverPlugin(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const beatEvery = propNumber(props, 'beat_interval_sec', 0.48)
  const phase = (frame / fps) % beatEvery
  const pulse = Math.max(0, 1 - phase / Math.max(0.001, beatEvery * 0.22))
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + pulse * 0.035})` }}>
      <Media {...props} />
      <AbsoluteFill style={{ background: '#fff', mixBlendMode: 'screen', opacity: pulse * 0.16, pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export function CinematicTextureGradePlugin(props: GeneratedComponentRenderProps) {
  return (
    <AbsoluteFill style={{ background: '#050505' }}>
      <Media {...props} style={{ filter: propString(props, 'grade_filter', 'saturate(1.18) contrast(1.12) brightness(0.94)') }} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle, transparent 0 55%, rgba(0,0,0,0.58) 100%)', pointerEvents: 'none' }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.2) 0 1px, transparent 1px)', backgroundSize: '5px 5px', mixBlendMode: 'overlay', opacity: propNumber(props, 'grain_opacity', 0.08), pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export function LayoutWindowMaskPlugin(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const radius = propNumber(props, 'radius_pct', 28) + Math.sin(frame * 0.04) * 1.2
  const shape = propString(props, 'shape', 'circle')
  const clip = shape === 'rect' ? 'inset(18% 12% round 18px)' : `circle(${radius}% at ${propNumber(props, 'x_pct', 50)}% ${propNumber(props, 'y_pct', 50)}%)`
  return (
    <AbsoluteFill>
      <Media {...props} style={{ filter: 'grayscale(100%) contrast(1.12)' }} />
      <AbsoluteFill style={{ clipPath: clip, filter: 'saturate(1.35)' }}>
        <Media {...props} />
      </AbsoluteFill>
      <AbsoluteFill style={{ clipPath: clip, boxShadow: 'inset 0 0 34px rgba(255,255,255,0.5)', pointerEvents: 'none' }} />
    </AbsoluteFill>
  )
}

export function SplitCollageLayoutPlugin(props: GeneratedComponentRenderProps) {
  const assets = props.assets.filter((asset) => asset.type !== 'audio')
  const srcs = [props.src, ...assets.map((asset) => asset.url)].filter(Boolean).slice(0, 3) as string[]
  return (
    <AbsoluteFill style={{ background: '#050505', display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr', padding: 8 }}>
      {srcs.map((src, index) => (
        <div key={`${src}-${index}`} style={{ borderRadius: 8, overflow: 'hidden', transform: `translateY(${index % 2 ? 24 : 0}px)` }}>
          {src.match(/\.(mp4|webm|mov)(\?|$)/) ? <Video muted src={src} style={mediaStyle()} /> : <Img src={src} style={mediaStyle()} />}
        </div>
      ))}
    </AbsoluteFill>
  )
}

export function TextSignatureWatermarkPlugin(props: GeneratedComponentRenderProps) {
  return (
    <AbsoluteFill>
      <Media {...props} />
      <div style={{
        bottom: propNumber(props, 'bottom_px', 32),
        color: propString(props, 'color', '#ffffff'),
        fontFamily: 'serif',
        fontSize: propNumber(props, 'font_size_px', 24),
        left: 0,
        opacity: propNumber(props, 'opacity', 0.42),
        position: 'absolute',
        right: 0,
        textAlign: 'center',
        textShadow: '0 2px 10px rgba(0,0,0,0.55)',
      }}>
        {propString(props, 'text', propString(props, 'content_text', '-Signature-'))}
      </div>
    </AbsoluteFill>
  )
}
