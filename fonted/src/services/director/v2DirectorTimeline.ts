import { classifyExternalUrlAccess } from '@shared/lib/external-url-access'
import type {
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
  RemotionTimelineTransition,
} from '@shared/types/remotion-timeline-spec.v1'

import * as api from '@/lib/api'
import { env } from '@/config/env'
import { useCreationStore, type InputAttachment } from '@/stores/creationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'
import { useTimelineStore } from '@/stores/timelineStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { DirectorAspectRatio } from '@shared/types/director-context'
import type { MigrationProtocolV12, TimelineTransition } from '@/types/migration-protocol'
import type { OutlineSegment, PipelineBundle, UserMaterialDto } from '@/types/pipeline'
import type { TimelineProject } from '@/types/timeline'

export interface V2DirectorMaterial {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  tags?: string[]
}

export interface V2DirectorTimelineInput {
  taskId?: string | null
  prompt: string
  sampleVideoUrl?: string
  sampleVideoName?: string
  aspectRatio: DirectorAspectRatio
  durationSec?: number
  materials: V2DirectorMaterial[]
  plannerMode?: 'deterministic' | 'llm'
}

interface PreparedAsset {
  url: string
  remotionSrc: string
  publicUrl?: string
  localPath?: string
}

function canvasForAspectRatio(aspectRatio: DirectorAspectRatio) {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080, fps: 30 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080, fps: 30 }
  if (aspectRatio === '4:3') return { width: 1440, height: 1080, fps: 30 }
  return { width: 1080, height: 1920, fps: 30 }
}

function absoluteResultUrl(url: string | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `${env.apiBase}${url.startsWith('/') ? '' : '/'}${url}`
}

function outputTaskId(prefix: string, existing?: string | null): string {
  if (existing?.startsWith('v2_')) return existing
  return `v2_${prefix}_${Date.now()}`
}

async function uploadBrowserUrl(input: {
  url: string
  filename: string
  requirePublicUrl?: boolean
}): Promise<api.UploadResult> {
  const response = await fetch(input.url)
  const blob = await response.blob()
  const file = new File([blob], input.filename, {
    type: blob.type || 'application/octet-stream',
  })
  return api.uploadFile(file, { requirePublicUrl: input.requirePublicUrl })
}

async function prepareAsset(input: {
  url: string
  filename: string
  requirePublicUrl?: boolean
}): Promise<PreparedAsset> {
  const rawUrl = input.url.trim()
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    const uploaded = await uploadBrowserUrl({
      url: rawUrl,
      filename: input.filename,
      requirePublicUrl: input.requirePublicUrl,
    })
    return {
      url: uploaded.localUrl ?? uploaded.url,
      remotionSrc: uploaded.localPath ?? uploaded.localUrl ?? uploaded.url,
      publicUrl: uploaded.publicUrl,
      localPath: uploaded.localPath,
    }
  }

  const access = classifyExternalUrlAccess(rawUrl)
  return {
    url: rawUrl,
    remotionSrc: rawUrl,
    publicUrl: access.ok ? access.normalizedUrl ?? rawUrl : undefined,
  }
}

function firstMaterial(
  materials: V2DirectorMaterial[],
  type: V2DirectorMaterial['type'],
): V2DirectorMaterial | undefined {
  return materials.find((material) => material.type === type)
}

function sceneRole(scene: RemotionTimelineScene): string {
  if (scene.visual_role) return scene.visual_role
  if (scene.type === 'user_video') return 'user_video'
  if (scene.type === 'ai_video') return 'ai_video'
  if (scene.type === 'image_motion') return 'image_motion'
  return 'remotion_scene'
}

function sceneTitle(scene: RemotionTimelineScene): string {
  return scene.title ?? scene.subtitle ?? scene.note ?? scene.id
}

function specToOutline(spec: RemotionTimelineSpecV1): OutlineSegment[] {
  return spec.scenes
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((scene, index) => ({
      id: `v2-outline-${index + 1}`,
      anchor_id: scene.id,
      title: sceneTitle(scene),
      marketing_role: sceneRole(scene),
      creative_role: sceneRole(scene),
      start_sec: scene.start_sec,
      end_sec: scene.start_sec + scene.duration_sec,
    }))
}

