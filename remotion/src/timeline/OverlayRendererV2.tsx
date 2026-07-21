import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'

import type {
  RemotionTimelineAsset,
  RemotionTimelineOverlay,
} from '../../../shared/types/remotion-timeline-spec.v1'

function assetById(assets: RemotionTimelineAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

function mediaSrc(src: string): string {
  return src.startsWith('static:') ? staticFile(src.slice('static:'.length)) : src
}

function progressForOverlay(overlay: RemotionTimelineOverlay, timeSec: number) {
  const fadeSec = Math.min(0.28, Math.max(0.001, (overlay.end_sec - overlay.start_sec) / 3))
  const inProgress = interpolate(timeSec, [overlay.start_sec, overlay.start_sec + fadeSec], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const outProgress = interpolate(timeSec, [overlay.end_sec - fadeSec, overlay.end_sec], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return Math.min(inProgress, outProgress)
}

function transformFor(overlay: RemotionTimelineOverlay, progress: number, frame: number) {
  const base = 'translate(-50%, -50%)'
  switch (overlay.animation) {
    case 'slide_up_fade':
      return `${base} translateY(${(1 - progress) * 54}px)`
    case 'pop':
      return `${base} scale(${0.84 + progress * 0.16})`
    case 'pulse':
      return `${base} scale(${1 + Math.sin(frame * 0.18) * 0.025})`
    case 'sweep':
      return `${base} translateX(${(progress - 0.5) * 130}%)`
    default:
      return base
  }
}

function containerStyle(overlay: RemotionTimelineOverlay, progress: number, frame: number): CSSProperties {
  return {
    height: overlay.height_pct ? `${overlay.height_pct}%` : undefined,
    left: `${overlay.x_pct}%`,
    opacity: progress * (overlay.opacity ?? 1),
    pointerEvents: 'none',
    position: 'absolute',
    top: `${overlay.y_pct}%`,
    transform: transformFor(overlay, progress, frame),
    width: overlay.width_pct ? `${overlay.width_pct}%` : undefined,
  }
}

function textStyle(overlay: RemotionTimelineOverlay): CSSProperties {
  return {
    background:
      overlay.type === 'caption'
        ? overlay.background ?? 'rgba(15, 23, 42, 0.64)'
        : overlay.background,
    borderRadius: overlay.type === 'caption' ? 12 : 8,
    color: overlay.color ?? '#f8fafc',
    fontFamily: 'Microsoft YaHei, Arial, sans-serif',
    fontSize: overlay.type === 'title' ? 68 : overlay.type === 'label' ? 38 : 32,
    fontWeight: overlay.type === 'title' ? 950 : 800,
    lineHeight: 1.08,
    overflowWrap: 'anywhere',
    padding: overlay.type === 'caption' ? '16px 22px' : overlay.background ? '12px 18px' : 0,
    textAlign: 'center',
    textShadow: '0 10px 26px rgba(0,0,0,0.56)',
  }
}

function LightSweep() {
  return (
    <div
      style={{
        background: 'linear-gradient(18deg, transparent 0 36%, rgba(255,255,255,0.86) 48%, transparent 62% 100%)',
        filter: 'blur(18px)',
        height: '100%',
        mixBlendMode: 'screen',
        width: '100%',
      }}
    />
  )
}

function OverlayItem({
  overlay,
  assets,
}: {
  overlay: RemotionTimelineOverlay
  assets: RemotionTimelineAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  if (timeSec < overlay.start_sec || timeSec > overlay.end_sec) return null
  const progress = progressForOverlay(overlay, timeSec)
  const asset = assetById(assets, overlay.asset_id)

  return (
    <div style={containerStyle(overlay, progress, frame)}>
      {overlay.type === 'light_sweep' ? <LightSweep /> : null}
      {overlay.type === 'shape' ? (
        <div
          style={{
            background: overlay.background ?? 'rgba(255,255,255,0.28)',
            borderRadius: 12,
            height: '100%',
            width: '100%',
          }}
        />
      ) : null}
      {overlay.type === 'image_badge' && asset ? (
        <Img src={mediaSrc(asset.src)} style={{ height: '100%', objectFit: 'contain', width: '100%' }} />
      ) : null}
      {overlay.type === 'caption' || overlay.type === 'title' || overlay.type === 'label' ? (
        <div style={textStyle(overlay)}>{overlay.text}</div>
      ) : null}
    </div>
  )
}

export function OverlayRendererV2({
  overlays,
  assets,
}: {
  overlays: RemotionTimelineOverlay[]
  assets: RemotionTimelineAsset[]
}) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {overlays.map((overlay) => (
        <OverlayItem key={overlay.id} overlay={overlay} assets={assets} />
      ))}
    </AbsoluteFill>
  )
}
