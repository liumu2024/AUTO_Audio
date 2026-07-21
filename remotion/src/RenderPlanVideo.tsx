// 灏嗗悗绔?RenderPlan 鍦烘櫙娓叉煋涓?Remotion 搴忓垪锛屽寘鍚瑙夊眰銆佸姩鎬佽创灞傘€侀煶棰戣建鍜屽彲閫夌壒鏁堛€?
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  Video,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions'
import { clockWipe } from '@remotion/transitions/clock-wipe'
import { fade } from '@remotion/transitions/fade'
import { flip } from '@remotion/transitions/flip'
import { slide } from '@remotion/transitions/slide'
import { wipe } from '@remotion/transitions/wipe'
import type { CSSProperties } from 'react'
import { useMemo } from 'react'

import { getGeneratedComponent } from './component-registry'
import {
  EffectLayerOverlay,
  SceneMedia,
  composeSceneTransform,
  isPrimitivePreset,
  resolveSceneBaseFilter,
} from './primitives'
import { resolveSceneEffectBindings } from './primitives/effect-layer-bindings'
import { assetById, mediaSource } from './primitives/utils/assets'
import { splitEffectLayers } from '../../shared/lib/legacy-preset-split'
import type {
  GeneratedComponentEffects,
  OverlayLayer,
  RenderTransition,
  RemotionRenderProps,
  RemotionSceneProps,
  RenderEffectLayer,
  RenderAsset,
  SceneEffects,
  VisualLayer,
} from './types'

function easingForName(name: string | undefined) {
  switch (name) {
    case 'ease-in':
      return Easing.in(Easing.cubic)
    case 'ease-in-out':
      return Easing.inOut(Easing.cubic)
    case 'ease-out':
      return Easing.out(Easing.cubic)
    case 'editorial':
      return Easing.bezier(0.45, 0, 0.55, 1)
    case 'crisp':
      return Easing.bezier(0.16, 1, 0.3, 1)
    case 'overshoot':
      return Easing.bezier(0.34, 1.56, 0.64, 1)
    default:
      return Easing.linear
  }
}

function visualTransform(
  visual: VisualLayer,
  frame: number,
  durationInFrames: number,
) {
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    easing: easingForName(visual.motion?.easing),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const intensity = visual.motion?.intensity ?? 0
  switch (visual.motion?.preset) {
    case 'zoom_in':
    case 'push_in':
      return `scale(${1 + intensity * 0.16 * progress})`
    case 'pan':
      return `scale(1.08) translateX(${(progress - 0.5) * intensity * 10}%)`
    case 'shake':
      return `scale(1.04) translateX(${Math.sin(frame * 0.8) * intensity * 12}px)`
    default:
      return 'scale(1)'
  }
}

const PLACEHOLDER_BACKGROUNDS = [
  'linear-gradient(165deg, #030303 0%, #141414 42%, #f2f2f2 100%)',
  'linear-gradient(165deg, #080808 0%, #1c1c1c 50%, #a78bfa 100%)',
  'linear-gradient(165deg, #0b1020 0%, #4f46e5 38%, #f472b6 72%, #fde047 100%)',
  'linear-gradient(165deg, #0f172a 0%, #22d3ee 35%, #a855f7 68%, #fbcfe8 100%)',
  'linear-gradient(165deg, #111827 0%, #f9fafb 28%, #ec4899 62%, #111827 100%)',
  'linear-gradient(165deg, #0a0a0a 0%, #262626 55%, #d4d4d8 100%)',
  'linear-gradient(165deg, #171717 0%, #ef4444 42%, #facc15 78%, #fafafa 100%)',
  'linear-gradient(165deg, #0c4a6e 0%, #38bdf8 32%, #c084fc 65%, #fef9c3 100%)',
  'linear-gradient(165deg, #1e1b4b 0%, #818cf8 30%, #f472b6 58%, #fef08a 88%, #ffffff 100%)',
]

function motionPresetLabel(preset: string | undefined) {
  if (!preset || preset === 'static') return 'static'
  return preset.replace(/_/g, ' ')
}