function transitionToLegacy(
  transition: RemotionTimelineTransition,
  sceneById: Map<string, RemotionTimelineScene>,
): TimelineTransition {
  const from = sceneById.get(transition.from_scene_id)
  return {
    id: transition.id,
    from_anchor_id: transition.from_scene_id,
    to_anchor_id: transition.to_scene_id,
    at_sec: from ? from.start_sec + from.duration_sec : 0,
    presentation: transition.type === 'light_flash' ? 'fade' : transition.type,
    duration_sec: transition.duration_sec,
    timing: { type: 'linear' },
    direction: transition.direction,
    overlay:
      transition.type === 'light_flash'
        ? { type: 'flash', duration_sec: transition.duration_sec }
        : undefined,
    reason: 'V2 RemotionTimeline transition adapter.',
  }
}

function specToProject(input: {
  spec: RemotionTimelineSpecV1
  sourceUrl: string
  generatedUrl?: string
}): MigrationProtocolV12 {
  const sceneById = new Map(input.spec.scenes.map((scene) => [scene.id, scene]))
  return {
    version: '1.2',
    metadata: {
      video_id: input.spec.task_id,
      duration_sec: input.spec.canvas.duration_sec,
    },
    source_video: {
      url: input.sourceUrl,
      duration: input.spec.canvas.duration_sec,
    },
    generated_video: {
      url: input.generatedUrl ?? '',
      duration: input.spec.canvas.duration_sec,
    },
    semantic_anchors: input.spec.scenes.map((scene) => {
      const asset = scene.asset_id
        ? input.spec.assets.find((candidate) => candidate.id === scene.asset_id)
        : undefined
      return {
        anchor_id: scene.id,
        start_sec: scene.start_sec,
        end_sec: scene.start_sec + scene.duration_sec,
        sequence: {
          from_sec: scene.start_sec,
          duration_sec: scene.duration_sec,
          layout: 'fill',
          premount_sec: 0,
        },
        logic_intent: {
          marketing_role: sceneRole(scene),
          emotion_vibe: scene.type,
        },
        match: {
          status: asset ? 'matched' : 'pending',
          asset_name: asset?.label ?? asset?.id ?? null,
          asset_id: scene.asset_id,
        },
        replication_instructions: {
          visual_generation_prompt: [scene.type, scene.title, scene.subtitle, scene.note]
            .filter(Boolean)
            .join(' / '),
          overlay_rewrite_instruction:
            input.spec.overlays
              .filter((overlay) => overlay.scene_id === scene.id && overlay.text)
              .map((overlay) => overlay.text)
              .join(' / ') || scene.body || '',
          visual_motion: {
            preset:
              scene.motion === 'slow_zoom_in'
                ? 'zoom_in'
                : scene.motion === 'pan_left' || scene.motion === 'pan_right'
                  ? 'pan'
                  : 'static',
            intensity: scene.motion && scene.motion !== 'none' ? 0.55 : 0.2,
            driver: 'useCurrentFrame',
          },
        },
      }
    }),
    transitions: input.spec.transitions.map((transition) =>
      transitionToLegacy(transition, sceneById),
    ),
    director_grounding: {
      schema_version: 'v2_timeline_adapter.v1',
      source: 'remotion_timeline_spec',
      review: useV2TimelineStore.getState().preview?.review,
    },
  }
}

