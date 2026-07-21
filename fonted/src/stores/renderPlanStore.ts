import { create } from 'zustand'

import type {
  AudioLayer,
  OverlayLayer,
  RenderPlanV1,
  SceneEffects,
  RenderScene,
  VisualLayer,
} from '@/types/render-plan'
import type { TimelineTransition } from '@/types/migration-protocol'
import { applyAspectRatioToRenderPlan } from '@shared/lib/render-canvas'
import type { DirectorAspectRatio } from '@shared/types/director-context'

export type RenderPlanSyncStatus = 'synced' | 'dirty' | 'syncing' | 'failed'

interface RenderPlanState {
  plan: RenderPlanV1 | null
  isDirty: boolean
  syncStatus: RenderPlanSyncStatus
  lastSyncError: string | null
  lastChangeSummary: string | null
  setPlan: (plan: RenderPlanV1 | null) => void
  markSaving: () => void
  markDirty: (summary?: string) => void
  markSaved: () => void
  markSyncFailed: (message: string) => void
  getSceneByAnchor: (anchorId: string | undefined) => RenderScene | undefined
  setAspectRatio: (aspectRatio: DirectorAspectRatio) => void
  updateSceneIntent: (
    sceneId: string,
    patch: Partial<RenderScene['intent']>,
  ) => void
  updateSceneVisual: (sceneId: string, patch: Partial<VisualLayer>) => void
  updateSceneEffect: (sceneId: string, effect?: SceneEffects) => void
  addOverlay: (sceneId: string, overlay: OverlayLayer) => void
  updateOverlay: (
    sceneId: string,
    overlayId: string,
    patch: Partial<OverlayLayer>,
  ) => void
  removeOverlay: (sceneId: string, overlayId: string) => void
  duplicateOverlay: (sceneId: string, overlayId: string) => void
  updateAudio: (
    sceneId: string,
    audioId: string,
    patch: Partial<AudioLayer>,
  ) => void
  updateTransition: (
    transitionId: string,
    patch: Partial<TimelineTransition>,
  ) => void
}

function normalizePlan(plan: RenderPlanV1): RenderPlanV1 {
  return {
    ...plan,
    plan_revision: plan.plan_revision ?? 1,
    updated_at: plan.updated_at ?? new Date().toISOString(),
  }
}

function bumpPlan(plan: RenderPlanV1): RenderPlanV1 {
  return {
    ...plan,
    plan_revision: (plan.plan_revision ?? 1) + 1,
    updated_at: new Date().toISOString(),
  }
}

