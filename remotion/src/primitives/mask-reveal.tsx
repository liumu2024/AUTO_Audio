import { AbsoluteFill, Img, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'

import type {
  PrimitiveDirectionalWaveRevealEffects,
  PrimitiveMaskRevealEffects,
  PrimitiveRingOverlayEffects,
  PrimitiveSliceRevealEffects,
  RemotionSceneProps,
  RenderAsset,
} from '../types'
import { SceneMedia } from './SceneMedia'
import { assetById, mediaSource } from './utils/assets'
import { interpolateNumberKeyframes, interpolatePositionKeyframes } from './utils/keyframes'

export function MaskRevealOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveMaskRevealEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const asset = assetById(assets, scene.visual.asset_id)
  const src = mediaSource(asset)
  if (!src || !asset || asset.type === 'audio') return null

  const timeSec = frame / fps
  let radiusPct = interpolateNumberKeyframes(effects.mask.radius_pct_keyframes, timeSec)
  if (effects.mask.beat_reactive_scale) {
    radiusPct *= 1 + Math.sin(frame * 0.35) * 0.045
  }
  const { xPct, yPct } = interpolatePositionKeyframes(effects.mask.position_keyframes, timeSec)
  const radiusPx = (Math.min(width, height) * radiusPct) / 100
  const cx = (width * xPct) / 100
  const cy = (height * yPct) / 100
  const clipPath =
    effects.mask.shape === 'rectangle'
      ? `inset(${Math.max(0, cy - radiusPx)}px ${Math.max(0, width - cx - radiusPx)}px ${Math.max(0, height - cy - radiusPx)}px ${Math.max(0, cx - radiusPx)}px)`
      : `circle(${radiusPx}px at ${cx}px ${cy}px)`
  const fit = scene.visual.fit === 'contain' ? 'contain' : 'cover'
  const revealAssetId = effects.reveal_asset_id ?? effects.next_asset_id
  const revealAsset = assetById(assets, revealAssetId) ?? asset
  const revealSrc = mediaSource(revealAsset)

  if ((effects.lens_style === 'crystal' || revealAssetId) && revealSrc && revealAsset.type !== 'audio') {
    const progress = Math.min(1, Math.max(0, radiusPct / 130))
    const waveEnvelope = Math.sin(progress * Math.PI)
    const waveSpeed = effects.wave_speed ?? 1.15
    const wavePhase = (frame / fps) * waveSpeed
    const magnification = effects.magnification ?? 1.12
    const distortionPx = effects.distortion_px ?? 18
    const waveStrengthPx = effects.wave_strength_px ?? 16
    const waterJitterPx = effects.water_jitter_px ?? 22
    const waterMicroJitterPx = effects.water_micro_jitter_px ?? 5
    const chromaticPx = effects.chromatic_px ?? 4
    const rimWidthPx = effects.rim_width_px ?? 5
    const glowPx = effects.glow_px ?? 34
    const rimOpacity = Math.max(0, Math.min(1, 1 - Math.max(0, progress - 0.82) / 0.18))
    const lensJitterX =
      Math.sin(wavePhase * 6.7) * waterMicroJitterPx * waveEnvelope * 0.28 +
      Math.sin(wavePhase * 2.1) * waterJitterPx * waveEnvelope * 0.045
    const lensJitterY =
      Math.cos(wavePhase * 5.9) * waterMicroJitterPx * waveEnvelope * 0.22 +
      Math.cos(wavePhase * 1.7) * waterJitterPx * waveEnvelope * 0.035
    const ripplePulse = Math.sin(wavePhase * Math.PI * 2 + progress * Math.PI)
    const refractedScale = magnification + waveEnvelope * ripplePulse * 0.01
    const filterId = `crystal-lens-${scene.id.replace(/[^a-z0-9_-]/gi, '-')}`
    const lensSize = Math.max(0, radiusPx * 2)
    const renderRevealMedia = (style?: CSSProperties) =>
      revealAsset.type === 'image' ? (
        <Img src={revealSrc} style={{ height: '100%', objectFit: fit, width: '100%', ...style }} />
      ) : (
        <Video
          src={revealSrc}
          muted
          startFrom={scene.visual.trim ? Math.round(scene.visual.trim.start_sec * fps) : 0}
          style={{ height: '100%', objectFit: fit, width: '100%', ...style }}
        />
      )

    return (
      <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
        <AbsoluteFill style={{ filter: effects.old_filter ?? 'saturate(1.1) contrast(1.12) brightness(0.82)' }}>
          <SceneMedia scene={scene} assets={assets} />
        </AbsoluteFill>

        <svg height="0" width="0">
          <filter
            id={filterId}
            x="-14%"
            y="-14%"
            width="128%"
            height="128%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              baseFrequency={`${(0.018 + Math.sin(wavePhase * 0.72) * 0.006).toFixed(4)} ${(0.036 + Math.cos(wavePhase * 0.58) * 0.011).toFixed(4)}`}
              numOctaves={3}
              seed={23}
              type="turbulence"
              result="surfaceNoise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="surfaceNoise"
              scale={(distortionPx * 0.52 + waveStrengthPx * 0.54 + waterJitterPx * 0.82) * waveEnvelope}
              xChannelSelector="R"
              yChannelSelector="B"
            />
          </filter>
        </svg>

        {chromaticPx > 0 ? (
          <>
            <AbsoluteFill
              style={{
                clipPath,
                filter: `url(#${filterId}) saturate(1.7) hue-rotate(150deg)`,
                opacity: 0.34,
                transform: `translate(${lensJitterX - chromaticPx}px, ${lensJitterY}px) scale(${refractedScale})`,
                transformOrigin: `${xPct}% ${yPct}%`,
                WebkitClipPath: clipPath,
              }}
            >
              {renderRevealMedia()}
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                clipPath,
                filter: `url(#${filterId}) saturate(1.7) hue-rotate(285deg)`,
                opacity: 0.28,
                transform: `translate(${lensJitterX + chromaticPx}px, ${lensJitterY}px) scale(${refractedScale})`,
                transformOrigin: `${xPct}% ${yPct}%`,
                WebkitClipPath: clipPath,
              }}
            >
              {renderRevealMedia()}
            </AbsoluteFill>
          </>
        ) : null}

        <AbsoluteFill
          style={{
            clipPath,
            filter: `url(#${filterId}) ${effects.new_filter ?? 'saturate(1.45) contrast(1.08) brightness(1.02)'}`,
            transform: `translate(${lensJitterX}px, ${lensJitterY}px) scale(${refractedScale})`,
            transformOrigin: `${xPct}% ${yPct}%`,
            WebkitClipPath: clipPath,
          }}
        >
          {renderRevealMedia()}
        </AbsoluteFill>

        <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
          {Array.from({ length: 4 }, (_, index) => {
            const ringProgress = (wavePhase * 0.56 + index / 4) % 1
            const ringRadius = radiusPx * (0.18 + ringProgress * ringProgress * (3 - 2 * ringProgress) * 0.78)
            const ringSize = Math.max(0, ringRadius * 2)
            return (
              <div
                key={`lens-wave-${index}`}
                style={{
                  border: `${Math.max(1, rimWidthPx * 0.2)}px solid rgba(255,255,255,0.42)`,
                  borderRadius: '50%',
                  boxShadow: `0 0 ${Math.max(8, glowPx * 0.24)}px rgba(125,211,252,0.34)`,
                  filter: `blur(${0.7 + index * 0.18}px)`,
                  height: ringSize,
                  left: cx - ringRadius,
                  opacity: rimOpacity * waveEnvelope * (1 - ringProgress) * (0.1 + index * 0.032),
                  position: 'absolute',
                  top: cy - ringRadius,
                  width: ringSize,
                }}
              />
            )
          })}
          <div
            style={{
              border: `${rimWidthPx}px solid rgba(255,255,255,0.72)`,
              borderRadius: '50%',
              boxShadow: `0 0 ${glowPx}px rgba(255,255,255,0.72), 0 0 ${glowPx * 1.45}px rgba(125,211,252,0.38), inset 0 0 ${glowPx * 0.74}px rgba(255,255,255,0.5)`,
              height: lensSize,
              left: cx - radiusPx,
              opacity: rimOpacity,
              position: 'absolute',
              top: cy - radiusPx,
              width: lensSize,
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ clipPath, WebkitClipPath: clipPath }}>
      {asset.type === 'image' ? (
        <Img src={src} style={{ height: '100%', objectFit: fit, width: '100%' }} />
      ) : (
        <Video
          src={src}
          muted
          startFrom={scene.visual.trim ? Math.round(scene.visual.trim.start_sec * fps) : 0}
          style={{ height: '100%', objectFit: fit, width: '100%' }}
        />
      )}
    </AbsoluteFill>
  )
}

