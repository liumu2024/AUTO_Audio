import { applyAspectRatioToRenderPlan } from './render-canvas.js'
import { createDefaultEffect, isKnownEffectPreset } from './effect-registry.js'
import type { DirectorContextSlots } from '../types/director-context.js'
import type {
  AddOverlayPayload,
  ApplyEffectLayerPayload,
  BindMaterialPayload,
  RenderAction,
  RenderActionBatch,
  RequestComponentPayload,
  SetAudioPayload,
  SetCanvasPayload,
} from '../types/render-action.js'
import type { RenderPlanV1, SceneEffects } from '../types/render-plan.v1.js'

function clonePlan(plan: RenderPlanV1): RenderPlanV1 {
  return structuredClone(plan)
}

function applyBindMaterial(plan: RenderPlanV1, payload: BindMaterialPayload): RenderPlanV1 {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.id !== payload.sceneId) return scene
      return {
        ...scene,
        visual: {
          ...scene.visual,
          asset_id: payload.assetId,
          material_source: 'user_material',
          fit: payload.fit ?? scene.visual.fit,
          trim: payload.trim ?? scene.visual.trim,
        },
      }
    }),
  }
}

function applyEffectLayer(plan: RenderPlanV1, payload: ApplyEffectLayerPayload): RenderPlanV1 {
  const effects = payload.effects
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.id !== payload.sceneId) return scene
      const nextEffects = effects ?? scene.effects
      const primaryLayer = scene.effect_layers?.find((layer) => layer.is_primary)
      const layerKind = payload.layerKind ?? primaryLayer?.layerKind ?? 'composite'
      const pluginId = payload.plugin_id ?? primaryLayer?.plugin_id ?? 'manual_effect'
      if (!nextEffects) {
        return { ...scene, effects: undefined, effect_layers: undefined }
      }
      return {
        ...scene,
        effects: nextEffects,
        effect_layers: [
          {
            id: primaryLayer?.id ?? `effect_${scene.source_anchor_id}_manual`,
            layerKind,
            kind: layerKind,
            plugin_id: pluginId,
            preset: nextEffects.preset,
            effects: nextEffects,
            source: 'scene_recipe',
            is_primary: true,
            reason: 'Applied via RenderActionEngine.',
          },
          ...(scene.effect_layers ?? []).filter((layer) => !layer.is_primary),
        ],
      }
    }),
  }
}

function applyAddOverlay(plan: RenderPlanV1, payload: AddOverlayPayload): RenderPlanV1 {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.id !== payload.sceneId) return scene
      return {
        ...scene,
        overlays: [...scene.overlays, payload.overlay],
      }
    }),
  }
}

function applySetAudio(plan: RenderPlanV1, payload: SetAudioPayload): RenderPlanV1 {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.id !== payload.sceneId) return scene
      if (!scene.audio.length) {
        return {
          ...scene,
          audio: [
            {
              id: payload.audioId ?? `audio_${scene.id}`,
              type: payload.patch.type ?? 'bgm',
              start_sec: payload.patch.start_sec ?? scene.start_sec,
              end_sec: payload.patch.end_sec ?? scene.end_sec,
              volume: payload.patch.volume ?? 1,
              ...payload.patch,
            },
          ],
        }
      }
      return {
        ...scene,
        audio: scene.audio.map((layer) => {
          if (payload.audioId && layer.id !== payload.audioId) return layer
          return { ...layer, ...payload.patch }
        }),
      }
    }),
  }
}

function applySetCanvas(plan: RenderPlanV1, payload: SetCanvasPayload): RenderPlanV1 {
  if (!payload.aspectRatio) return plan
  return applyAspectRatioToRenderPlan(plan, payload.aspectRatio)
}

function applyRequestComponent(plan: RenderPlanV1, payload: RequestComponentPayload): RenderPlanV1 {
  const decisions = plan.component_resolution?.decisions ?? []
  return {
    ...plan,
    component_resolution: {
      enabled: true,
      authoring_enabled: plan.component_resolution?.authoring_enabled ?? false,
      decisions: [
        ...decisions,
        {
          capability_id: payload.capability_id,
          segment_ids: payload.segment_ids ?? [],
          decision: 'fallback',
          reason:
            payload.reason ??
            `Requested component capability ${payload.capability_id} via RenderActionEngine.`,
        },
      ],
    },
  }
}

export function applyRenderAction(plan: RenderPlanV1, action: RenderAction): RenderPlanV1 {
  const next = clonePlan(plan)
  switch (action.type) {
    case 'BIND_MATERIAL':
      return applyBindMaterial(next, action.payload as BindMaterialPayload)
    case 'APPLY_EFFECT_LAYER':
      return applyEffectLayer(next, action.payload as ApplyEffectLayerPayload)
    case 'ADD_OVERLAY':
      return applyAddOverlay(next, action.payload as AddOverlayPayload)
    case 'SET_AUDIO':
      return applySetAudio(next, action.payload as SetAudioPayload)
    case 'SET_CANVAS':
      return applySetCanvas(next, action.payload as SetCanvasPayload)
    case 'REQUEST_COMPONENT':
      return applyRequestComponent(next, action.payload as RequestComponentPayload)
    default:
      return next
  }
}

export function applyRenderActions(plan: RenderPlanV1, actions: RenderAction[]): RenderPlanV1 {
  return actions.reduce((current, action) => applyRenderAction(current, action), plan)
}

export function applyRenderActionBatch(plan: RenderPlanV1, batch: RenderActionBatch): RenderPlanV1 {
  return applyRenderActions(plan, batch.actions)
}

/** 将 REVISE_RENDER_PLAN 的 slots 变更翻译为 RenderAction 列表 */
export function renderActionsFromSlotsPatch(
  slots: Partial<DirectorContextSlots>,
  plan: RenderPlanV1,
): RenderAction[] {
  const actions: RenderAction[] = []
  if (slots.aspectRatio && slots.aspectRatio !== plan.canvas.ratio) {
    actions.push({
      type: 'SET_CANVAS',
      payload: { aspectRatio: slots.aspectRatio },
    })
  }
  if (slots.subtitlePolicy === 'none') {
    for (const scene of plan.scenes) {
      if (!scene.overlays.length) continue
      actions.push({
        type: 'ADD_OVERLAY',
        sceneId: scene.id,
        anchorId: scene.source_anchor_id,
        payload: {
          sceneId: scene.id,
          overlay: {
            ...scene.overlays[0],
            text: '',
            style: { ...scene.overlays[0].style, opacity: 0 },
          },
        },
      })
    }
  }
  return actions
}

export function sceneEffectFromPreset(preset: string): SceneEffects | undefined {
  if (!isKnownEffectPreset(preset)) return undefined
  return createDefaultEffect(preset)
}
