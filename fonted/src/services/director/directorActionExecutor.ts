import { analyzeAssetHeuristically } from '@shared/lib/asset-analysis-heuristic'
import {
  executeDirectorAction,
  type DirectorActionExecutionContext,
  type DirectorActionExecutor,
  type DirectorActionOutcome,
} from '@shared/lib/director-action-engine'
import type { DirectorAction, DirectorToolResult } from '@shared/types/director-action'

import {
  previewV2DirectorTimeline,
  renderV2DirectorTimeline,
} from '@/services/director/v2DirectorTimeline'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useEditorStore } from '@/stores/editorStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

function v2TimelineInput(ctx: DirectorActionExecutionContext) {
  return {
    taskId: ctx.activeTaskId,
    prompt: ctx.prompt,
    sampleVideoUrl: ctx.sampleVideoUrl,
    sampleVideoName: ctx.sampleVideoName,
    aspectRatio: ctx.aspectRatio,
    durationSec: ctx.durationSec,
    materials: ctx.materials,
    plannerMode: 'llm' as const,
  }
}

function okToolResult<T>(data: T, warnings: string[] = []): DirectorToolResult<T> {
  return {
    ok: true,
    data,
    warnings,
    errors: [],
  }
}

export function createDirectorActionExecutor(): DirectorActionExecutor {
  return {
    async analyzeSample(ctx): Promise<DirectorActionOutcome> {
      const preview = await previewV2DirectorTimeline(v2TimelineInput(ctx))

      useEditorStore.getState().setTimelineMode('sample')
      useDirectorContextStore.getState().patchSlots({ sampleVideoStatus: 'parsed' })

      const outlineCount = preview.review.metrics.scene_count
      return {
        phase: 'completed',
        action: 'ANALYZE_SAMPLE',
        message:
          outlineCount > 0
            ? `我已经先把样例拆成了 ${outlineCount} 个时间线段落。右侧可以先看结构和节奏判断，trace 也已经写到 ${preview.traceDir}，方便你之后检查。`
            : `我看完了这个样例，但暂时没有拆出稳定段落。trace 在 ${preview.traceDir}，你可以补充一下想重点学习哪种节奏或画面关系。`,
        toolResult: okToolResult(preview.review, preview.review.warnings_zh),
      }
    },

    async analyzeMaterials(ctx): Promise<DirectorActionOutcome> {
      const contextStore = useDirectorContextStore.getState()
      const analyzed = await Promise.all(
        ctx.materials.map((material) => {
          const url = material.url
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
        message: `我整理好了 ${analyzed.length} 个可用素材。后面做方案时，我会把样例当作结构和风格参考，把这些素材当作真正进入成片的画面来源。`,
        userFacingOnly: true,
      }
    },

    async generateRenderPlan(ctx): Promise<DirectorActionOutcome> {
      const preview = await previewV2DirectorTimeline(v2TimelineInput(ctx))
      useEditorStore.getState().setGenerationEditEnabled(true)
      useEditorStore.getState().setTimelineMode('generation')

      return {
        phase: 'completed',
        action: 'GENERATE_RENDER_PLAN',
        message:
          `我先排出了一版时间线方案：${preview.review.summary_zh} 你可以先看右侧分镜和时间线，觉得节奏或素材分配不对就直接告诉我改；trace 在 ${preview.traceDir}。`,
        userFacingOnly: true,
        toolResult: okToolResult(preview.review, preview.review.warnings_zh),
      }
    },

    async reviseRenderPlan(ctx): Promise<DirectorActionOutcome> {
      useDirectorContextStore.getState().setUserIntent({
        aspectRatio: ctx.aspectRatio,
        durationSec: ctx.durationSec,
        styleIntensity: ctx.styleIntensity,
        rawText: ctx.prompt,
      })

      const current = useV2TimelineStore.getState()
      if (current.spec) {
        const preview = await previewV2DirectorTimeline({
          ...v2TimelineInput(ctx),
          taskId: current.taskId ?? ctx.activeTaskId,
          prompt: [
            current.lastPrompt ? `上一版意图：${current.lastPrompt}` : '',
            `本次修改：${ctx.prompt}`,
          ]
            .filter(Boolean)
            .join('\n'),
        })
        return {
          phase: 'completed',
          action: 'REVISE_RENDER_PLAN',
          message: `我已经按你的修改重新排了一版方案。现在先不自动渲染，你可以再看一眼右侧时间线；trace 在 ${preview.traceDir}。`,
          userFacingOnly: true,
          toolResult: okToolResult(preview.review, preview.review.warnings_zh),
        }
      }

      return {
        phase: 'completed',
        action: 'REVISE_RENDER_PLAN',
        message: ctx.prompt.trim()
          ? '我已经按你的描述调整了当前方案。先不自动渲染，方便你再看一眼；确认没问题后直接说“渲染”就行。'
          : '我先把这个偏好记到当前方案里，不会自动开始渲染。',
        userFacingOnly: true,
      }
    },

    async renderVideo(ctx): Promise<DirectorActionOutcome> {
      const result = await renderV2DirectorTimeline(v2TimelineInput(ctx))
      useEditorStore.getState().setTimelineMode('generation')

      return {
        phase: 'completed',
        action: 'RENDER_VIDEO',
        message: `这版视频已经渲染好了，右侧预览区已经更新。trace 在 ${result.traceDir}，后续如果要追中间过程可以从那里看。`,
        toolResult: okToolResult(result.evaluation, result.evaluation.warnings),
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

    async requestPlugin(_ctx, action: DirectorAction): Promise<DirectorActionOutcome> {
      const capabilityId = action.payload?.pluginId ?? 'missing_capability'
      return {
        phase: 'message',
        action: 'REQUEST_PLUGIN',
        message: action.message || `这里确实缺一个更合适的能力：${capabilityId}。我先把缺口记下来，后面可以选择补一段生成能力，或者先用现有素材和动效做降级版本。`,
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
