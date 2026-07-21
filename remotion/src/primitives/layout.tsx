import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import type { PrimitiveCollageLayoutEffects, RemotionSceneProps, RenderAsset } from '../types'
import { PanelMedia } from './SceneMedia'
import { assetById } from './utils/assets'

type Point = {
  x: number
  y: number
}

const RADIAL_ORIGIN: Point = { x: 50, y: 100 }

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(value: number): number {
  const clamped = clampNumber(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function pointToCss(point: Point): string {
  return `${point.x.toFixed(3)}% ${point.y.toFixed(3)}%`
}

function mixPoint(from: Point, to: Point, progress: number): Point {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

function pointDistance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function radialSectorPaths(sideEdgeYPct: number): Point[][] {
  const sideY = clampNumber(sideEdgeYPct, 0, 100)
  return [
    [
      { x: 0, y: 100 },
      { x: 0, y: sideY },
    ],
    [
      { x: 0, y: sideY },
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
    [
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: sideY },
    ],
    [
      { x: 100, y: sideY },
      { x: 100, y: 100 },
    ],
  ]
}

function partialSectorPath(path: Point[], progress: number): Point[] {
  if (path.length <= 1) return path
  const clamped = clampNumber(progress, 0, 1)
  const segmentLengths = path
    .slice(1)
    .map((point, index) => pointDistance(path[index], point))
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0)
  if (totalLength <= 0) return [path[0], path[0]]

  let remaining = totalLength * clamped
  const points: Point[] = [path[0]]
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index]
    const from = path[index]
    const to = path[index + 1]
    if (remaining >= segmentLength) {
      points.push(to)
      remaining -= segmentLength
      continue
    }
    points.push(mixPoint(from, to, segmentLength <= 0 ? 1 : remaining / segmentLength))
    break
  }
  return points
}

function radialSectorClipPath(index: number, progress: number, sideEdgeYPct: number): string {
  const paths = radialSectorPaths(sideEdgeYPct)
  const path = paths[index] ?? paths[index % paths.length]
  const points = [RADIAL_ORIGIN, ...partialSectorPath(path, progress)]
  return `polygon(${points.map(pointToCss).join(', ')})`
}

function radialSectorSweepPoint(index: number, progress: number, sideEdgeYPct: number): Point {
  const paths = radialSectorPaths(sideEdgeYPct)
  const path = paths[index] ?? paths[index % paths.length]
  const points = partialSectorPath(path, progress)
  return points[points.length - 1] ?? path[path.length - 1] ?? RADIAL_ORIGIN
}

function angleForPoint(point: Point): number {
  return (Math.atan2(point.x - RADIAL_ORIGIN.x, RADIAL_ORIGIN.y - point.y) * 180) / Math.PI
}

function gradeFilter(effects: PrimitiveCollageLayoutEffects) {
  const grade = effects.color_grade ?? {}
  return [
    effects.base_filter,
    `saturate(${grade.saturate ?? 1.2})`,
    `contrast(${grade.contrast ?? 1.1})`,
    `brightness(${grade.brightness ?? 0.96})`,
  ]
    .filter(Boolean)
    .join(' ')
}