function valueLabel(value: unknown): string {
  if (value === undefined) return '空'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function fieldChangeSummary(
  sceneId: string,
  scope: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): string {
  const changes = Object.entries(patch)
    .filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
    .map(([key, value]) => `${key}: ${valueLabel(before[key])} → ${valueLabel(value)}`)
  return changes.length
    ? `已修改 ${sceneId}：${scope} ${changes.join('，')}`
    : `已修改 ${sceneId}：${scope}`
}

function changedState(
  plan: RenderPlanV1,
  summary: string,
): Pick<RenderPlanState, 'plan' | 'isDirty' | 'syncStatus' | 'lastSyncError' | 'lastChangeSummary'> {
  return {
    plan: bumpPlan(plan),
    isDirty: true,
    syncStatus: 'dirty',
    lastSyncError: null,
    lastChangeSummary: summary,
  }
}

export const useRenderPlanStore = create<RenderPlanState>((set, get) => ({
  plan: null,
  isDirty: false,
  syncStatus: 'synced',
  lastSyncError: null,
  lastChangeSummary: null,

  setPlan: (plan) =>
    set({
      plan: plan ? normalizePlan(structuredClone(plan)) : null,
      isDirty: false,
      syncStatus: 'synced',
      lastSyncError: null,
      lastChangeSummary: null,
    }),

  markSaving: () => set({ syncStatus: 'syncing', lastSyncError: null }),

  markDirty: (summary) =>
    set((state) => ({
      plan: state.plan ? bumpPlan(state.plan) : state.plan,
      isDirty: true,
      syncStatus: 'dirty',
      lastSyncError: null,
      lastChangeSummary: summary ?? state.lastChangeSummary,
    })),

  markSaved: () =>
    set({
      isDirty: false,
      syncStatus: 'synced',
      lastSyncError: null,
    }),

  markSyncFailed: (message) =>
    set({
      syncStatus: 'failed',
      lastSyncError: message,
    }),

  getSceneByAnchor: (anchorId) => {
    if (!anchorId) return undefined
    return get().plan?.scenes.find((scene) => scene.source_anchor_id === anchorId)
  },

  setAspectRatio: (aspectRatio) =>
    set((state) => {
      if (!state.plan || state.plan.canvas.ratio === aspectRatio) return state
      const next = applyAspectRatioToRenderPlan(state.plan, aspectRatio)
      const summary = `已修改全局：画幅 ${state.plan.canvas.ratio} → ${aspectRatio}`
      return changedState(next, summary)
    }),

  updateSceneIntent: (sceneId, patch) =>
    set((state) => {
      if (!state.plan) return state
      let summary = `已修改 ${sceneId}：段落目标`
      const scenes = state.plan.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        summary = fieldChangeSummary(sceneId, '段落目标', scene.intent, patch)
        return { ...scene, intent: { ...scene.intent, ...patch } }
      })
      return changedState({ ...state.plan, scenes }, summary)
    }),

  updateSceneVisual: (sceneId, patch) =>
    set((state) => {
      if (!state.plan) return state
      let summary = `已修改 ${sceneId}：画面素材`
      const scenes = state.plan.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        summary = fieldChangeSummary(
          sceneId,
          '画面素材',
          scene.visual as unknown as Record<string, unknown>,
          patch as Record<string, unknown>,
        )
        return { ...scene, visual: { ...scene.visual, ...patch } }
      })
      return changedState({ ...state.plan, scenes }, summary)
    }),

  updateSceneEffect: (sceneId, effect) =>
    set((state) => {
      if (!state.plan) return state
      let summary = `已修改 ${sceneId}：画面效果`
      const scenes = state.plan.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const before = scene.effects?.preset ?? '无效果'
        const after = effect?.preset ?? '无效果'
        summary = `已修改 ${sceneId}：效果 ${before} → ${after}`
        const primaryLayer = scene.effect_layers?.find((layer) => layer.is_primary)
        const secondaryLayers = (scene.effect_layers ?? []).filter((layer) => !layer.is_primary)
        return {
          ...scene,
          effects: effect,
          effect_layers: effect
            ? [
                {
                  id: primaryLayer?.id ?? `effect_${scene.source_anchor_id}_manual`,
                  layerKind: primaryLayer?.layerKind ?? primaryLayer?.kind ?? 'composite',
                  kind: primaryLayer?.kind ?? primaryLayer?.layerKind ?? 'composite',
                  plugin_id: primaryLayer?.plugin_id ?? 'manual_effect',
                  preset: effect.preset,
                  effects: effect,
                  source: 'scene_recipe' as const,
                  is_primary: true,
                  reason: 'Updated from PropertyEditorPanel.',
                  resolution: primaryLayer?.resolution,
                },
                ...secondaryLayers,
              ]
            : secondaryLayers.length
              ? secondaryLayers
              : undefined,
        }
      })
      return changedState({ ...state.plan, scenes }, summary)
    }),

  addOverlay: (sceneId, overlay) =>
    set((state) => {
      if (!state.plan) return state
      const scenes = state.plan.scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, overlays: [...scene.overlays, overlay] }
          : scene,
      )
      return changedState({ ...state.plan, scenes }, `已修改 ${sceneId}：新增文字层`)
    }),

  updateOverlay: (sceneId, overlayId, patch) =>
    set((state) => {
      if (!state.plan) return state
      let summary = `已修改 ${sceneId}：文字层`
      const scenes = state.plan.scenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              overlays: scene.overlays.map((overlay) => {
                if (overlay.id !== overlayId) return overlay
                summary = fieldChangeSummary(sceneId, `文字层 ${overlayId}`, overlay as unknown as Record<string, unknown>, patch as Record<string, unknown>)
                return { ...overlay, ...patch }
              }),
            }
          : scene,
      )
      return changedState({ ...state.plan, scenes }, summary)
    }),

  removeOverlay: (sceneId, overlayId) =>
    set((state) => {
      if (!state.plan) return state
      const scenes = state.plan.scenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              overlays: scene.overlays.filter((overlay) => overlay.id !== overlayId),
            }
          : scene,
      )
      return changedState({ ...state.plan, scenes }, `已修改 ${sceneId}：删除文字层 ${overlayId}`)
    }),

  duplicateOverlay: (sceneId, overlayId) =>
    set((state) => {
      if (!state.plan) return state
      const scenes = state.plan.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const source = scene.overlays.find((overlay) => overlay.id === overlayId)
        if (!source) return scene
        const copy: OverlayLayer = {
          ...structuredClone(source),
          id: `${source.id}_copy_${Date.now()}`,
          text: `${source.text} 副本`,
        }
        return { ...scene, overlays: [...scene.overlays, copy] }
      })
      return changedState({ ...state.plan, scenes }, `已修改 ${sceneId}：复制文字层 ${overlayId}`)
    }),

  updateAudio: (sceneId, audioId, patch) =>
    set((state) => {
      if (!state.plan) return state
      let summary = `已修改 ${sceneId}：音频`
      const scenes = state.plan.scenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              audio: scene.audio.map((audio) => {
                if (audio.id !== audioId) return audio
                summary = fieldChangeSummary(sceneId, `音频 ${audioId}`, audio as unknown as Record<string, unknown>, patch as Record<string, unknown>)
                return { ...audio, ...patch }
              }),
            }
          : scene,
      )
      return changedState({ ...state.plan, scenes }, summary)
    }),

  updateTransition: (transitionId, patch) =>
    set((state) => {
      if (!state.plan) return state
      const transitions = (state.plan.transitions ?? []).map((transition) =>
        transition.id === transitionId ? { ...transition, ...patch } : transition,
      )
      return changedState(
        { ...state.plan, transitions },
        `已修改转场 ${transitionId}`,
      )
    }),
}))