function SceneSolidPlaceholder({
  scene,
  transform,
  sceneIndex,
  sceneCount,
}: {
  scene: RemotionSceneProps
  transform: string
  sceneIndex: number
  sceneCount: number
}) {
  const bg =
    PLACEHOLDER_BACKGROUNDS[sceneIndex % PLACEHOLDER_BACKGROUNDS.length] ??
    PLACEHOLDER_BACKGROUNDS[0]
  const motion = scene.visual.motion?.preset ?? 'static'
  const intensity = scene.visual.motion?.intensity ?? 0

  return (
    <AbsoluteFill
      style={{
        background: bg,
        transform,
      }}
    >
      <div
        style={{
          bottom: 48,
          color: 'rgba(255,255,255,0.72)',
          fontSize: 22,
          fontWeight: 700,
          left: 48,
          letterSpacing: 2,
          position: 'absolute',
          textTransform: 'uppercase',
        }}
      >
        {String(sceneIndex + 1).padStart(2, '0')} / {String(sceneCount).padStart(2, '0')}
      </div>
      <div
        style={{
          color: 'rgba(255,255,255,0.9)',
          fontSize: 28,
          fontWeight: 800,
          position: 'absolute',
          right: 48,
          top: 48,
        }}
      >
        {motionPresetLabel(motion)} 路 {Math.round(intensity * 100)}%
      </div>
    </AbsoluteFill>
  )
}

function SceneFallback({
  scene,
  transform,
}: {
  scene: RemotionSceneProps
  transform: string
}) {
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        background: '#151515',
        color: 'white',
        justifyContent: 'center',
        padding: 72,
        textAlign: 'center',
        transform,
      }}
    >
      <div style={{ maxWidth: '82%' }}>
        <div
          style={{
            color: '#5eead4',
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: 'uppercase',
          }}
        >
          {scene.role}
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            lineHeight: 1.08,
            marginTop: 24,
            overflowWrap: 'anywhere',
          }}
        >
          {scene.visual.visual_prompt}
        </div>
      </div>
    </AbsoluteFill>
  )
}