function entranceTransform(
  entrance: PrimitiveCollageLayoutEffects['panels'][number]['entrance'],
  progress: number,
  scaleFrom: number,
  scaleTo: number,
) {
  const slide = interpolate(progress, [0, 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scale = interpolate(progress, [0, 1], [scaleFrom, scaleTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  switch (entrance) {
    case 'slide_left':
      return `translate(calc(-50% - ${slide * 80}px), -50%) scale(${scale})`
    case 'slide_right':
      return `translate(calc(-50% + ${slide * 80}px), -50%) scale(${scale})`
    case 'slide_up':
      return `translate(-50%, calc(-50% + ${slide * 70}px)) scale(${scale})`
    case 'zoom':
      return `translate(-50%, -50%) scale(${scale})`
    default:
      return 'translate(-50%, -50%) scale(1)'
  }
}

export function CollageLayoutOverlay({
  effects,
  assets,
}: {
  effects: PrimitiveCollageLayoutEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeSec = frame / fps
  const visualAssets = assets.filter(
    (asset) =>
      asset.type === 'image' || asset.type === 'video' || asset.type === 'generated_video',
  )

  if (effects.layout_mode === 'radial_triangle_prism') {
    const hasRenderableRadialPanel = effects.panels.some((panel) => Boolean(assetById(assets, panel.asset_id)))
    const panels = hasRenderableRadialPanel
      ? effects.panels.slice(0, 4)
      : visualAssets.slice(0, 4).map((asset, index) => ({
          id: `radial_fallback_panel_${index + 1}`,
          asset_id: asset.id,
          start_sec: index * 0.18,
          end_sec: 999,
          x_pct: 50,
          y_pct: 50,
          width_pct: 100,
          height_pct: 100,
          fit: 'cover' as const,
          opacity: 0.92,
          border_radius_px: 0,
          entrance: 'zoom' as const,
          scale_from: 0.96,
          scale_to: 1.06,
        }))
    const backgroundAsset = visualAssets[0]
    const backgroundFilter = effects.background_filter ?? 'saturate(1.35) contrast(1.18) brightness(0.78)'
    const panelFilter = effects.panel_filter ?? 'saturate(1.48) contrast(1.2) brightness(0.92)'
    const seamPx = effects.seam_px ?? 2.2
    const seamOpacity = effects.seam_opacity ?? 0.68
    const chromaticPx = effects.chromatic_px ?? 2
    const baseScale = effects.base_scale ?? 1.04
    const entranceDuration = effects.entrance_duration_sec ?? 0.62
    const stagger = effects.stagger_sec ?? 0.2
    const sideEdgeYPct = effects.side_edge_y_pct ?? 26
    const useSeams = effects.seams_enabled ?? true
    const panelStates = panels.map((panel, index) => {
      const start = panel.start_sec ?? index * stagger
      const end = panel.end_sec ?? 999
      const inProgress = interpolate(timeSec, [start, start + entranceDuration], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
      const outProgress = interpolate(timeSec, [end - 0.24, end], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
      return {
        inProgress,
        opacity:
          Math.min(
            interpolate(inProgress, [0, 0.18, 1], [0, 0.9, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            outProgress,
          ) * (panel.opacity ?? 0.92),
        outProgress,
        panel,
        sweep: smoothstep(inProgress),
        visible: timeSec >= start && timeSec <= end,
      }
    })

    return (
      <AbsoluteFill style={{ background: '#030303', overflow: 'hidden', pointerEvents: 'none' }}>
        {backgroundAsset ? (
          <AbsoluteFill style={{ filter: backgroundFilter, transform: `scale(${baseScale})` }}>
            <PanelMedia asset={backgroundAsset} fit="cover" trimStartSec={0} />
          </AbsoluteFill>
        ) : null}

        {panelStates.map(({ inProgress, opacity, panel, sweep, visible }, index) => {
          if (!visible) return null
          const asset = assetById(assets, panel.asset_id)
          if (!asset) return null
          const scale = interpolate(
            inProgress,
            [0, 1],
            [panel.scale_from ?? 0.96, panel.scale_to ?? 1.06],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          )
          const clipPath = radialSectorClipPath(index, sweep, sideEdgeYPct)
          const driftX = Math.sin(frame * 0.018 + index) * 0.6
          const driftY = -inProgress * 2.6
          const panelNode = (offsetX: number, tint?: string) => (
            <AbsoluteFill
              style={{
                clipPath,
                filter: tint ? `saturate(1.8) hue-rotate(${tint})` : undefined,
                opacity: tint ? opacity * 0.35 : opacity,
                transform: `translateX(${offsetX}px)`,
                WebkitClipPath: clipPath,
              }}
            >
              <AbsoluteFill
                style={{
                  filter: tint ? undefined : panelFilter,
                  transform: `scale(${scale}) translate(${driftX}%, ${driftY}%)`,
                }}
              >
                <PanelMedia asset={asset} fit={panel.fit} trimStartSec={0} />
              </AbsoluteFill>
            </AbsoluteFill>
          )
          return (
            <div key={`radial-panel-${panel.id}`}>
              {chromaticPx > 0 ? panelNode(-chromaticPx, '150deg') : null}
              {chromaticPx > 0 ? panelNode(chromaticPx, '285deg') : null}
              {panelNode(0)}
            </div>
          )
        })}

        {useSeams ? (
          <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
            {panelStates.map(({ inProgress, outProgress, sweep, visible }, index) => {
              if (!visible || inProgress <= 0.001) return null
              const edgePoint = radialSectorSweepPoint(index, sweep, sideEdgeYPct)
              const angle = angleForPoint(edgePoint)
              const isLastOuterEdge = index === panelStates.length - 1 && sweep > 0.94
              const opacity =
                seamOpacity *
                outProgress *
                Math.min(1, inProgress * 3.2) *
                (isLastOuterEdge ? 0.34 : 1)
              return (
                <div
                  key={`radial-seam-${index}`}
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(125,211,252,0.34), rgba(255,255,255,0))',
                    bottom: 0,
                    boxShadow: '0 0 18px rgba(255,255,255,0.42)',
                    height: '135vmax',
                    left: '50%',
                    opacity,
                    position: 'absolute',
                    transform: `translateX(-50%) rotate(${angle}deg)`,
                    transformOrigin: '50% 100%',
                    width: seamPx,
                  }}
                />
              )
            })}
          </AbsoluteFill>
        ) : null}

        <AbsoluteFill
          style={{
            background:
              'radial-gradient(circle at 50% 100%, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 22%, rgba(0,0,0,0.42) 78%)',
            mixBlendMode: 'overlay',
            pointerEvents: 'none',
          }}
        />
      </AbsoluteFill>
    )
  }

  const filter = gradeFilter(effects)
  const panelStyle = effects.panel_style ?? {}
  const chroma = panelStyle.chromatic_aberration_px ?? 0
  const hasRenderablePanel = effects.panels.some((panel) => Boolean(assetById(assets, panel.asset_id)))
  const panels = hasRenderablePanel
    ? effects.panels
    : visualAssets.slice(0, 3).map((asset, index) => ({
        id: `fallback_panel_${index + 1}`,
        asset_id: asset.id,
        start_sec: index * 0.08,
        end_sec: 999,
        x_pct: [18, 50, 82][index] ?? 50,
        y_pct: 50,
        width_pct: 34,
        height_pct: 100,
        fit: 'cover' as const,
        opacity: 1,
        border_radius_px: 0,
        entrance: index === 1 ? ('zoom' as const) : index === 0 ? ('slide_left' as const) : ('slide_right' as const),
        scale_from: 0.96,
        scale_to: 1.04,
      }))

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {panels.map((panel) => {
        const asset = assetById(assets, panel.asset_id)
        if (!asset) return null
        if (timeSec < panel.start_sec || timeSec > panel.end_sec) return null

        const inProgress = interpolate(
          timeSec,
          [panel.start_sec, panel.start_sec + 0.28],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
        const outProgress = interpolate(
          timeSec,
          [panel.end_sec - 0.22, panel.end_sec],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
        const opacity = Math.min(inProgress, outProgress) * (panel.opacity ?? 1)
        const transform = entranceTransform(
          panel.entrance,
          inProgress,
          panel.scale_from ?? 0.96,
          panel.scale_to ?? 1,
        )

        const panelNode = (offsetX: number, offsetY: number, tint?: string) => (
          <div
            style={{
              border: panelStyle.border_px
                ? `${panelStyle.border_px}px solid ${panelStyle.border_color ?? 'rgba(255,255,255,0.18)'}`
                : undefined,
              borderRadius: panel.border_radius_px ?? 0,
              boxShadow: panelStyle.shadow ? '0 22px 60px rgba(0,0,0,0.5)' : undefined,
              filter: tint ? `sepia(1) saturate(2) hue-rotate(${tint})` : filter,
              height: `${panel.height_pct}%`,
              left: `calc(${panel.x_pct}% + ${offsetX}px)`,
              opacity,
              overflow: 'hidden',
              position: 'absolute',
              top: `calc(${panel.y_pct}% + ${offsetY}px)`,
              transform,
              width: `${panel.width_pct}%`,
            }}
          >
            <PanelMedia asset={asset} fit={panel.fit} trimStartSec={0} />
          </div>
        )

        return (
          <div key={panel.id}>
            {chroma > 0 ? panelNode(-chroma, 0, '145deg') : null}
            {chroma > 0 ? panelNode(chroma, 0, '265deg') : null}
            {panelNode(0, 0)}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}
