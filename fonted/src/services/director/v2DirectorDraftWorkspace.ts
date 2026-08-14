import type { V2TimelineDraftDetailDto, V2TimelineDraftDto } from '@/lib/api'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorChatStore } from '@/stores/directorChatStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import type { TimelineMode } from '@/stores/editorStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'

export type V2DraftWorkspaceInput = Pick<
  V2TimelineDraftDto,
  'draftId' | 'revision' | 'spec' | 'traceDir'
> & Pick<Partial<V2TimelineDraftDetailDto>, 'latestRun' | 'pendingTimelineRevisions'>

export type V2CanvasSurface =
  | 'sample_analysis'
  | 'timeline_plan'
  | 'rendered_output'
  | 'empty'

export interface V2PlanSceneCard {
  id: string
  title: string
  description?: string
  startSec: number
  durationSec: number
}

export interface V2PlanVisibleText {
  id: string
  type: RemotionTimelineSpecV1['overlays'][number]['type']
  text: string
  startSec: number
  endSec: number
  trackId?: string
  xPct: number
  yPct: number
  widthPct?: number
  maxLines?: number
  maxLinesSource?: 'segment_override' | 'track_default'
  background?: string
  enterAnimation: RemotionTimelineSpecV1['overlays'][number]['enter_animation']
  exitAnimation: RemotionTimelineSpecV1['overlays'][number]['exit_animation']
}

export interface V2PlanScenePresentation extends V2PlanSceneCard {
  sceneType: RemotionTimelineSpecV1['scenes'][number]['type']
  visualRole?: RemotionTimelineSpecV1['scenes'][number]['visual_role']
  assetLabel?: string
  assetSource?: RemotionTimelineSpecV1['assets'][number]['source']
  sourceLabel: string
  motion?: RemotionTimelineSpecV1['scenes'][number]['motion']
  deliveryState:
    | 'user_material'
    | 'generated'
    | 'pending_generation'
    | 'pending_reuse'
    | 'ready_asset'
    | 'blocked'
    | 'programmatic'
  materialPlan?: {
    type: RemotionTimelineSpecV1['material_jobs'][number]['type']
    status: RemotionTimelineSpecV1['material_jobs'][number]['status']
    prompt?: string
  }
  visibleTexts: V2PlanVisibleText[]
  transitionAfter?: Pick<
    RemotionTimelineSpecV1['transitions'][number],
    'type' | 'duration_sec' | 'direction' | 'custom_render'
  >
}

export interface V2PlanPresentation {
  durationSec: number
  width: number
  height: number
  scenes: V2PlanScenePresentation[]
}

interface ReviewScene {
  id: string
  title_zh?: string
  role_zh?: string
  description_zh?: string
  source_zh?: string
}

/** A persisted V2 spec is sufficient to display a plan; preview review is optional enrichment. */
export function resolveV2CanvasSurface(input: {
  timelineMode: TimelineMode
  hasSample: boolean
  hasSpec: boolean
  hasRenderedOutput: boolean
}): V2CanvasSurface {
  if (input.timelineMode === 'sample' && input.hasSample) return 'sample_analysis'
  if (input.hasRenderedOutput) return 'rendered_output'
  if (input.hasSpec) return 'timeline_plan'
  return 'empty'
}

export function buildV2PlanSceneCards(
  spec: RemotionTimelineSpecV1,
  reviewScenes: ReviewScene[] = [],
): V2PlanSceneCard[] {
  const reviews = new Map(reviewScenes.map((scene) => [scene.id, scene]))
  return spec.scenes
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((scene) => {
      const review = reviews.get(scene.id)
      return {
        id: scene.id,
        title:
          scene.creative_intent?.title ??
          review?.title_zh ??
          scene.title ??
          review?.role_zh ??
          '未命名镜头',
        description:
          scene.creative_intent?.description ??
          review?.description_zh ??
          scene.body ??
          review?.source_zh,
        startSec: scene.start_sec,
        durationSec: scene.duration_sec,
      }
    })
}

/**
 * Read-only plan facts shared by the center plan view and right inspector.
 * Visible text is derived from overlays only; editor notes never become subtitles.
 */