function SceneVisualBase({
  scene,
  assets,
  sceneIndex,
  sceneCount,
  baseFilter,
  layers,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
  sceneIndex: number
  sceneCount: number
  baseFilter?: string
  layers: RenderEffectLayer[]
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const motionTransform = visualTransform(scene.visual, frame, scene.durationInFrames)
  const transform = composeSceneTransform({
    layers,
    frame,
    fps,
    motionTransform,
  })
  const asset = assetById(assets, scene.visual.asset_id)
  const src = mediaSource(asset)

  if (
    src &&
    scene.effects?.preset === 'generated_component' &&
    (asset?.type === 'image' ||
      asset?.type === 'video' ||
      asset?.type === 'generated_video')
  ) {
    const effects = scene.effects as GeneratedComponentEffects
    const registryItem = getGeneratedComponent(effects.component_id)
    const GeneratedComponent = registryItem?.component
    if (GeneratedComponent) {
      return (
        <AbsoluteFill style={{ transform }}>
          <GeneratedComponent
            src={src}
            assetType={asset.type}
            visual={scene.visual}
            effects={effects}
            assets={assets}
            scene={scene}
          />
        </AbsoluteFill>
      )
    }
  }

  if (src && asset && asset.type !== 'audio') {
    return (
      <AbsoluteFill style={{ transform }}>
        <SceneMedia scene={scene} assets={assets} filter={baseFilter} />
      </AbsoluteFill>
    )
  }

  if (scene.visual.mode === 'solid_bg') {
    return (
      <SceneSolidPlaceholder
        scene={scene}
        transform={transform}
        sceneIndex={sceneIndex}
        sceneCount={sceneCount}
      />
    )
  }

  return <SceneFallback scene={scene} transform={transform} />
}

function normalizedEffectLayers(scene: RemotionSceneProps): RenderEffectLayer[] {
  const existing = scene.effectLayers?.length
    ? scene.effectLayers
    : scene.effects
      ? [
          {
            id: `effect_${scene.id}_${scene.effects.preset}`,
            layerKind: 'composite',
            kind: 'composite',
            plugin_id: scene.effects.preset,
            preset: scene.effects.preset,
            effects: scene.effects,
            source: 'scene_recipe',
            is_primary: true,
          } satisfies RenderEffectLayer,
        ]
      : []
  return splitEffectLayers(existing)
}

function primarySceneEffects(
  scene: RemotionSceneProps,
  layers: RenderEffectLayer[],
): SceneEffects | undefined {
  const nonPrimitivePrimary = layers.find(
    (layer) => layer.is_primary && !isPrimitivePreset(layer.effects.preset),
  )
  if (nonPrimitivePrimary) return nonPrimitivePrimary.effects
  if (scene.effects?.preset === 'generated_component') return scene.effects
  return undefined
}


function SceneVisual({
  scene,
  assets,
  sceneIndex,
  sceneCount,
  fps,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
  sceneIndex: number
  sceneCount: number
  fps: number
}) {
  const { layers, binding } = useMemo(() => {
    if (scene.resolvedEffectLayers?.length) {
      return {
        layers: scene.resolvedEffectLayers,
        binding: scene.effectBinding ?? {},
      }
    }
    const splitLayers = normalizedEffectLayers(scene)
    return resolveSceneEffectBindings(scene, fps, splitLayers)
  }, [scene, fps])
  const boundScene: RemotionSceneProps = {
    ...scene,
    effectLayers: layers,
    resolvedEffectLayers: layers,
    effectBinding: binding,
  }
  const baseScene = {
    ...boundScene,
    effects: primarySceneEffects(boundScene, layers),
  }
  const baseFilter = resolveSceneBaseFilter(layers)
  return (
    <AbsoluteFill>
      <SceneVisualBase
        scene={baseScene}
        assets={assets}
        sceneIndex={sceneIndex}
        sceneCount={sceneCount}
        baseFilter={baseFilter}
        layers={layers}
      />
      {layers.map((layer) => (
        <EffectLayerOverlay
          key={layer.id}
          layer={layer}
          scene={boundScene}
          assets={assets}
        />
      ))}
    </AbsoluteFill>
  )
}

function overlayPosition(position: OverlayLayer['layout']['position']) {
  if (position === 'top') {
    return { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 180 }
  }
  if (position === 'bottom') {
    return { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 180 }
  }
  if (position === 'left') {
    return { alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 72 }
  }
  if (position === 'right') {
    return { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 72 }
  }
  return { alignItems: 'center', justifyContent: 'center' }
}

function DynamicOverlay({
  overlay,
  sceneStartFrame,
}: {
  overlay: OverlayLayer
  sceneStartFrame: number
}) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const localStart = Math.round(overlay.start_sec * fps) - sceneStartFrame
  const localEnd = Math.round(overlay.end_sec * fps) - sceneStartFrame
  const inProgress = interpolate(frame, [localStart, localStart + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const outProgress = interpolate(frame, [localEnd - 8, localEnd], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pop = spring({
    frame: Math.max(0, frame - localStart),
    fps,
    config: { damping: 12, stiffness: 140 },
  })
  const opacity = Math.min(inProgress, outProgress) * (overlay.style.opacity ?? 1)
  const pulse =
    overlay.animation.emphasis === 'scale_pulse'
      ? 1 + Math.sin(frame * 0.18) * 0.035
      : 1
  const shake =
    overlay.animation.emphasis === 'shake' ? Math.sin(frame * 0.8) * 7 : 0
  const entranceScale = overlay.animation.in === 'pop' ? 0.72 + pop * 0.28 : 1
  const slideY =
    overlay.animation.in === 'slide_up'
      ? interpolate(inProgress, [0, 1], [80, 0])
      : 0

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        paddingLeft: 56,
        paddingRight: 56,
        pointerEvents: 'none',
        ...overlayPosition(overlay.layout.position),
      }}
    >
      <div
        style={{
          background: overlay.style.background,
          backdropFilter: overlay.style.backdrop_blur_px
            ? `blur(${overlay.style.backdrop_blur_px}px)`
            : undefined,
          borderRadius: overlay.style.border_radius_px ?? 14,
          color: overlay.style.color,
          alignItems: 'center',
          display: overlay.style.color_label ? 'flex' : undefined,
          flexDirection: overlay.style.color_label ? 'column' : undefined,
          fontFamily: overlay.style.font_family,
          fontSize: Math.min(overlay.style.font_size, width * 0.095),
          fontWeight:
            overlay.style.font_weight === 'black'
              ? 900
              : overlay.style.font_weight === 'bold'
                ? 800
                : 500,
          lineHeight: 1.08,
          letterSpacing: overlay.style.letter_spacing_px,
          maxWidth: `${overlay.layout.max_width_pct}%`,
          opacity,
          overflowWrap: 'anywhere',
          padding: overlay.style.background ? '18px 26px' : 0,
          textAlign: overlay.layout.align,
          textTransform: overlay.style.text_transform,
          textShadow: overlay.style.shadow
            ? '0 12px 28px rgba(0,0,0,0.55)'
            : undefined,
          transform: `translate(${shake}px, ${slideY}px) scale(${entranceScale * pulse})`,
          WebkitTextStroke: overlay.style.stroke
            ? `2px ${overlay.style.stroke}`
            : undefined,
        }}
      >
        {overlay.style.color_label ? (
          <div
            style={{
              background: overlay.style.color_label.square_color,
              height: overlay.style.color_label.square_size_px,
              marginBottom: overlay.style.color_label.gap_px,
              width: overlay.style.color_label.square_size_px,
            }}
          />
        ) : null}
        <span>{overlay.text}</span>
      </div>
    </AbsoluteFill>
  )
}