export function RingOverlay({ effects }: { effects: PrimitiveRingOverlayEffects }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const mask = effects.mask
  if (!mask || effects.ring.enabled === false) return null

  let radiusPct = interpolateNumberKeyframes(mask.radius_pct_keyframes, timeSec)
  if (mask.beat_reactive_scale) {
    radiusPct *= 1 + Math.sin(frame * 0.35) * 0.045
  }
  const { xPct, yPct } = interpolatePositionKeyframes(mask.position_keyframes, timeSec)
  const radiusPx = (Math.min(width, height) * radiusPct) / 100
  const cx = (width * xPct) / 100
  const cy = (height * yPct) / 100
  const ring = effects.ring
  const strokePx = ring.stroke_px ?? 4
  const colors = ring.colors ?? ['#ffffff', '#8b5cf6', '#22d3ee']
  const glow = ring.glow ?? {
    outer_blur_px: 28,
    outer_spread_px: 12,
    inner_blur_px: 18,
  }
  const chroma = ring.chromatic_aberration
  const blendMode = (ring.blend_mode ?? 'screen') as CSSProperties['mixBlendMode']
  const ringShadow = [
    `0 0 ${glow.inner_blur_px}px ${colors[1] ?? '#8b5cf6'}`,
    `0 0 ${glow.outer_blur_px}px ${glow.outer_spread_px}px ${colors[2] ?? '#22d3ee'}`,
    `0 0 ${glow.outer_blur_px * 1.4}px ${colors[0] ?? '#ffffff'}`,
  ].join(', ')
  const offsets = chroma?.enabled ? [-(chroma.offset_px ?? 3), chroma.offset_px ?? 3, 0] : [0]

  return (
    <AbsoluteFill style={{ mixBlendMode: blendMode, pointerEvents: 'none' }}>
      {offsets.map((offset, index) => (
        <div
          key={`portal-ring-${index}`}
          style={{
            border: `${strokePx}px solid ${colors[index % colors.length] ?? '#8b5cf6'}`,
            borderRadius: mask.shape === 'rectangle' ? 10 : '50%',
            boxShadow: ringShadow,
            height: radiusPx * 2,
            left: cx - radiusPx + offset,
            opacity: offsets.length > 1 && index < 2 ? 0.75 : 1,
            position: 'absolute',
            top: cy - radiusPx,
            width: radiusPx * 2,
          }}
        />
      ))}
    </AbsoluteFill>
  )
}

