import { env } from '@/config/env'
import * as api from '@/lib/api'
import {
  ANALYSIS_MAX_POLLS,
  ANALYSIS_POLL_MS,
  isAnalysisStructureReady,
} from '@/services/pipeline/analysisPolling'
import {
  createAnalysisCacheKey,
  getCachedAnalysisTask,
  isBundleUsableForAnalysisCache,
  putCachedAnalysisTask,
  removeCachedAnalysisTask,
} from '@/services/pipeline/analysisCache'
import { restoreTaskContext } from '@/services/pipeline/restoreTask'
import { ensurePublicUrl } from '@/services/pipeline/uploadAssets'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useTaskStore } from '@/stores/taskStore'
import type { UserMaterialDto } from '@/types/pipeline'
import { analyzeAssetHeuristically } from '@shared/lib/asset-analysis-heuristic'
import { parseDirectorIntent } from '@shared/lib/director-understanding'
import type { AssetAnalysisV1 } from '@shared/types/asset-analysis.v1'
import type { DirectorAspectRatio } from '@shared/types/director-context'
import type { ParsedCreativeIntent } from '@shared/types/template-schema.v1'

function isBackendUnreachable(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('network')
}

export interface RunPipelineAnalysisInput {
  sampleVideoUrl: string
  sampleVideoName?: string
  globalPrompt?: string
  aspectRatio?: DirectorAspectRatio
  durationSec?: number
  styleIntensity?: 'light' | 'medium' | 'strong'
  materials?: Array<{
    id: string
    name: string
    type: 'video' | 'image' | 'audio'
    url: string
    tags?: string[]
    analysis?: AssetAnalysisV1
  }>
}

function toMaterialDto(
  item: NonNullable<RunPipelineAnalysisInput['materials']>[number],
  ossUrl: string,
): UserMaterialDto {
  const typeMap = {
    video: 'VIDEO',
    image: 'IMAGE',
    audio: 'AUDIO',
  } as const

  return {
    id: item.id,
    material_type: typeMap[item.type],
    oss_url: ossUrl,
    label: item.name,
    ai_tags: item.tags,
    asset_analysis:
      item.analysis ??
      analyzeAssetHeuristically({
        id: item.id,
        type: item.type,
        name: item.name,
        url: ossUrl,
        tags: item.tags,
      }),
    status: 'READY',
  }
}

function inferCreativeIntent(rawText: string): ParsedCreativeIntent {
  const text = rawText.trim()
  const lower = text.toLowerCase()

  const goal =
    /复刻|仿照|照着|同款/.test(text)
      ? 'replicate_structure'
      : /广告|投放|卖点|产品/.test(text)
        ? 'product_ad'
        : text
          ? 'generate_variant'
          : 'replicate_structure'

  const styleKeywords = [
    ['高级', 'premium'],
    ['科技', 'tech'],
    ['温暖', 'warm'],
    ['快节奏', 'fast_paced'],
    ['口播', 'talking_head'],
    ['种草', 'recommendation'],
    ['风景', 'landscape'],
    ['混剪', 'montage'],
  ]
    .filter(([zh, en]) => text.includes(zh) || lower.includes(en))
    .map(([zh]) => zh)

  return {
    raw_text: text,
    goal,
    product_or_topic: text || undefined,
    target_audience: undefined,
    style_keywords: styleKeywords,
    must_keep: ['样例视频的结构节奏', '关键视觉爆点位置', '镜头意图'],
    must_change: ['主体素材', '字幕/花字文案', '生成主题'],
    generation_directive:
      text || '保持样例视频的结构与节奏，替换为用户参考素材和新主题。',
  }
}

