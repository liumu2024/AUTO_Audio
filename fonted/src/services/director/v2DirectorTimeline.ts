import { classifyExternalUrlAccess } from '@shared/lib/external-url-access'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'
import type { V2SampleUnderstandingResult } from '@shared/types/v2-sample-understanding'
import { buildV2TimelineRequestShape } from '@shared/lib/v2-timeline-request-shape'

import * as api from '@/lib/api'
import { env } from '@/config/env'
import type { InputAttachment } from '@/stores/creationStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useTaskStore } from '@/stores/taskStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { DirectorAspectRatio } from '@shared/types/director-context'

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
  planningContext?: api.V2TimelinePayload['planningContext']
}

interface PreparedAsset {
  url: string
  remotionSrc: string
  publicUrl?: string
  localPath?: string
}

interface PreparedDirectorMaterial extends V2DirectorMaterial {
  prepared: PreparedAsset
}

type BuildPayloadResult = api.V2TimelinePayload & {
  sourceUrl: string
  preparedMaterials: PreparedDirectorMaterial[]
}

function canvasForAspectRatio(aspectRatio: DirectorAspectRatio) {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080, fps: 30 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080, fps: 30 }
  if (aspectRatio === '4:3') return { width: 1440, height: 1080, fps: 30 }
  return { width: 1080, height: 1920, fps: 30 }
}

function absoluteResultUrl(url: string | undefined): string {
  if (!url) return ''
  if (/^(blob:|data:)/i.test(url)) return url
  if (/^https?:\/\//i.test(url)) return url
  return `${env.apiBase}${url.startsWith('/') ? '' : '/'}${url}`
}

function browserAssetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (/^(blob:|data:|https?:\/\/)/i.test(url)) return url
  if (url.startsWith('/')) return absoluteResultUrl(url)
  return undefined
}

function outputTaskId(prefix: string, existing?: string | null): string {
  if (existing?.startsWith(`v2_${prefix}_`)) return existing
  if (prefix === 'run' && existing?.startsWith('v2_preview_')) return existing
  return `v2_${prefix}_${Date.now()}`
}