export function DirectionalWaveRevealOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveDirectionalWaveRevealEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const minDim = Math.min(width, height)
  const filter = effects.color_layer
    ? `saturate(${effects.color_layer.saturate ?? 1.35}) contrast(${effects.color_layer.contrast ?? 1.08}) brightness(${effects.color_layer.brightness ?? 1})`
    : undefined
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {effects.reveal_events.map((event) => {
        const elapsed = timeSec - event.trigger_time
        if (elapsed < 0) return null
        const duration = Math.max(0.001, event.duration_sec)
        const progress = Math.min(1, elapsed / duration)
        if (progress >= 1 && !event.hold_after && !effects.color_layer?.accumulate) return null
        const radiusPx =
          (minDim *
            interpolate(progress, [0, 1], [0, Math.max(90, event.propagation_speed_pct_per_sec * duration)])) /
          100
        const cx = (width * event.origin.x_pct) / 100
        const cy = (height * event.origin.y_pct) / 100
        const clipPath = `circle(${radiusPx}px at ${cx}px ${cy}px)`
        return (
          <AbsoluteFill key={event.id} style={{ clipPath, WebkitClipPath: clipPath }}>
            <SceneMedia scene={scene} assets={assets} filter={filter} />
          </AbsoluteFill>
        )
      })}
    </AbsoluteFill>
  )
}

