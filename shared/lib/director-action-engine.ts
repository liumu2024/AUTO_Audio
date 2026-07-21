import {
  directorIntentToUserIntent,
  mergeDirectorSlots,
  routeDirectorConversation,
  type DirectorConversationRuntime,
} from './director-understanding.js'
import type {
  DirectorAction,
  DirectorActionOutcome,
  DirectorActionPayload,
  DirectorActionType,
  DirectorExecutionPlan,
  DirectorPlanStep,
  DirectorToolName,
} from '../types/director-action.js'
import type { DirectorContext, DirectorContextSlots } from '../types/director-context.js'
import type { DirectorIntentResult, DirectorNextAction } from '../types/director-context.js'

export type {
  DirectorAction,
  DirectorActionOutcome,
  DirectorActionPayload,
  DirectorActionType,
  DirectorActionPhase,
  DirectorExecutionPlan,
  DirectorPlanStep,
  DirectorToolName,
} from '../types/director-action.js'

export interface ResolveDirectorActionInput {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}

export interface DirectorActionExecutionContext {
  prompt: string
  sampleVideoUrl: string
  sampleVideoName?: string
  aspectRatio: DirectorContextSlots['aspectRatio']
  durationSec?: number
  styleIntensity: DirectorContextSlots['styleIntensity']
  materials: Array<{
    id: string
    name: string
    type: 'video' | 'image' | 'audio'
    url: string
    tags?: string[]
  }>
  activeTaskId?: string | null
  renderPlan?: import('../types/render-plan.v1.js').RenderPlanV1
}

export interface DirectorActionExecutor {
  analyzeSample: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>
  analyzeMaterials: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>
  generateRenderPlan: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>
  reviseRenderPlan: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>
  renderVideo: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>
  askUser: (ctx: DirectorActionExecutionContext, action: DirectorAction) => Promise<DirectorActionOutcome>
  requestPlugin: (ctx: DirectorActionExecutionContext, action: DirectorAction) => Promise<DirectorActionOutcome>
}

function includesPluginRequest(text: string): boolean {
  return /插件|plugin|component|能力缺失|missing capability/i.test(text)
}

function extractPluginId(text: string): string | undefined {
  const match = text.match(/(?:plugin[_-]?id|插件)[:：\s]+([a-z0-9_/-]+)/i)
  return match?.[1]
}

export function mapNextActionToDirectorActionType(
  result: DirectorIntentResult,
): DirectorActionType {
  if (result.intent === 'analyze_materials' && result.nextAction !== 'ANALYZE_SAMPLE') {
    return 'ANALYZE_MATERIALS'
  }

  const map: Record<DirectorNextAction, DirectorActionType> = {
    NEED_BACKEND: 'ASK_USER',
    NEED_SAMPLE: 'ASK_USER',
    ANALYZE_SAMPLE: 'ANALYZE_SAMPLE',
    GENERATE_VIDEO: 'GENERATE_RENDER_PLAN',
    RENDER: 'RENDER_VIDEO',
    REVISE_PLAN: 'REVISE_RENDER_PLAN',
    ACKNOWLEDGE: 'ASK_USER',
    ASK_USER: 'ASK_USER',
    WAIT: 'ASK_USER',
  }

  return map[result.nextAction] ?? 'ASK_USER'
}

function planStep(
  id: string,
  tool: DirectorToolName,
  reason: string,
  retryLimit = 0,
): DirectorPlanStep {
  return {
    id,
    tool,
    reason,
    required: true,
    retryLimit,
  }
}