function specToTimeline(spec: RemotionTimelineSpecV1): TimelineProject {
  return {
    duration_sec: spec.canvas.duration_sec,
    tracks: [
      { id: 'video', label: 'V2 画面轨', sublabel: '用户素材 / AI 视频 / Remotion 场景' },
      { id: 'overlay', label: 'V2 覆盖层', sublabel: '字幕 / 标题 / 标签 / 光效' },
      { id: 'effect', label: 'V2 转场轨', sublabel: 'cut / fade / slide / wipe / light_flash' },
      { id: 'audio', label: 'V2 音频轨', sublabel: '音频素材与后续混音' },
    ],
    clips: [
      ...spec.scenes.map((scene) => ({
        id: `v2-scene-${scene.id}`,
        track_id: 'video' as const,
        start_sec: scene.start_sec,
        end_sec: scene.start_sec + scene.duration_sec,
        label: `${scene.type}: ${sceneTitle(scene)}`,
        anchor_id: scene.id,
        visual_generation_prompt: scene.note ?? scene.title,
        content_rewrite_instruction: scene.subtitle ?? scene.body,
      })),
      ...spec.overlays.map((overlay) => ({
        id: `v2-overlay-${overlay.id}`,
        track_id: 'overlay' as const,
        start_sec: overlay.start_sec,
        end_sec: overlay.end_sec,
        label: `${overlay.type}: ${overlay.text ?? overlay.asset_id ?? overlay.id}`,
        anchor_id: overlay.scene_id,
        content_rewrite_instruction: overlay.text,
      })),
      ...spec.transitions.map((transition) => {
        const from = spec.scenes.find((scene) => scene.id === transition.from_scene_id)
        const at = from ? from.start_sec + from.duration_sec - transition.duration_sec : 0
        return {
          id: `v2-transition-${transition.id}`,
          track_id: 'effect' as const,
          start_sec: Math.max(0, at),
          end_sec: Math.max(0, at) + transition.duration_sec,
          label: transition.type,
          anchor_id: transition.from_scene_id,
        }
      }),
    ],
  }
}

function specMaterials(spec: RemotionTimelineSpecV1): UserMaterialDto[] {
  return spec.assets.map((asset) => ({
    id: asset.id,
    material_type:
      asset.type === 'video' ? 'VIDEO' : asset.type === 'audio' ? 'AUDIO' : 'IMAGE',
    oss_url: asset.src,
    label: asset.label ?? asset.id,
    ai_tags: [asset.source, asset.type],
    status: 'READY',
  }))
}

function syncWorkbench(input: {
  spec: RemotionTimelineSpecV1
  sourceUrl: string
  generatedUrl?: string
  taskStatus?: PipelineBundle['task_status']
}) {
  const project = specToProject(input)
  const timeline = specToTimeline(input.spec)
  const outline = specToOutline(input.spec)
  const bundle: PipelineBundle = {
    task_id: input.spec.task_id,
    task_status: input.taskStatus ?? 'WAITING_USER_EDIT',
    ingest: {
      video_id: input.spec.task_id,
      sample_video_url: input.sourceUrl,
      duration_sec: input.spec.canvas.duration_sec,
      format: 'v2-remotion-timeline',
      width: input.spec.canvas.width,
      height: input.spec.canvas.height,
    },
    structure: project,
    timeline,
    materials: specMaterials(input.spec),
    outline,
    generation: input.generatedUrl
      ? {
          final_video_url: input.generatedUrl,
          duration_sec: input.spec.canvas.duration_sec,
          generated_at: new Date().toISOString(),
          codec: 'h264',
        }
      : undefined,
  }

  usePipelineStore.getState().hydrate(bundle)
  useMigrationProjectStore.getState().setProject(project)
  useTimelineStore.getState().setProject(timeline)
  usePlaybackStore.getState().setDuration(input.spec.canvas.duration_sec)
  useRenderPlanStore.getState().setPlan(null)
  useCreationStore.getState().setSampleParsed(true)
  useEditorStore.getState().setGenerationEditEnabled(true)
  if (input.generatedUrl) {
    useEditorStore.getState().setTimelineMode('generation')
  }
}

