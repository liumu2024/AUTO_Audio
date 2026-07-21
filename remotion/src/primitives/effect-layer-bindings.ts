import { useMemo } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'

import {
  resolveEffectLayerBindings,
  sampleLayerEffectsAtTime,
} from '../../../shared/lib/effect-layer-binding-resolver'
import type { RemotionSceneProps, RenderEffectLayer, SceneEffectBindingContext } from '../types'

export function resolveSceneEffectBindings(
  scene: RemotionSceneProps,
  fps?: number,
  baseLayers?: RenderEffectLayer[],
): {
  layers: RenderEffectLayer[]
  binding: SceneEffectBindingContext
} {
  const layersInput = baseLayers ?? scene.effectLayers ?? []
  const resolved = resolveEffectLayerBindings({
    sceneId: scene.id,
    layers: layersInput,
    sharedParams: scene.effectBinding?.sharedParams,
    sharedTimeline: scene.effectBinding?.sharedTimeline,
    sharedGeometry: scene.effectBinding?.sharedGeometry,
    beatTimes: scene.effectBinding?.beatTimes,
    sceneStartSec: fps ? scene.fromFrame / fps : undefined,
  })

  return {
    layers: resolved.layers,
    binding: {
      ...scene.effectBinding,
      runtimeFollows: resolved.runtimeFollows,
      warnings: resolved.warnings,
    },
  }
}

export function useBoundEffectLayer(
  layer: RenderEffectLayer,
  scene: RemotionSceneProps,
): RenderEffectLayer {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const runtimeFollows = scene.effectBinding?.runtimeFollows ?? []
  const resolvedLayers = scene.resolvedEffectLayers ?? scene.effectLayers ?? []

  return useMemo(() => {
    if (!runtimeFollows.some((follow) => follow.targetLayerId === layer.id)) {
      return layer
    }

    const effects = sampleLayerEffectsAtTime({
      layers: resolvedLayers,
      runtimeFollows,
      layerId: layer.id,
      timeSec: frame / fps,
    })

    return effects ? { ...layer, effects } : layer
  }, [frame, fps, layer, resolvedLayers, runtimeFollows])
}