export function buildExecutionPlanFromDirectorAction(
  action: Pick<DirectorAction, 'type'>,
): DirectorExecutionPlan {
  const stepsByAction: Record<DirectorActionType, DirectorPlanStep[]> = {
    ANALYZE_SAMPLE: [
      planStep(
        'analyze_sample',
        'sample_understanding.analyze',
        'Analyze the reference sample for structure, rhythm, style, and reusable constraints.',
        1,
      ),
    ],
    ANALYZE_MATERIALS: [
      planStep(
        'analyze_materials',
        'material.analyze_basic',
        'Read user materials as candidate assets for the final video.',
      ),
    ],
    GENERATE_RENDER_PLAN: [
      planStep(
        'analyze_materials',
        'material.analyze_basic',
        'Refresh material facts before planning scenes.',
      ),
      planStep(
        'build_render_plan',
        'render_plan.build',
        'Build a structured RenderPlan from sample understanding, user intent, and materials.',
      ),
      planStep(
        'apply_effect_composition',
        'effect_composition.apply',
        'Map style and effect intent onto supported Remotion capabilities.',
      ),
      planStep(
        'validate_render_plan',
        'render_plan.validate',
        'Check schema, resources, and supported components before saving.',
      ),
    ],
    REVISE_RENDER_PLAN: [
      planStep(
        'revise_render_plan',
        'render_plan.revise',
        'Apply the requested change to the current editable RenderPlan.',
      ),
      planStep(
        'validate_render_plan',
        'render_plan.validate',
        'Check the revised RenderPlan before it can be rendered.',
      ),
    ],
    RENDER_VIDEO: [
      planStep(
        'validate_render_plan',
        'render_plan.validate',
        'Check the saved RenderPlan before submitting a render job.',
      ),
      planStep(
        'render_video',
        'video.render',
        'Render the saved RenderPlan with Remotion.',
        1,
      ),
    ],
    ASK_USER: [
      planStep(
        'ask_user',
        'user.ask',
        'Ask for missing information or acknowledge the user without starting backend work.',
      ),
    ],
    REQUEST_PLUGIN: [
      planStep(
        'request_plugin',
        'user.ask',
        'Record the missing capability and ask how to proceed.',
      ),
    ],
  }

  return {
    version: 'director_plan_v1',
    sourceAction: action.type,
    steps: stepsByAction[action.type],
  }
}

export function directorActionFromIntentResult(input: ResolveDirectorActionInput & {
  result: DirectorIntentResult
}): DirectorAction {
  const { result } = input
  const slots = mergeDirectorSlots(input.context.slots, result.slotsPatch)
  const intent = directorIntentToUserIntent(
    result,
    input.context.userIntent,
    input.prompt,
  )

  let type = mapNextActionToDirectorActionType(result)
  const payload: DirectorActionPayload = {
    missingSlots: result.missingSlots,
    requiresConfirmation: result.requiresConfirmation,
  }

  if (includesPluginRequest(input.prompt)) {
    type = 'REQUEST_PLUGIN'
    payload.pluginId = extractPluginId(input.prompt)
  }

  payload.executionPlan = buildExecutionPlanFromDirectorAction({ type })

  return {
    type,
    message: result.assistantMessage,
    intent,
    slots,
    result,
    payload,
  }
}

export function resolveDirectorAction(input: ResolveDirectorActionInput): DirectorAction {
  const result = routeDirectorConversation({
    prompt: input.prompt,
    slots: input.context.slots,
    runtime: input.runtime,
  })

  return directorActionFromIntentResult({ ...input, result })
}

export async function executeDirectorAction(input: {
  action: DirectorAction
  executor: DirectorActionExecutor
  context: DirectorActionExecutionContext
}): Promise<DirectorActionOutcome> {
  const { action, executor, context } = input

  switch (action.type) {
    case 'ANALYZE_SAMPLE':
      return executor.analyzeSample(context)
    case 'ANALYZE_MATERIALS':
      return executor.analyzeMaterials(context)
    case 'GENERATE_RENDER_PLAN':
      return executor.generateRenderPlan(context)
    case 'REVISE_RENDER_PLAN':
      return executor.reviseRenderPlan(context)
    case 'RENDER_VIDEO':
      return executor.renderVideo(context)
    case 'REQUEST_PLUGIN':
      return executor.requestPlugin(context, action)
    case 'ASK_USER':
    default:
      return executor.askUser(context, action)
  }
}