async function buildPayload(
  input: V2DirectorTimelineInput,
  taskId: string,
): Promise<api.V2TimelinePayload & { sourceUrl: string }> {
  const sample = input.sampleVideoUrl?.trim()
    ? await prepareAsset({
        url: input.sampleVideoUrl,
        filename: input.sampleVideoName ?? 'sample-video.mp4',
      })
    : undefined
  const mainVideo = firstMaterial(input.materials, 'video')
  const mainVideoAsset = mainVideo
    ? await prepareAsset({ url: mainVideo.url, filename: mainVideo.name })
    : undefined
  const image = firstMaterial(input.materials, 'image')
  const imageAsset = image
    ? await prepareAsset({
        url: image.url,
        filename: image.name,
      })
    : undefined

  return {
    taskId,
    prompt: input.prompt.trim() || '按当前素材生成一版 V2 Timeline 方案。',
    mainVideoPath: mainVideoAsset?.remotionSrc,
    referenceVideoPath: sample?.remotionSrc,
    imageSrc: imageAsset?.localPath ?? imageAsset?.remotionSrc,
    inputImageUrl: imageAsset?.publicUrl,
    plannerMode: input.plannerMode ?? 'llm',
    allowPlannerFallback: true,
    durationSec: input.durationSec,
    canvas: canvasForAspectRatio(input.aspectRatio),
    sourceUrl: mainVideoAsset?.url ?? imageAsset?.url ?? sample?.url ?? '',
  }
}

export async function previewV2DirectorTimeline(
  input: V2DirectorTimelineInput,
): Promise<api.V2TimelinePreviewResult> {
  const taskId = outputTaskId('preview', input.taskId)
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || 'V2 Timeline preview', taskId)
  taskStore.updateProgress(12, '准备 V2 素材', '[V2] 正在解析本地素材地址。')
  const payload = await buildPayload(input, taskId)
  const { sourceUrl, ...requestPayload } = payload
  taskStore.updateProgress(36, '生成 V2 Timeline', '[V2] 调用 timeline preview。')
  const preview = await api.previewV2Timeline(requestPayload)
  useV2TimelineStore.getState().setPreview(preview, input.prompt)
  syncWorkbench({
    spec: preview.spec,
    sourceUrl,
    taskStatus: 'WAITING_USER_EDIT',
  })
  taskStore.updateProgress(
    100,
    'V2 方案已生成',
    `[V2] trace 已写入 ${preview.traceDir}`,
  )
  taskStore.setBackendReady(true)
  taskStore.setComplete(true)
  return preview
}

export async function renderV2DirectorTimeline(
  input: V2DirectorTimelineInput,
): Promise<api.V2TimelineRunResult> {
  const current = useV2TimelineStore.getState()
  const preferredTaskId = current.taskId ?? input.taskId
  const taskId = outputTaskId('run', preferredTaskId)
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || 'V2 Timeline render', taskId)
  taskStore.updateProgress(10, '准备 V2 渲染', '[V2] 正在准备素材和 timeline spec。')
  const payload = await buildPayload(input, taskId)
  const { sourceUrl, ...requestPayload } = payload
  taskStore.updateProgress(30, '生成与校验素材', '[V2] 调用素材补全、标准化和 Remotion 渲染。')
  const result = await api.runV2Timeline({
    ...requestPayload,
    timelineSpecOverride: current.spec && current.taskId === taskId ? current.spec : undefined,
  })
  const generatedUrl = absoluteResultUrl(result.outputUrl)
  useV2TimelineStore.getState().setResult(result, input.prompt)
  syncWorkbench({
    spec: result.spec,
    sourceUrl,
    generatedUrl,
    taskStatus: 'COMPLETED',
  })
  taskStore.updateProgress(
    100,
    'V2 渲染完成',
    `[V2] 输出 ${generatedUrl || result.outputPath}；trace ${result.traceDir}`,
  )
  taskStore.setBackendReady(true)
  taskStore.setComplete(true)
  return result
}

export function v2MaterialsFromAttachments(
  attachments: InputAttachment[],
): V2DirectorMaterial[] {
  return attachments.map((attachment) => ({
    id: attachment.materialId ?? attachment.id.replace(/^att_/, ''),
    name: attachment.name,
    type: attachment.type,
    url: attachment.url,
    tags: attachment.tags,
  }))
}