async function uploadBrowserUrl(input: {
  url: string
  filename: string
  requirePublicUrl?: boolean
}): Promise<api.UploadResult> {
  let response: Response
  try {
    response = await fetch(input.url)
  } catch (error) {
    throw new Error(
      `无法读取本地上传素材，请重新选择该文件后再试。原始错误：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (!response.ok) {
    throw new Error(`无法读取本地上传素材，请重新选择该文件后再试。HTTP ${response.status}`)
  }
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

async function prepareMaterials(materials: V2DirectorMaterial[]): Promise<PreparedDirectorMaterial[]> {
  return Promise.all(
    materials.map(async (material) => ({
      ...material,
      prepared: await prepareAsset({
        url: material.url,
        filename: material.name,
        requirePublicUrl: false,
      }),
    })),
  )
}

function syncV2TimelineWorkspace(input: {
  spec: RemotionTimelineSpecV1
}) {
  // V2 preview/run has a single source of truth: useV2TimelineStore.spec.
  // This only aligns shared playback/editor chrome and must not write V1 stores.
  usePlaybackStore.getState().setDuration(input.spec.canvas.duration_sec)
  useEditorStore.getState().setGenerationEditEnabled(true)
  useEditorStore.getState().setTimelineMode('generation')
}

function syncSampleWorkbench(input: {
  taskId: string
  sourceUrl: string
  understanding: V2SampleUnderstandingResult
  traceDir: string
  prompt: string
}) {
  useV2TimelineStore.getState().setSampleSession({
    result: {
      taskId: input.taskId,
      understanding: input.understanding,
      traceDir: input.traceDir,
    },
    prompt: input.prompt,
    playbackUrl: input.sourceUrl,
    sampleName: input.understanding.sample.name,
  })
  usePlaybackStore.getState().setDuration(input.understanding.sample.duration_sec)
  useEditorStore.getState().setTimelineMode('sample')
  useEditorStore.getState().setGenerationEditEnabled(false)
}

async function buildPayload(
  input: V2DirectorTimelineInput,
  taskId: string,
): Promise<BuildPayloadResult> {
  const sample = input.sampleVideoUrl?.trim()
    ? await prepareAsset({
        url: input.sampleVideoUrl,
        filename: input.sampleVideoName ?? 'sample-video.mp4',
      })
    : undefined
  const preparedMaterials = await prepareMaterials(input.materials)
  const materials = preparedMaterials.map((material) => ({
    id: material.id,
    name: material.name,
    type: material.type,
    src: material.prepared.localPath ?? material.prepared.remotionSrc,
    publicUrl: material.prepared.publicUrl,
    tags: material.tags,
  }))
  const requestShape = buildV2TimelineRequestShape({
    sampleVideoPath: sample?.remotionSrc,
    materials,
  })

  return {
    taskId,
    prompt: input.prompt.trim() || '按当前素材生成一版 V2 Timeline 方案。',
    ...requestShape,
    sampleUnderstanding: sample
      ? useV2TimelineStore.getState().sampleSession?.understanding ?? undefined
      : undefined,
    planningContext: input.planningContext,
    plannerMode: input.plannerMode ?? 'llm',
    allowPlannerFallback: true,
    durationSec: input.durationSec,
    canvas: canvasForAspectRatio(input.aspectRatio),
    sourceUrl:
      preparedMaterials.find((material) => material.type === 'video')?.prepared.url ??
      preparedMaterials.find((material) => material.type === 'image')?.prepared.url ??
      sample?.url ??
      '',
    preparedMaterials,
  }
}

function buildPreviewAssetUrls(
  spec: RemotionTimelineSpecV1,
  preparedMaterials: PreparedDirectorMaterial[],
): Record<string, string> {
  const urls: Record<string, string> = {}
  for (const asset of spec.assets) {
    const material = preparedMaterials.find((item) => {
      const prepared = item.prepared
      return (
        asset.src === prepared.localPath ||
        asset.src === prepared.remotionSrc ||
        asset.src === prepared.publicUrl ||
        asset.label === item.name ||
        asset.id.includes(item.id)
      )
    })
    const url =
      browserAssetUrl(material?.url) ??
      browserAssetUrl(material?.prepared.url) ??
      browserAssetUrl(asset.src)
    if (url) urls[asset.id] = url
  }
  return urls
}

export async function analyzeV2DirectorSample(
  input: V2DirectorTimelineInput,
): Promise<api.V2SampleAnalyzeResult> {
  useEditorStore.getState().enterV2Workspace()
  const taskId = outputTaskId('sample', input.taskId)
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || 'V2 Sample Understanding', taskId)
  taskStore.updateProgress(12, '准备样例视频', '[V2] 正在解析本地样例地址。')
  if (!input.sampleVideoUrl?.trim()) {
    throw new Error('请先上传 1 个样例视频。')
  }

  const sample = await prepareAsset({
    url: input.sampleVideoUrl,
    filename: input.sampleVideoName ?? 'sample-video.mp4',
  })
  taskStore.updateProgress(36, '理解样例视频', '[V2] 正在拆解样例内容、节奏和镜头结构。')
  const result = await api.analyzeV2Sample({
    taskId,
    prompt: input.prompt.trim() || '解析样例视频，提取结构、节奏、镜头、转场和可复用风格。',
    sampleVideoPath: sample.localPath ?? sample.remotionSrc,
    sampleVideoName: input.sampleVideoName,
  })
  syncSampleWorkbench({
    taskId,
    sourceUrl: absoluteResultUrl(sample.url),
    understanding: result.understanding,
    traceDir: result.traceDir,
    prompt: input.prompt,
  })
  taskStore.updateProgress(
    100,
    '样例理解完成',
    `[V2] 样例理解 trace 已写入 ${result.traceDir}`,
  )
  taskStore.setBackendReady(true)
  taskStore.setComplete(true)
  return result
}

export async function previewV2DirectorTimeline(
  input: V2DirectorTimelineInput,
): Promise<api.V2TimelineDraftPreviewResult> {
  useEditorStore.getState().enterV2Workspace()
  const taskId = outputTaskId('preview', input.taskId)
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || 'V2 Timeline preview', taskId)
  taskStore.updateProgress(12, '准备 V2 素材', '[V2] 正在解析本地素材地址。')
  if (useV2TimelineStore.getState().hasLocalEdits) {
    await saveV2DirectorTimelineDraft()
  }
  const payload = await buildPayload(input, taskId)
  const { preparedMaterials, ...requestPayload } = payload
  taskStore.updateProgress(36, '生成 V2 Timeline', '[V2] 调用 timeline preview。')
  const current = useV2TimelineStore.getState()
  const planningContext = payload.planningContext ?? {
    kind: current.draftId ? 'revision' as const : 'initial' as const,
    draftId: current.draftId ?? undefined,
    baseRevision: current.draftRevision ?? undefined,
  }
  const preview = await api.previewV2TimelineDraft({
    ...requestPayload,
    planningContext,
    ...(current.draftId && current.draftRevision
      ? { draftId: current.draftId, baseRevision: current.draftRevision }
      : {}),
  })
  const previewAssetUrls = buildPreviewAssetUrls(preview.spec, preparedMaterials)
  useV2TimelineStore.getState().setPreview(preview, input.prompt, previewAssetUrls)
  syncV2TimelineWorkspace({ spec: preview.spec })
  taskStore.updateProgress(
    100,
    'V2 方案已生成',
    `[V2] trace 已写入 ${preview.traceDir}`,
  )
  taskStore.setBackendReady(true)
  taskStore.setComplete(true)
  return preview
}

export async function saveV2DirectorTimelineDraft(): Promise<api.V2TimelineDraftDto> {
  const current = useV2TimelineStore.getState()
  if (!current.draftId || !current.draftRevision || !current.spec) {
    throw new Error('当前没有可保存的 V2 Timeline 草稿。')
  }
  if (!current.hasLocalEdits) {
    return {
      draftId: current.draftId,
      revision: current.draftRevision,
      spec: current.spec,
      plannerSource: current.preview?.plannerSource,
      review: current.preview?.review,
      traceDir: current.traceDir ?? undefined,
      createdAt: '',
      updatedAt: '',
    }
  }
  const saved = await api.saveV2TimelineDraft({
    draftId: current.draftId,
    baseRevision: current.draftRevision,
    spec: current.spec,
  })
  useV2TimelineStore.getState().setPersistedDraft(saved.draft)
  return saved.draft
}

export async function renderV2DirectorTimeline(
  input: V2DirectorTimelineInput,
  confirmedDraft?: { draftId: string; revision: number },
): Promise<api.V2TimelineDraftRunResult> {
  useEditorStore.getState().enterV2Workspace()
  if (confirmedDraft) {
    const confirmedState = useV2TimelineStore.getState()
    if (
      confirmedState.draftId !== confirmedDraft.draftId
      || confirmedState.draftRevision !== confirmedDraft.revision
      || confirmedState.hasLocalEdits
    ) throw new Error('当前草稿已在确认后发生变化，请重新执行导出预飞检查。')
  } else if (useV2TimelineStore.getState().hasLocalEdits) {
    await saveV2DirectorTimelineDraft()
  }
  const current = useV2TimelineStore.getState()
  if (!current.draftId || !current.draftRevision || !current.spec) {
    throw new Error('请先生成并保存 V2 Timeline 草稿。')
  }
  if (confirmedDraft && (
    current.draftId !== confirmedDraft.draftId
    || current.draftRevision !== confirmedDraft.revision
  )) throw new Error('当前草稿版本与已确认版本不一致。')
  const taskStore = useTaskStore.getState()
  taskStore.startTask(input.prompt || 'V2 Timeline render', current.draftId)
  taskStore.updateProgress(10, '准备 V2 渲染', '[V2] 正在准备素材和 timeline spec。')
  taskStore.updateProgress(30, '生成与校验素材', '[V2] 调用素材补全、标准化和 Remotion 渲染。')
  const result = await api.runV2TimelineDraft({
    draftId: current.draftId,
    revision: current.draftRevision,
  })
  const generatedUrl = absoluteResultUrl(result.outputUrl)
  useV2TimelineStore.getState().setResult(result, input.prompt)
  syncV2TimelineWorkspace({ spec: current.spec })
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
