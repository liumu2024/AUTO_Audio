import * as api from '@/lib/api'
import { ensurePublicUrl } from '@/services/pipeline/uploadAssets'
import {
  formatRenderPlanValidationFailure,
  validateRenderPlanHard,
} from '@shared/lib/render-plan-validator'
import { repairRenderPlanDeterministically } from '@shared/lib/render-plan-repair'
import { injectMaterialsIntoRenderPlan } from '@shared/lib/render-plan-materials'
import type { InputAttachment } from '@/stores/creationStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'
import type { RenderAsset, RenderPlanV1 } from '@/types/render-plan'

const POLL_MS = 2000
const MAX_POLLS = 180

function assetTypeFromAttachment(type: InputAttachment['type']): RenderAsset['type'] {
  if (type === 'audio') return 'audio'
  if (type === 'image') return 'image'
  return 'video'
}

function materialId(attachment: InputAttachment): string {
  return attachment.materialId ?? attachment.id.replace(/^att_/, '')
}

async function attachmentsToAssets(
  attachments: InputAttachment[],
): Promise<RenderAsset[]> {
  return Promise.all(
    attachments.map(async (attachment) => ({
      id: materialId(attachment),
      type: assetTypeFromAttachment(attachment.type),
      name: attachment.name,
      url: await ensurePublicUrl(attachment.url, attachment.name),
      source: 'user_material' as const,
    })),
  )
}

function injectMaterialsIntoRenderPlanLocal(input: {
  plan: RenderPlanV1
  assets: RenderAsset[]
  prompt: string
}): RenderPlanV1 {
  return injectMaterialsIntoRenderPlan(input)
}

export async function runPipelineGeneration(
  taskId: string,
  prompt: string,
  attachments: InputAttachment[] = [],
): Promise<void> {
  const { hydrate } = usePipelineStore.getState()
  const { startTask, addLog, setComplete, setFailed } = useTaskStore.getState()
  const renderPlanStore = useRenderPlanStore.getState()
  const shouldSubmitLocalPlan = renderPlanStore.isDirty || attachments.length > 0
  let repairActionCount = 0

  const trimmed =
    prompt.trim() || 'Keep the parsed sample structure and generate a new cut.'
  let renderPlan = renderPlanStore.plan
  if (renderPlan && attachments.length) {
    const assets = await attachmentsToAssets(attachments)
    renderPlan = injectMaterialsIntoRenderPlanLocal({ plan: renderPlan, assets, prompt: trimmed })
    useRenderPlanStore.getState().setPlan(renderPlan)
  }
  if (shouldSubmitLocalPlan && renderPlan) {
    const validation = validateRenderPlanHard({
      renderPlan,
      phase: 'before_render',
    })
    if (!validation.ok) {
      const repaired = repairRenderPlanDeterministically({
        renderPlan,
        phase: 'before_render',
        validation,
      })
      if (!repaired.plan || !repaired.validation.ok) {
        throw new Error(formatRenderPlanValidationFailure(repaired.validation))
      }
      renderPlan = repaired.plan
      repairActionCount = repaired.report.actions.length
      useRenderPlanStore.getState().setPlan(renderPlan)
    }
  }

  startTask(trimmed, taskId)
  if (repairActionCount > 0) {
    addLog(`[Generation] Applied ${repairActionCount} deterministic RenderPlan repair(s).`)
  }
  addLog(
    shouldSubmitLocalPlan && renderPlan
      ? `[Generation] Submitting RenderPlan revision ${renderPlan.plan_revision ?? 1} to backend...`
      : '[Generation] Reusing persisted backend RenderPlan...',
  )
  await api.submitCopilotTask(
    taskId,
    trimmed,
    shouldSubmitLocalPlan ? renderPlan ?? undefined : undefined,
  )
  if (shouldSubmitLocalPlan && renderPlan) {
    useRenderPlanStore.getState().markSaved()
  }
  addLog('[Generation] Queued generator.worker; waiting for final video...')

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS))

    const task = await api.getTask(taskId)
    addLog(`[Generation] Task status: ${task.taskStatus}`)

    if (task.taskStatus === 'COMPLETED' && task.finalVideoUrl) {
      const bundle = await api.getTaskPipeline(taskId)
      hydrate(bundle)
      setComplete(true)
      addLog(`[Generation] Final video ready: ${task.finalVideoUrl}`)
      return
    }

    if (task.taskStatus === 'FAILED') {
      const message = 'Generation failed. Check generator.worker logs.'
      setFailed(message)
      throw new Error(message)
    }

    if (task.taskStatus === 'CANCELLED' || task.taskStatus === 'CANCELLING') {
      useTaskStore.getState().setCancelled()
      return
    }
  }

  const message = 'Timed out waiting for final video. Is worker:generator running?'
  setFailed(message)
  throw new Error(message)
}