export async function runPipelineAnalysis(
  input: RunPipelineAnalysisInput,
): Promise<void> {
  const { hydrate } = usePipelineStore.getState()
  const {
    setBackendReady,
    setBootstrapError,
    setActiveTaskId,
    startTask,
    addLog,
    setComplete,
    setFailed,
  } = useTaskStore.getState()

  const sampleUrl = input.sampleVideoUrl.trim()
  if (!sampleUrl) {
    throw new Error('请先上传样例视频。')
  }

  if (!env.useBackend) {
    throw new Error('请开启 VITE_USE_BACKEND=true 并启动 backend 后再解析。')
  }

  let analysisCacheKey: string | null = null

  try {
    setBootstrapError(null)
    await api.healthCheck()
    addLog('[Analysis] 后端已连接，开始准备样例和素材。')

    try {
      analysisCacheKey = await createAnalysisCacheKey(input)
      const cached = getCachedAnalysisTask(analysisCacheKey)
      if (cached) {
        const bundle = await api.getTaskPipeline(cached.taskId).catch(() => null)
        if (bundle && isBundleUsableForAnalysisCache(bundle)) {
          hydrate(bundle)
          setActiveTaskId(bundle.task_id)
          setBackendReady(true)
          startTask(input.globalPrompt?.trim() || 'Analyze sample video', bundle.task_id)
          addLog(`[Analysis] Reused cached analysis task ${bundle.task_id}.`)
          setComplete(true)
          return
        }
        removeCachedAnalysisTask(analysisCacheKey)
      }
    } catch (cacheError) {
      const message = cacheError instanceof Error ? cacheError.message : String(cacheError)
      addLog(`[Analysis] Cache skipped: ${message}`)
      analysisCacheKey = null
    }

    const videoUrl = await ensurePublicUrl(
      sampleUrl,
      input.sampleVideoName ?? 'sample-video.mp4',
    )

    const materials: UserMaterialDto[] = []
    for (const item of input.materials ?? []) {
      const ossUrl = await ensurePublicUrl(item.url, item.name)
      materials.push(toMaterialDto(item, ossUrl))
    }

    addLog('[Analysis] 提交样例理解任务。')
    const referenceMaterials = materials.map((item) => ({
      id: item.id,
      name: item.label,
      type: item.material_type.toLowerCase() as 'video' | 'image' | 'audio',
      url: item.oss_url,
      tags: item.ai_tags,
    }))
    const creativeIntent = inferCreativeIntent(input.globalPrompt ?? '')
    const parsedDirectorIntent = parseDirectorIntent(input.globalPrompt ?? '')
    const directorIntent = {
      ...parsedDirectorIntent,
      aspectRatio:
        input.aspectRatio ?? parsedDirectorIntent.aspectRatio ?? '9:16',
      durationSec: input.durationSec ?? parsedDirectorIntent.durationSec,
      styleIntensity: input.styleIntensity ?? 'medium',
    }
    const { taskId } = await api.createAnalyzeTask({
      videoUrl,
      sampleVideo: {
        id: 'sample_video',
        name: input.sampleVideoName ?? 'sample-video.mp4',
        url: videoUrl,
      },
      referenceMaterials: referenceMaterials.length
        ? referenceMaterials
        : undefined,
      creativeIntent,
      directorIntent,
      globalPrompt: input.globalPrompt?.trim() || undefined,
      materials: materials.length ? materials : undefined,
    })
    setActiveTaskId(taskId)
    startTask(input.globalPrompt?.trim() || '解析样例视频', taskId)
    addLog(`[Analysis] 分析任务 ${taskId}`)

    for (let i = 0; i < ANALYSIS_MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, ANALYSIS_POLL_MS))

      const task = await api.getTask(taskId)
      addLog(`[Analysis] 当前状态: ${task.taskStatus}`)

      if (isAnalysisStructureReady(task)) {
        const bundle = await api.getTaskPipeline(taskId)
        hydrate(bundle)
        setBackendReady(true)
        if (analysisCacheKey) {
          putCachedAnalysisTask({
            key: analysisCacheKey,
            taskId,
            source: input,
          })
        }
        addLog('[Analysis] 样例结构已生成并写入时间线。')
        setComplete(true)
        return
      }

      if (task.taskStatus === 'FAILED') {
        const message = '分析任务失败，请检查 analyzer.worker 日志。'
        setFailed(message)
        throw new Error(message)
      }

      if (task.taskStatus === 'CANCELLED' || task.taskStatus === 'CANCELLING') {
        useTaskStore.getState().setCancelled()
        return
      }
    }

    addLog('[Analysis] 轮询超时，尝试从服务端恢复已完成任务…')
    const restored = await restoreTaskContext(taskId)
    if (restored) {
      if (analysisCacheKey) {
        putCachedAnalysisTask({
          key: analysisCacheKey,
          taskId,
          source: input,
        })
      }
      setComplete(true)
      addLog('[Analysis] 已从服务端恢复样例结构。')
      return
    }

    const message =
      '等待 structureJson 超时。若 worker 仍在生成 Seed 插件，请稍后刷新页面或确认 worker:analyzer 已启动。'
    setFailed(message)
    throw new Error(message)
  } catch (e) {
    if (isBackendUnreachable(e)) {
      const msg = `后端 ${env.apiBase} 未连接，请启动 backend 后重试。`
      setBootstrapError(msg)
      addLog(`[Analysis] ${msg}`)
      throw new Error(msg)
    }

    const msg = e instanceof Error ? e.message : String(e)
    setBootstrapError(msg)
    addLog(`[Analysis] 解析失败: ${msg}`)
    throw e
  }
}
