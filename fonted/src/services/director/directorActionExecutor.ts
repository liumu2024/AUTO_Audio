import { analyzeAssetHeuristically } from '@shared/lib/asset-analysis-heuristic'
import {
  executeDirectorAction,
  type DirectorActionExecutionContext,
  type DirectorActionExecutor,
  type DirectorActionOutcome,
} from '@shared/lib/director-action-engine'
import type { DirectorAction } from '@shared/types/director-action'
import { buildRenderPlanFromStructure } from '@shared/lib/render-plan-builder'
import {
  applyRenderActionBatch,
  renderActionsFromSlotsPatch,
} from '@shared/lib/render-action-engine'
import { injectMaterialsIntoRenderPlan } from '@shared/lib/render-plan-materials'
import {
  formatRenderPlanValidationFailure,
  validateRenderPlanHard,
} from '@shared/lib/render-plan-validator'
import { repairRenderPlanDeterministically } from '@shared/lib/render-plan-repair'
import { selectRenderPlanCandidate } from '@shared/lib/render-plan-candidates'
import type { RenderAsset, RenderPlanV1 } from '@shared/types/render-plan.v1'

import { buildGenerationTimeline } from '@/lib/generation-timeline'
import { runFullCreationPipeline } from '@/services/pipeline/runFullPipeline'
import { runPipelineGeneration } from '@/services/pipeline/runGeneration'
import { ensurePublicUrl } from '@/services/pipeline/uploadAssets'
import type { InputAttachment } from '@/stores/creationStore'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTimelineStore } from '@/stores/timelineStore'

function assetTypeFromMaterial(type: 'video' | 'image' | 'audio'): RenderAsset['type'] {
  if (type === 'audio') return 'audio'
  if (type === 'image') return 'image'
  return 'video'
}

async function materialsToAssets(
  materials: DirectorActionExecutionContext['materials'],
): Promise<RenderAsset[]> {
  return Promise.all(
    materials.map(async (material) => ({
      id: material.id,
      type: assetTypeFromMaterial(material.type),
      name: material.name,
      url: await ensurePublicUrl(material.url, material.name),
      source: 'user_material' as const,
    })),
  )
}

function ensureRenderPlan(input: {
  taskId: string
  bundle: NonNullable<ReturnType<typeof usePipelineStore.getState>['bundle']>
  aspectRatio: DirectorActionExecutionContext['aspectRatio']
  forceRebuild?: boolean
}): RenderPlanV1 {
  if (input.bundle.render_plan && !input.forceRebuild) return input.bundle.render_plan
  return buildRenderPlanFromStructure({
    taskId: input.taskId,
    structure: input.bundle.structure,
    materials: input.bundle.materials,
    aspectRatio: input.aspectRatio,
  })
}

function validatePlanOrRepair(input: {
  plan: RenderPlanV1 | null | undefined
  phase: 'before_save' | 'before_render'
}) {
  const result = validateRenderPlanHard({
    renderPlan: input.plan,
    phase: input.phase,
  })
  if (result.ok && input.plan) {
    return { plan: input.plan, validation: result }
  }

  const repaired = repairRenderPlanDeterministically({
    renderPlan: input.plan,
    phase: input.phase,
    validation: result,
  })
  if (repaired.plan && repaired.validation.ok) {
    return {
      plan: repaired.plan,
      validation: {
        ...repaired.validation,
        warnings: [
          ...repaired.validation.warnings,
          ...repaired.report.actions.map((action) => action.message),
        ],
      },
      repairReport: repaired.report,
    }
  }

  throw new Error(formatRenderPlanValidationFailure(repaired.validation))
}

