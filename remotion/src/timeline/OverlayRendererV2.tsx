import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'

import type {
  RemotionTimelineAsset,
  RemotionTimelineCaptionTrack,
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

function transformFor(animation: RemotionTimelineOverlay['animation'], progress: number, frame: number) {
  const base = 'translate(-50%, -50%)'
  switch (animation) {
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
  const phaseAnimation = progress < 0.5
    ? overlay.enter_animation ?? overlay.animation
    : overlay.exit_animation ?? overlay.animation
  return {
    height: overlay.height_pct ? `${overlay.height_pct}%` : undefined,
    left: `${overlay.x_pct}%`,
    opacity: progress * (overlay.opacity ?? 1),
    pointerEvents: 'none',
    position: 'absolute',
    top: `${overlay.y_pct}%`,
    transform: transformFor(phaseAnimation, progress, frame),
    width: overlay.width_pct ? `${overlay.width_pct}%` : undefined,
    zIndex: overlay.z_index,
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
    ...(overlay.max_lines
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical' as const,
          WebkitLineClamp: overlay.max_lines,
          overflow: 'hidden',
        }
      : {}),
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
  captionTracks,
}: {
  overlay: RemotionTimelineOverlay
  assets: RemotionTimelineAsset[]
  captionTracks: RemotionTimelineCaptionTrack[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const track = overlay.type === 'caption' && overlay.track_id
    ? captionTracks.find((candidate) => candidate.id === overlay.track_id)
    : undefined
  const resolvedOverlay: RemotionTimelineOverlay = track
    ? { ...track, ...overlay, enter_animation: overlay.enter_animation ?? track.enter_animation, exit_animation: overlay.exit_animation ?? track.exit_animation }
    : overlay
  if (timeSec < resolvedOverlay.start_sec || timeSec > resolvedOverlay.end_sec) return null
  const progress = progressForOverlay(resolvedOverlay, timeSec)
  const asset = assetById(assets, resolvedOverlay.asset_id)

  return (
    <div style={containerStyle(resolvedOverlay, progress, frame)}>
      {resolvedOverlay.type === 'light_sweep' ? <LightSweep /> : null}
      {resolvedOverlay.type === 'shape' ? (
        <div
          style={{
            background: resolvedOverlay.background ?? 'rgba(255,255,255,0.28)',
            borderRadius: 12,
            height: '100%',
            width: '100%',
          }}
        />
      ) : null}
      {resolvedOverlay.type === 'image_badge' && asset ? (
        <Img src={mediaSrc(asset.src)} style={{ height: '100%', objectFit: 'contain', width: '100%' }} />
      ) : null}
      {resolvedOverlay.type === 'caption' || resolvedOverlay.type === 'title' || resolvedOverlay.type === 'label' ? (
        <div style={textStyle(resolvedOverlay)}>{resolvedOverlay.text}</div>
      ) : null}
    </div>
  )
}

export function OverlayRendererV2({
  overlays,
  assets,
  captionTracks = [],
}: {
  overlays: RemotionTimelineOverlay[]
  assets: RemotionTimelineAsset[]
  captionTracks?: RemotionTimelineCaptionTrack[]
}) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {overlays.map((overlay) => (
        <OverlayItem key={overlay.id} overlay={overlay} assets={assets} captionTracks={captionTracks} />
      ))}
    </AbsoluteFill>
  )
}