export function buildV2PlanPresentation(
  spec: RemotionTimelineSpecV1,
  reviewScenes: ReviewScene[] = [],
): V2PlanPresentation {
  const cards = new Map(buildV2PlanSceneCards(spec, reviewScenes).map((scene) => [scene.id, scene]))
  const assets = new Map(spec.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map((spec.caption_tracks ?? []).map((track) => [track.id, track]))
  const materialJobs = new Map(spec.material_jobs.map((job) => [job.scene_id, job]))
  const transitions = new Map(spec.transitions.map((transition) => [transition.from_scene_id, transition]))

  const scenes = spec.scenes
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((scene): V2PlanScenePresentation => {
      const card = cards.get(scene.id)!
      const sceneEnd = scene.start_sec + scene.duration_sec
      const asset = scene.asset_id ? assets.get(scene.asset_id) : undefined
      const materialJob = materialJobs.get(scene.id)
      const outputAsset = materialJob?.output_asset_id
        ? assets.get(materialJob.output_asset_id)
        : undefined
      const deliveredAsset = outputAsset ?? asset
      const delivery = v2DeliveryProjection({
        asset: deliveredAsset,
        outputAssetAvailable: outputAsset != null,
        materialJob,
        sceneType: scene.type,
      })
      const transition = transitions.get(scene.id)
      const visibleTexts = spec.overlays
        .filter((overlay) => {
          if (!overlay.text?.trim()) return false
          if (overlay.scene_id) return overlay.scene_id === scene.id
          return overlay.start_sec < sceneEnd && overlay.end_sec > scene.start_sec
        })
        .sort((a, b) => a.start_sec - b.start_sec)
        .map((overlay): V2PlanVisibleText => {
          const track = overlay.track_id ? tracks.get(overlay.track_id) : undefined
          return {
            id: overlay.id,
            type: overlay.type,
            text: overlay.text!.trim(),
            startSec: overlay.start_sec,
            endSec: overlay.end_sec,
            trackId: overlay.track_id,
            xPct: overlay.x_pct,
            yPct: overlay.y_pct,
            widthPct: overlay.width_pct ?? track?.width_pct,
            maxLines: overlay.max_lines ?? track?.max_lines,
            maxLinesSource: overlay.max_lines != null
              ? 'segment_override'
              : track?.max_lines != null
                ? 'track_default'
                : undefined,
            background: overlay.background,
            enterAnimation:
              overlay.enter_animation ??
              overlay.animation ??
              track?.enter_animation ??
              'none',
            exitAnimation: overlay.exit_animation ?? track?.exit_animation ?? 'none',
          }
        })

      return {
        ...card,
        sceneType: scene.type,
        visualRole: scene.visual_role,
        assetLabel: deliveredAsset?.label ?? deliveredAsset?.id,
        assetSource: deliveredAsset?.source,
        ...delivery,
        motion: scene.motion,
        materialPlan: materialJob
          ? {
              type: materialJob.type,
              status: materialJob.status,
              prompt: materialJob.prompt,
            }
          : undefined,
        visibleTexts,
        transitionAfter: transition
          ? {
              type: transition.type,
              duration_sec: transition.duration_sec,
              direction: transition.direction,
              custom_render: transition.custom_render,
            }
          : undefined,
      }
    })

  return {
    durationSec: spec.canvas.duration_sec,
    width: spec.canvas.width,
    height: spec.canvas.height,
    scenes,
  }
}

function v2DeliveryProjection(input: {
  asset?: RemotionTimelineSpecV1['assets'][number]
  outputAssetAvailable: boolean
  materialJob?: RemotionTimelineSpecV1['material_jobs'][number]
  sceneType: RemotionTimelineSpecV1['scenes'][number]['type']
}): Pick<V2PlanScenePresentation, 'sourceLabel' | 'deliveryState'> {
  if (input.materialJob?.status === 'failed') {
    return { sourceLabel: '交付失败', deliveryState: 'blocked' }
  }
  if (input.materialJob?.status === 'fulfilled' && !input.outputAssetAvailable) {
    return { sourceLabel: '交付失败（缺少产物）', deliveryState: 'blocked' }
  }
  if (input.materialJob?.status === 'planned') {
    if (input.materialJob.type === 'request_user_material') {
      return { sourceLabel: '用户素材（待补）', deliveryState: 'blocked' }
    }
    if (input.materialJob.type === 'generate_video') {
      return { sourceLabel: 'AI 生成素材（待生成）', deliveryState: 'pending_generation' }
    }
    return { sourceLabel: '素材复用（待完成）', deliveryState: 'pending_reuse' }
  }
  if (input.asset) {
    const kind = {
      user_asset: '用户素材',
      generated_asset: 'AI 生成素材',
      stock_asset: '库存素材',
      local_fixture: '本地素材',
      fallback_asset: '兜底素材',
    }[input.asset.source]
    return {
      sourceLabel: `${kind} · ${input.asset.label?.trim() || '未命名素材'}`,
      deliveryState: input.asset.source === 'user_asset'
        ? 'user_material'
        : input.asset.source === 'generated_asset'
          ? 'generated'
          : 'ready_asset',
    }
  }
  return input.sceneType === 'remotion_card'
    ? { sourceLabel: '程序化画面', deliveryState: 'programmatic' }
    : { sourceLabel: '未绑定素材', deliveryState: 'blocked' }
}

export function v2DeliveryStateLabel(state: V2PlanScenePresentation['deliveryState']) {
  return {
    user_material: '用户素材',
    generated: '已生成',
    pending_generation: '待生成 · 当前不是最终画面',
    pending_reuse: '待复用 · 当前不是最终画面',
    ready_asset: '现有素材 · 可渲染',
    blocked: '失败或缺素材 · 暂不可导出',
    programmatic: '程序化画面',
  }[state]
}

/** Maps scene, overlay, or transition timeline selection back to its owning V2 scene. */
export function resolveV2PlanSceneIdFromClip(
  spec: RemotionTimelineSpecV1,
  selectedClipId?: string | null,
): string | undefined {
  if (!selectedClipId) return undefined
  if (selectedClipId.startsWith('v2-scene-')) {
    return selectedClipId.slice('v2-scene-'.length)
  }
  if (selectedClipId.startsWith('v2-overlay-')) {
    const overlayId = selectedClipId.slice('v2-overlay-'.length)
    const overlay = spec.overlays.find((item) => item.id === overlayId)
    if (!overlay) return undefined
    if (overlay.scene_id) return overlay.scene_id
    return spec.scenes.find(
      (scene) =>
        overlay.start_sec < scene.start_sec + scene.duration_sec &&
        overlay.end_sec > scene.start_sec,
    )?.id
  }
  if (selectedClipId.startsWith('v2-transition-')) {
    const transitionId = selectedClipId.slice('v2-transition-'.length)
    return spec.transitions.find((item) => item.id === transitionId)?.from_scene_id
  }
  return undefined
}

function aspectRatioForCanvas(
  canvas: RemotionTimelineSpecV1['canvas'],
): '9:16' | '16:9' | '1:1' | '4:3' {
  const actual = canvas.width / canvas.height
  const supported = [
    { value: '9:16' as const, ratio: 9 / 16 },
    { value: '16:9' as const, ratio: 16 / 9 },
    { value: '1:1' as const, ratio: 1 },
    { value: '4:3' as const, ratio: 4 / 3 },
  ]
  return supported.reduce((closest, candidate) =>
    Math.abs(candidate.ratio - actual) < Math.abs(closest.ratio - actual)
      ? candidate
      : closest,
  ).value
}

/**
 * Single frontend bridge for opening a server-owned V2 draft in the editor.
 * It never projects through V1 state.
 */
export function activateV2DraftWorkspace(draft: V2DraftWorkspaceInput): void {
  useV2TimelineStore.getState().openPersistedDraft(draft)
  useCreationStore.getState().setAspectRatio(aspectRatioForCanvas(draft.spec.canvas))
  useCreationStore.getState().setDurationSec(draft.spec.canvas.duration_sec)
  useEditorStore.getState().setGenerationEditEnabled(true)
  useEditorStore.getState().setTimelineMode('generation')
  usePlaybackStore.getState().pause()
  usePlaybackStore.getState().setDuration(draft.spec.canvas.duration_sec)
  usePlaybackStore.getState().seek(0)
  useTaskStore.getState().setActiveTaskId(draft.draftId)
  useTaskStore.getState().setBackendReady(true)
}

/** Starts a blank local workspace without deleting persisted drafts or shared materials. */
export function startNewV2DraftWorkspace(): void {
  useV2TimelineStore.getState().clear()
  useCreationStore.setState({
    sampleUrl: '',
    sampleName: '',
    inputText: '',
    attachments: [],
    attachmentUploads: [],
    pendingAttachmentIds: [],
    materialsSnapshotAuthoritative: false,
    sampleSnapshotAuthoritative: false,
    showSampleInInputTray: false,
    aspectRatio: '9:16',
    aspectRatioExplicit: false,
    durationSec: undefined,
    styleIntensity: 'medium',
    styleIntensityExplicit: false,
    isAnalyzing: false,
    isSampleParsed: false,
  })
  useDirectorContextStore.getState().reset()
  useDirectorChatStore.getState().reset()
  useDirectorChatStore.getState().ensureWelcome()
  useTaskStore.getState().setActiveTaskId(null)
  useTaskStore.getState().resetTask()
  useTaskStore.setState({ lastPrompt: null })
  useEditorStore.setState({
    projectName: '未命名视频项目',
    sidebarTab: 'config',
    sidebarSubView: 'main',
    materialLibraryMode: 'manage',
    timelineMode: 'sample',
    generationEditEnabled: false,
  })
  usePlaybackStore.setState({
    isPlaying: false,
    currentTime: 0,
    duration: 15,
    syncLock: false,
  })
}
