import { analyzeAssetHeuristically } from '../../../../shared/lib/asset-analysis-heuristic.js'
import {
  buildOutlineFromStructure,
  buildTimelineFromStructure,
} from '../../../../shared/lib/pipeline-builder.js'
import { buildRenderPlanFromStructure } from '../../../../shared/lib/render-plan-builder.js'
import {
  buildMaterialAnalysis,
  buildSampleStyleRecipeFromMigration,
  createDefaultDirectorSlots,
} from '../../../../shared/lib/director-understanding.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { PipelineBundle, UserMaterialDto } from '../../../../shared/types/pipeline.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import { prisma } from '../../shared/prisma.service.js'

function isNonRenderablePlaceholderUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'example.com' || hostname.endsWith('.example.com')
  } catch {
    return false
  }
}

async function readPersistedRenderPlan(
  taskId: string,
): Promise<RenderPlanV1 | null> {
  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { renderPlanJson: true },
  })
  const value = task?.renderPlanJson
  return value && typeof value === 'object'
    ? (value as unknown as RenderPlanV1)
    : null
}

export async function getPipelineBundle(
  taskId: string,
): Promise<PipelineBundle | null> {
  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    include: { user: { include: { materials: true } } },
  })

  if (!task) return null

  const structure = task.structureJson as MigrationProtocolV12 | null

  if (!structure) {
    return null
  }

  const structureForClient: MigrationProtocolV12 = {
    ...structure,
    generated_video: task.finalVideoUrl
      ? {
          url: task.finalVideoUrl,
          duration: structure.metadata.duration_sec,
        }
      : structure.generated_video?.url &&
          structure.generated_video.url !== task.sampleVideoUrl
        ? structure.generated_video
        : { url: '', duration: structure.metadata.duration_sec },
  }

  const materials: UserMaterialDto[] = task.user.materials
    .map((m) => ({
      id: m.id,
      material_type: m.materialType as 'VIDEO' | 'IMAGE' | 'AUDIO',
      oss_url: m.ossUrl,
      label: m.label || m.id,
      ai_tags: (m.aiTags as string[] | null) ?? undefined,
      asset_analysis: analyzeAssetHeuristically({
        id: m.id,
        type: m.materialType as 'VIDEO' | 'IMAGE' | 'AUDIO',
        name: m.label || m.id,
        url: m.ossUrl,
        tags: (m.aiTags as string[] | null) ?? undefined,
      }),
      status: m.status as 'READY' | 'PROCESSING' | 'FAILED',
    }))
    .filter((m) => !isNonRenderablePlaceholderUrl(m.oss_url))

  const derivedRenderPlan = buildRenderPlanFromStructure({
    taskId: task.id,
    structure: structureForClient,
    materials,
    sampleReference: {
      id: structure.metadata.video_id,
      name: 'sample video audio reference',
      url: task.sampleVideoUrl,
      duration_sec: structure.metadata.duration_sec,
    },
  })
  const persistedRenderPlan = await readPersistedRenderPlan(task.id)
  const renderPlan = {
    ...(persistedRenderPlan ?? derivedRenderPlan),
    plan_revision: (persistedRenderPlan ?? derivedRenderPlan).plan_revision ?? 1,
    updated_at:
      (persistedRenderPlan ?? derivedRenderPlan).updated_at ??
      new Date().toISOString(),
  }

  return {
    task_id: task.id,
    task_status: task.taskStatus,
    ingest: {
      video_id: structure.metadata.video_id,
      sample_video_url: task.sampleVideoUrl,
      duration_sec: structure.metadata.duration_sec,
      format: 'mp4',
      width: 1920,
      height: 1080,
    },
    structure: structureForClient,
    timeline: buildTimelineFromStructure(structure),
    materials,
    outline: buildOutlineFromStructure(structure),
    render_plan: renderPlan,
    director_context: {
      sampleVideo: {
        id: structure.metadata.video_id,
        url: task.sampleVideoUrl,
        styleRecipe: buildSampleStyleRecipeFromMigration(structureForClient),
      },
      slots: createDefaultDirectorSlots({
        sampleVideoStatus: 'parsed',
        materialStatus: materials.some(
          (m) => m.material_type === 'VIDEO' || m.material_type === 'IMAGE',
        )
          ? 'ready'
          : 'missing',
        aspectRatio: renderPlan.canvas.ratio,
        durationSec: renderPlan.duration_sec,
        styleIntensity: 'medium',
        generationMode: 'style_replicate',
      }),
      materials: materials.map((material) => ({
        id: material.id,
        type:
          material.material_type === 'VIDEO'
            ? 'video'
            : material.material_type === 'AUDIO'
              ? 'audio'
              : 'image',
        url: material.oss_url,
        name: material.label,
        analysis: buildMaterialAnalysis(material),
        assetAnalysis: material.asset_analysis,
      })),
      userIntent: {
        goal: 'analyze_sample',
        aspectRatio: renderPlan.canvas.ratio,
        fps: renderPlan.canvas.fps,
        durationSec: renderPlan.duration_sec,
        styleIntensity: 'medium',
      },
      currentRenderPlan: renderPlan,
    },
    generation: task.finalVideoUrl
      ? {
          final_video_url: task.finalVideoUrl,
          duration_sec: structure.metadata.duration_sec,
          generated_at: task.completedAt?.toISOString() ?? new Date().toISOString(),
        }
      : undefined,
  }
}