function SceneAudio({
  scene,
  assets,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const { fps } = useVideoConfig()
  return (
    <>
      {scene.audio.map((audio) => {
        const asset = assetById(assets, audio.asset_id)
        const src = mediaSource(asset)
        if (!src) return null

        return (
          <Sequence
            key={audio.id}
            from={Math.max(0, Math.round((audio.start_sec - scene.fromFrame / fps) * fps))}
            durationInFrames={
              audio.end_sec
                ? Math.max(1, Math.round((audio.end_sec - audio.start_sec) * fps))
                : scene.durationInFrames
            }
          >
            <Audio
              src={src}
              startFrom={Math.max(0, Math.round(audio.start_sec * fps))}
              volume={audio.volume}
            />
          </Sequence>
        )
      })}
    </>
  )
}

function sequenceLayoutProps(scene: RemotionSceneProps) {
  return scene.sequence?.layout === 'none' ? { layout: 'none' as const } : {}
}

function transitionForScene(
  transitions: RenderTransition[] | undefined,
  scene: RemotionSceneProps,
  nextScene: RemotionSceneProps | undefined,
) {
  if (!nextScene) return undefined
  return transitions?.find(
    (transition) =>
      transition.from_anchor_id === scene.sourceAnchorId &&
      transition.to_anchor_id === nextScene.sourceAnchorId,
  )
}

function transitionDurationInFrames(
  transition: RenderTransition | undefined,
  fps: number,
) {
  if (!transition || transition.presentation === 'cut') return 0
  return Math.max(1, Math.round(transition.duration_sec * fps))
}

function transitionTiming(transition: RenderTransition, fps: number) {
  const durationInFrames = transitionDurationInFrames(transition, fps)
  if (transition.timing.type === 'spring') {
    return springTiming({
      durationInFrames,
      config: {
        damping: transition.timing.damping,
        stiffness: transition.timing.stiffness,
      },
    })
  }
  return linearTiming({
    durationInFrames,
    easing: easingForName(transition.timing.easing),
  })
}

function buildTransitionElement(
  transition: RenderTransition,
  fps: number,
  width: number,
  height: number,
) {
  const timing = transitionTiming(transition, fps)
  switch (transition.presentation) {
    case 'fade':
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={fade()}
          timing={timing}
        />
      )
    case 'slide':
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={slide({ direction: transition.direction })}
          timing={timing}
        />
      )
    case 'wipe':
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={wipe({ direction: transition.direction })}
          timing={timing}
        />
      )
    case 'flip':
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={flip({ direction: transition.direction })}
          timing={timing}
        />
      )
    case 'clock_wipe':
      return (
        <TransitionSeries.Transition
          key={transition.id}
          presentation={clockWipe({ width, height })}
          timing={timing}
        />
      )
    default:
      return null
  }
}

