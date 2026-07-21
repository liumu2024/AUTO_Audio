import type {
  AudioLayer,
  OverlayLayer,
  RenderEffectLayer,
  RenderAsset,
  RenderPlanV1,
  RenderScene,
  RenderSceneEffectBinding,
  SceneEffects,
  VisualLayer,
} from '../../../../shared/types/render-plan.v1.js'
import { splitEffectLayers } from '../../../../shared/lib/legacy-preset-split.js'
import {
  mergeBindingWarningsIntoComponentResolution,
  resolveEffectLayerBindings,
  type SceneEffectBindingContext,
} from '../../../../shared/lib/effect-layer-binding-resolver.js'

export interface RemotionSceneProps {
  id: string
  sourceAnchorId: string
  fromFrame: number
  durationInFrames: number
  sequence?: RenderScene['sequence']
  role: string
  visual: VisualLayer
  effects?: SceneEffects
  effectLayers?: RenderEffectLayer[]
  resolvedEffectLayers?: RenderEffectLayer[]
  effectBinding?: SceneEffectBindingContext
  overlays: OverlayLayer[]
  audio: AudioLayer[]
}

export interface RemotionRenderProps {
  taskId: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  strategy: RenderPlanV1['strategy']
  assets: RenderAsset[]
  scenes: RemotionSceneProps[]
  transitions: NonNullable<RenderPlanV1['transitions']>
  componentResolution?: RenderPlanV1['component_resolution']
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

function sceneToProps(scene: RenderScene, fps: number): RemotionSceneProps {
  const fromFrame = secondsToFrames(scene.start_sec, fps)
  const endFrame = secondsToFrames(scene.end_sec, fps)
  const splitLayers = scene.effect_layers?.length ? splitEffectLayers(scene.effect_layers) : undefined
  let effectLayers = splitLayers
  let effectBinding: SceneEffectBindingContext | undefined

  if (splitLayers?.length) {
    const bindingContext: RenderSceneEffectBinding | undefined = scene.effect_binding
    const resolved = resolveEffectLayerBindings({
      sceneId: scene.id,
      layers: splitLayers,
      sharedParams: bindingContext?.sharedParams,
      sharedTimeline: bindingContext?.sharedTimeline,
      sharedGeometry: bindingContext?.sharedGeometry,
      beatTimes: bindingContext?.beatTimes,
      sceneStartSec: scene.start_sec,
      sceneDurationSec: Math.max(0, scene.end_sec - scene.start_sec),
    })
    effectLayers = resolved.layers
    effectBinding = {
      ...bindingContext,
      runtimeFollows: resolved.runtimeFollows,
      warnings: resolved.warnings,
    }
  }
  const primaryEffects =
    effectLayers?.find((layer) => layer.is_primary)?.effects ?? scene.effects

  return {
    id: scene.id,
    sourceAnchorId: scene.source_anchor_id,
    fromFrame,
    durationInFrames: Math.max(1, endFrame - fromFrame),
    sequence: scene.sequence,
    role: scene.role,
    visual: scene.visual,
    effects: primaryEffects,
    effectLayers,
    resolvedEffectLayers: effectLayers,
    effectBinding,
    overlays: scene.overlays,
    audio: scene.audio,
  }
}

export function buildRemotionRenderProps(
  plan: RenderPlanV1,
): RemotionRenderProps {
  const fps = plan.canvas.fps
  const scenes = plan.scenes.map((scene) => sceneToProps(scene, fps))
  const bindingWarnings = scenes.flatMap((scene) => scene.effectBinding?.warnings ?? [])

  return {
    taskId: plan.task_id,
    fps,
    width: plan.canvas.width,
    height: plan.canvas.height,
    durationInFrames: secondsToFrames(plan.duration_sec, fps),
    strategy: plan.strategy,
    assets: plan.assets,
    scenes,
    transitions: plan.transitions ?? [],
    componentResolution: bindingWarnings.length
      ? mergeBindingWarningsIntoComponentResolution({
          componentResolution: plan.component_resolution,
          warnings: bindingWarnings,
        })
      : plan.component_resolution,
  }
}
