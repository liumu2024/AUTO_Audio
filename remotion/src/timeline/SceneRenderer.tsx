import { Video } from '@remotion/media'
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Component, createElement } from 'react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'

import type {
  RemotionImageMotion,
  RemotionTimelineAsset,
  RemotionTimelineFit,
  RemotionTimelineScene,
} from '../../../shared/types/remotion-timeline-spec.v1'
import { customComponentRegistry } from './custom-components/index'

class SafeCustomRender extends Component<
  { render: () => ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.render()
  }
}

function assetById(assets: RemotionTimelineAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

function mediaSrc(src: string): string {
  return src.startsWith('static:') ? staticFile(src.slice('static:'.length)) : src
}

function fitFor(scene: RemotionTimelineScene): RemotionTimelineFit {
  return scene.fit ?? 'cover'
}

function motionStyle(motion: RemotionImageMotion | undefined, durationFrames: number): CSSProperties {
  const frame = useCurrentFrame()
  const progress = interpolate(frame, [0, Math.max(1, durationFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  switch (motion) {
    case 'slow_zoom_out':
      return { scale: 1.1 - progress * 0.08 }
    case 'pan_left':
      return { scale: 1.08, translate: `${progress * -5}% 0` }
    case 'pan_right':
      return { scale: 1.08, translate: `${progress * 5 - 5}% 0` }
    case 'slow_zoom_in':
      return { scale: 1 + progress * 0.08 }
    default:
      return {}
  }
}

function SceneText({
  scene,
  align = 'left',
}: {
  scene: RemotionTimelineScene
  align?: CSSProperties['textAlign']
}) {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(frame, [0, 24], [34, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        color: '#f8fafc',
        fontFamily: 'Microsoft YaHei, Arial, sans-serif',
        opacity,
        translate: `0 ${y}px`,
        textAlign: align,
      }}
    >
      {scene.subtitle ? (
        <div
          style={{
            color: scene.accent_color ?? '#38bdf8',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 0,
            marginBottom: 18,
            textTransform: 'uppercase',
          }}
        >
          {scene.subtitle}
        </div>
      ) : null}
      {scene.title ? (
        <div
          style={{
            fontSize: 72,
            fontWeight: 950,
            letterSpacing: 0,
            lineHeight: 0.96,
            textShadow: '0 18px 48px rgba(0,0,0,0.45)',
          }}
        >
          {scene.title}
        </div>
      ) : null}
      {scene.body ? (
        <div
          style={{
            color: '#cbd5e1',
            fontSize: 31,
            fontWeight: 650,
            lineHeight: 1.22,
            marginTop: 24,
            maxWidth: 760,
          }}
        >
          {scene.body}
        </div>
      ) : null}
    </div>
  )
}

function VideoScene({
  scene,
  assets,
}: {
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}) {
  const asset = assetById(assets, scene.asset_id)
  if (!asset) return <CardScene scene={{ ...scene, title: 'Missing video asset', type: 'remotion_card' }} />
  return (
    <AbsoluteFill style={{ background: '#09090b' }}>
      <Video
        src={mediaSrc(asset.src)}
        objectFit={fitFor(scene)}
        style={{
          height: '100%',
          width: '100%',
        }}
      />
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.48))',
          inset: 0,
          position: 'absolute',
        }}
      />
    </AbsoluteFill>
  )
}

function ImageMotionScene({
  scene,
  assets,
}: {
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}) {
  const { fps } = useVideoConfig()
  const asset = assetById(assets, scene.asset_id)
  const durationFrames = Math.round(scene.duration_sec * fps)
  if (!asset) return <CardScene scene={{ ...scene, title: 'Missing image asset', type: 'remotion_card' }} />
  return (
    <AbsoluteFill style={{ background: scene.background ?? '#09090b', overflow: 'hidden' }}>
      <Img
        src={mediaSrc(asset.src)}
        style={{
          height: '100%',
          objectFit: fitFor(scene),
          width: '100%',
          ...motionStyle(scene.motion, durationFrames),
        }}
      />
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.62))',
          inset: 0,
          position: 'absolute',
        }}
      />
    </AbsoluteFill>
  )
}

function DataVizScene({ scene }: { scene: RemotionTimelineScene }) {
  const frame = useCurrentFrame()
  const bars = [0.42, 0.7, 0.55, 0.9, 0.64]
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 20%, ${scene.accent_color ?? '#22c55e'}44, transparent 32%), #09090b`,
        color: '#f8fafc',
        overflow: 'hidden',
        padding: 72,
      }}
    >
      <div style={{ marginTop: 140 }}>
        <SceneText scene={scene} />
      </div>
      <div
        style={{
          alignItems: 'end',
          bottom: 140,
          display: 'flex',
          gap: 22,
          height: 360,
          left: 72,
          position: 'absolute',
          right: 72,
        }}
      >
        {bars.map((bar, index) => {
          const height = interpolate(frame, [index * 5, index * 5 + 28], [8, bar * 100], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          return (
            <div
              key={index}
              style={{
                background: `linear-gradient(180deg, ${scene.accent_color ?? '#22c55e'}, #f8fafc)`,
                borderRadius: 10,
                boxShadow: `0 18px 50px ${scene.accent_color ?? '#22c55e'}55`,
                flex: 1,
                height: `${height}%`,
              }}
            />
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

function CardScene({ scene }: { scene: RemotionTimelineScene }) {
  const frame = useCurrentFrame()
  const accent = scene.accent_color ?? '#38bdf8'
  const glow = interpolate(frame, [0, 30, 90], [0.18, 0.46, 0.28], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 24% 22%, ${accent}${Math.round(glow * 255)
          .toString(16)
          .padStart(2, '0')}, transparent 32%), linear-gradient(145deg, #09090b, #111827 55%, #020617)`,
        overflow: 'hidden',
        padding: 72,
      }}
    >
      <div style={{ marginTop: 190 }}>
        <SceneText scene={scene} />
      </div>
      <div
        style={{
          background: accent,
          borderRadius: 999,
          bottom: 86,
          boxShadow: `0 0 50px ${accent}88`,
          height: 10,
          left: 72,
          position: 'absolute',
          width: 180,
        }}
      />
    </AbsoluteFill>
  )
}

export function SceneRenderer({
  scene,
  assets,
}: {
  scene: RemotionTimelineScene
  assets: RemotionTimelineAsset[]
}) {
  if (scene.custom_render) {
    const module = customComponentRegistry[scene.custom_render.component_id]
    const Component = module?.default as
      | ComponentType<{ params?: unknown; scene: RemotionTimelineScene; assets: RemotionTimelineAsset[] }>
      | undefined
    if (Component) {
      return (
        <SafeCustomRender
          fallback={<CardScene scene={scene} />}
          render={() => createElement(Component, {
            params: scene.custom_render?.params,
            scene,
            assets,
          })}
        />
      )
    }
  }
  if (scene.type === 'user_video' || scene.type === 'ai_video') {
    return <VideoScene scene={scene} assets={assets} />
  }
  if (scene.type === 'image_motion') return <ImageMotionScene scene={scene} assets={assets} />
  if (scene.type === 'data_viz') return <DataVizScene scene={scene} />
  return <CardScene scene={scene} />
}