function SceneContent({
  scene,
  assets,
  sceneIndex,
  sceneCount,
  fps,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
  sceneIndex: number
  sceneCount: number
  fps: number
}) {
  return (
    <AbsoluteFill style={{ background: '#09090b', overflow: 'hidden' }}>
      <SceneVisual
        scene={scene}
        assets={assets}
        sceneIndex={sceneIndex}
        sceneCount={sceneCount}
        fps={fps}
      />
      {scene.overlays.map((overlay) => (
        <DynamicOverlay
          key={overlay.id}
          overlay={overlay}
          sceneStartFrame={scene.fromFrame}
        />
      ))}
      <SceneAudio scene={scene} assets={assets} />
    </AbsoluteFill>
  )
}

function AbsoluteRenderScene({
  scene,
  assets,
  sceneIndex,
  sceneCount,
  fps,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
  sceneIndex: number
  sceneCount: number
  fps: number
}) {
  if (scene.sequence?.layout === 'none') {
    return (
      <Sequence
        from={scene.fromFrame}
        durationInFrames={scene.durationInFrames}
        layout="none"
      >
        <SceneContent
          scene={scene}
          assets={assets}
          sceneIndex={sceneIndex}
          sceneCount={sceneCount}
          fps={fps}
        />
      </Sequence>
    )
  }

  return (
    <Sequence
      from={scene.fromFrame}
      durationInFrames={scene.durationInFrames}
      premountFor={Math.round((scene.sequence?.premount_sec ?? 0.5) * fps)}
    >
      <SceneContent
        scene={scene}
        assets={assets}
        sceneIndex={sceneIndex}
        sceneCount={sceneCount}
        fps={fps}
      />
    </Sequence>
  )
}

export function RenderPlanVideo(props: RemotionRenderProps) {
  const scenes = props.scenes.slice().sort((a, b) => a.fromFrame - b.fromFrame)
  const sceneCount = scenes.length
  const hasTransitions = props.transitions?.some(
    (transition) =>
      transition.presentation !== 'cut' && transition.duration_sec > 0,
  )

  if (hasTransitions) {
    return (
      <AbsoluteFill style={{ background: '#09090b' }}>
        <TransitionSeries>
          {scenes.flatMap((scene, sceneIndex) => {
            const nextScene = scenes[sceneIndex + 1]
            const transition = transitionForScene(
              props.transitions,
              scene,
              nextScene,
            )
            const transitionFrames = transitionDurationInFrames(
              transition,
              props.fps,
            )
            const items = [
              <TransitionSeries.Sequence
                key={scene.id}
                durationInFrames={scene.durationInFrames + transitionFrames}
                name={scene.id}
                {...sequenceLayoutProps(scene)}
              >
                <SceneContent
                  scene={scene}
                  assets={props.assets}
                  sceneIndex={sceneIndex}
                  sceneCount={sceneCount}
                  fps={props.fps}
                />
              </TransitionSeries.Sequence>,
            ]

            if (transition && transitionFrames > 0) {
              const transitionElement = buildTransitionElement(
                transition,
                props.fps,
                props.width,
                props.height,
              )
              if (transitionElement) {
                items.push(transitionElement)
              }
            }

            return items
          })}
        </TransitionSeries>
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ background: '#09090b' }}>
      {scenes.map((scene, sceneIndex) => (
        <AbsoluteRenderScene
          key={scene.id}
          scene={scene}
          assets={props.assets}
          sceneIndex={sceneIndex}
          sceneCount={sceneCount}
          fps={props.fps}
        />
      ))}
    </AbsoluteFill>
  )
}