export function createDirectorActionExecutor(): DirectorActionExecutor {
  return {
    async analyzeSample(ctx): Promise<DirectorActionOutcome> {
      await runFullCreationPipeline({
        sampleVideoUrl: ctx.sampleVideoUrl,
        sampleVideoName: ctx.sampleVideoName ?? 'sample-video.mp4',
        globalPrompt: ctx.prompt,
        aspectRatio: ctx.aspectRatio,
        durationSec: ctx.durationSec,
        styleIntensity: ctx.styleIntensity,
        materials: ctx.materials,
      })

      useCreationStore.getState().setSampleParsed(true)
      useEditorStore.getState().setGenerationEditEnabled(false)
      useEditorStore.getState().setTimelineMode('sample')
      useDirectorContextStore.getState().patchSlots({ sampleVideoStatus: 'parsed' })

      const bundle = usePipelineStore.getState().bundle
      const outlineCount = bundle?.outline.length ?? 0
      return {
        phase: 'completed',
        action: 'ANALYZE_SAMPLE',
        message:
          outlineCount > 0
            ? `样例解析完成：识别到 ${outlineCount} 个结构段落。`
            : '样例解析已完成，但没有形成结构大纲。',
      }
    },

    async analyzeMaterials(ctx): Promise<DirectorActionOutcome> {
      const contextStore = useDirectorContextStore.getState()
      const analyzed = await Promise.all(
        ctx.materials.map(async (material) => {
          const url = await ensurePublicUrl(material.url, material.name)
          return {
            id: material.id,
            type: material.type,
            url,
            name: material.name,
            tags: material.tags ?? [],
            assetAnalysis: analyzeAssetHeuristically({
              id: material.id,
              type: material.type,
              name: material.name,
              url,
              tags: material.tags,
            }),
          }
        }),
      )
      contextStore.setMaterials(analyzed)
      contextStore.patchSlots({ materialStatus: 'ready' })
      return {
        phase: 'completed',
        action: 'ANALYZE_MATERIALS',
        message: `已分析 ${analyzed.length} 个创作素材，可用于后续 RenderPlan 编排。`,
        userFacingOnly: true,
      }
    },

    async generateRenderPlan(ctx): Promise<DirectorActionOutcome> {
      const bundle = usePipelineStore.getState().bundle
      const taskId = ctx.activeTaskId ?? bundle?.task_id
      if (!bundle || !taskId) {
        throw new Error('当前任务上下文未就绪，请先完成样例解析。')
      }

      const basePlan = ensureRenderPlan({
        taskId,
        bundle,
        aspectRatio: ctx.aspectRatio,
        forceRebuild: /重新生成方案|重写 RenderPlan/.test(ctx.prompt),
      })
      const assets = await materialsToAssets(ctx.materials)
      let plan = assets.length
        ? injectMaterialsIntoRenderPlan({
            plan: basePlan,
            assets,
            prompt: ctx.prompt,
          })
        : basePlan

      const slotActions = renderActionsFromSlotsPatch(
        useDirectorContextStore.getState().context.slots,
        plan,
      )
      if (slotActions.length) {
        plan = applyRenderActionBatch(plan, { actions: slotActions })
      }

      const candidateSelection = selectRenderPlanCandidate({
        plan,
        prompt: ctx.prompt,
        phase: 'before_save',
      })
      plan = candidateSelection.selected.plan

      const checkedPlan = validatePlanOrRepair({ plan, phase: 'before_save' })
      plan = checkedPlan.plan
      useRenderPlanStore.getState().setPlan(plan)
      useRenderPlanStore
        .getState()
        .markDirty(`已重新生成 RenderPlan revision ${(plan.plan_revision ?? 1) + 1}`)
      useDirectorContextStore.getState().setRenderPlan(plan)
      useEditorStore.getState().setGenerationEditEnabled(true)
      useEditorStore.getState().setTimelineMode('generation')
      const timeline = useTimelineStore.getState().project
      useTimelineStore.getState().setProject(buildGenerationTimeline(timeline, plan))

      return {
        phase: 'completed',
        action: 'GENERATE_RENDER_PLAN',
        message:
          'RenderPlan 已根据样例结构与创作素材生成。如需导出成片，请明确说「渲染」或「导出」。',
        userFacingOnly: true,
        toolResult: {
          ...checkedPlan.validation,
          warnings: [
            ...checkedPlan.validation.warnings,
            `selected RenderPlan candidate ${candidateSelection.summary.selectedId}`,
          ],
        },
      }
    },

    async reviseRenderPlan(ctx): Promise<DirectorActionOutcome> {
      const renderPlanStore = useRenderPlanStore.getState()
      const contextStore = useDirectorContextStore.getState()
      const plan = renderPlanStore.plan ?? ctx.renderPlan

      if (plan) {
        const actions = renderActionsFromSlotsPatch(contextStore.context.slots, plan)
        if (actions.length) {
          const next = applyRenderActionBatch(plan, { actions })
          renderPlanStore.setPlan(next)
          contextStore.setRenderPlan(next)
        } else if (ctx.aspectRatio) {
          renderPlanStore.setAspectRatio(ctx.aspectRatio)
        }
      } else {
        contextStore.setUserIntent({
          aspectRatio: ctx.aspectRatio,
          durationSec: ctx.durationSec,
          styleIntensity: ctx.styleIntensity,
          rawText: ctx.prompt,
        })
      }

      return {
        phase: 'completed',
        action: 'REVISE_RENDER_PLAN',
        message: ctx.prompt.trim()
          ? '已记录参数调整，RenderPlan 已更新。不会自动渲染；确认后请说「渲染」或「导出」。'
          : '已记录导演偏好。不会自动触发渲染。',
        userFacingOnly: true,
      }
    },

    async renderVideo(ctx): Promise<DirectorActionOutcome> {
      const taskId = ctx.activeTaskId
      if (!taskId) {
        throw new Error('缺少 activeTaskId，无法提交渲染任务。')
      }

      const renderPlanStore = useRenderPlanStore.getState()
      const contextStore = useDirectorContextStore.getState()
      let plan = renderPlanStore.plan ?? ctx.renderPlan
      if (plan) {
        const actions = renderActionsFromSlotsPatch(contextStore.context.slots, plan)
        if (actions.length) {
          const next = applyRenderActionBatch(plan, { actions })
          plan = next
          renderPlanStore.setPlan(next)
          useRenderPlanStore
            .getState()
            .markDirty(`已按提示更新 RenderPlan revision ${(next.plan_revision ?? 1) + 1}`)
          contextStore.setRenderPlan(next)
        }
      }

      const checkedPlan = validatePlanOrRepair({ plan, phase: 'before_render' })
      plan = checkedPlan.plan
      if (checkedPlan.repairReport?.repaired) {
        renderPlanStore.setPlan(plan)
        renderPlanStore.markDirty(
          `已执行确定性 RenderPlan 修复 revision ${(plan.plan_revision ?? 1) + 1}`,
        )
        contextStore.setRenderPlan(plan)
      }
      useEditorStore.getState().setTimelineMode('generation')
      await runPipelineGeneration(
        taskId,
        ctx.prompt,
        ctx.materials.map(
          (item): InputAttachment => ({
            id: `att_${item.id}`,
            name: item.name,
            type: item.type,
            url: item.url,
            source: 'upload',
            materialId: item.id,
            tags: item.tags,
          }),
        ),
      )

      useDirectorContextStore
        .getState()
        .setRenderPlan(useRenderPlanStore.getState().plan ?? undefined)

      return {
        phase: 'completed',
        action: 'RENDER_VIDEO',
        message: '渲染任务已提交并完成。你可以在「生成编辑」面板继续微调。',
        toolResult: checkedPlan.validation,
      }
    },

    async askUser(_ctx, action: DirectorAction): Promise<DirectorActionOutcome> {
      return {
        phase: 'message',
        action: 'ASK_USER',
        message: action.message,
        userFacingOnly: true,
      }
    },

    async requestPlugin(ctx, action: DirectorAction): Promise<DirectorActionOutcome> {
      const capabilityId = action.payload?.pluginId ?? 'missing_capability'
      const plan = useRenderPlanStore.getState().plan ?? ctx.renderPlan
      if (plan) {
        const next = applyRenderActionBatch(plan, {
          actions: [
            {
              type: 'REQUEST_COMPONENT',
              payload: {
                capability_id: capabilityId,
                reason: action.message,
              },
            },
          ],
        })
        useRenderPlanStore.getState().setPlan(next)
      }
      return {
        phase: 'message',
        action: 'REQUEST_PLUGIN',
        message: action.message || `已记录缺失能力 ${capabilityId}，等待插件审批或 fallback。`,
        userFacingOnly: true,
      }
    },
  }
}

export async function runDirectorAction(input: {
  action: DirectorAction
  context: DirectorActionExecutionContext
  executor?: DirectorActionExecutor
}) {
  const executor = input.executor ?? createDirectorActionExecutor()
  return executeDirectorAction({
    action: input.action,
    executor,
    context: input.context,
  })
}