function sliceProgress(timeSec: number, start: number, duration: number) {
  return interpolate(timeSec, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

export function SliceRevealOverlay({
  effects,
  scene,
  assets,
}: {
  effects: PrimitiveSliceRevealEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const asset = assetById(assets, scene.visual.asset_id)
  const src = mediaSource(asset)
  if (!src || !asset || asset.type === 'audio') return null

  const overlayAsset = assetById(assets, effects.overlay_asset_id)
  const overlaySrc = mediaSource(overlayAsset) ?? src
  const overlayAssetResolved = overlayAsset ?? asset
  const fit = scene.visual.fit === 'contain' ? 'contain' : 'cover'
  const sliceCount = Math.max(1, effects.slice_count)
  const isVertical = effects.direction === 'vertical'
  const stagger = effects.stagger_sec ?? 0.04
  const distance = effects.slide_distance_pct ?? 24
  const chroma = effects.slice_style?.chromatic_aberration_px ?? 0
  const gap = effects.slice_style?.gap_px ?? 0

  const renderSliceMedia = (dx: number, tint?: string) => {
    const style = {
      filter: tint ? `saturate(1.9) hue-rotate(${tint})` : undefined,
      height: '100%',
      objectFit: fit,
      width: '100%',
    } as const
    const mediaSrc = overlaySrc
    const mediaType = overlayAssetResolved.type
    if (mediaType === 'image') {
      return <Img src={mediaSrc} style={style} />
    }
    return (
      <Video
        src={mediaSrc}
        muted
        startFrom={scene.visual.trim ? Math.round(scene.visual.trim.start_sec * fps) : 0}
        style={style}
      />
    )
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: sliceCount }, (_, index) => {
        const start = effects.start_sec + index * stagger
        const progress = sliceProgress(timeSec, start, effects.duration_sec)
        const shuffleSign = effects.mode === 'shuffle' && index % 2 === 0 ? -1 : 1
        const offset = (1 - progress) * distance * shuffleSign
        const sizePct = 100 / sliceCount
        const common = {
          boxShadow: effects.slice_style?.shadow ? '0 18px 48px rgba(0,0,0,0.42)' : undefined,
          overflow: 'hidden' as const,
          position: 'absolute' as const,
        }
        const containerStyle = isVertical
          ? {
              ...common,
              bottom: 0,
              left: `${index * sizePct}%`,
              top: 0,
              transform: `translateX(${effects.mode === 'cover' ? -offset : offset}%)`,
              width: `calc(${sizePct}% - ${gap}px)`,
            }
          : {
              ...common,
              height: `calc(${sizePct}% - ${gap}px)`,
              left: 0,
              right: 0,
              top: `${index * sizePct}%`,
              transform: `translateY(${effects.mode === 'cover' ? -offset : offset}%)`,
            }
        const innerStyle = isVertical
          ? {
              height: '100%',
              transform: `translateX(-${index * sizePct}%)`,
              width: `${sliceCount * 100}%`,
            }
          : {
              height: `${sliceCount * 100}%`,
              transform: `translateY(-${index * sizePct}%)`,
              width: '100%',
            }

        const sliceNode = (dx: number, tint?: string) => (
          <div
            style={{
              ...containerStyle,
              opacity: progress,
              transform: `${containerStyle.transform} translateX(${dx}px)`,
            }}
          >
            <div style={innerStyle}>{renderSliceMedia(dx, tint)}</div>
          </div>
        )

        return (
          <div key={`slice-${index}`}>
            {chroma > 0 ? sliceNode(-chroma, '150deg') : null}
            {chroma > 0 ? sliceNode(chroma, '280deg') : null}
            {sliceNode(0)}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}
