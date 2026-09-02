import { z } from 'zod'

import { env } from '../../config/env.js'
import { listV2AgentSkillCards } from '../../pipeline-v2/agent-skills/registry.js'
import {
  evaluateV2AgentToolReadiness,
  findV2AgentTool,
  listV2AgentToolCards,
} from '../../pipeline-v2/agent-tools/registry.js'
import {
  deriveRuntimeSlotStatus,
} from '../../../../shared/lib/director-understanding.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type {
  DirectorContext,
  DirectorContextSlots,
  DirectorExecutionEffect,
  DirectorIntentResult,
} from '../../../../shared/types/director-context.js'
import type {
  ConfirmedRequirement,
  DirectorWorkspaceState,
} from '../../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import type { DirectorSurfaceMode } from '../../../../shared/types/director-stream.js'
import type { CreativeMemorySearchResult } from '../creative-memory/creative-memory.service.js'
import {
  listPromotedComponents,
  type RenderComponentSummary,
} from '../render-components/component-registry.js'
import {
  prepareArkImageInputs,
  releaseArkImageInputs,
  type ArkResponsesImageInput,
} from '../../pipeline-v2/ark-image-input.js'

const AspectRatioSchema = z.enum(['9:16', '16:9', '1:1', '4:3'])
const ContentDomainSchema = z.enum([
  'landscape_montage',
  'music_video',
  'product_marketing',
  'general',
])
const CanonicalIntentSchema = z.enum(['chat', 'create', 'revise', 'execute', 'clarify'])
const MAX_DIRECTOR_IMAGE_INPUTS = 12
const RequirementOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add'), statement: z.string().trim().min(1).max(500) }).strict(),
  z.object({
    operation: z.literal('replace'), targetRequirementId: z.string().trim().min(1),
    statement: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({ operation: z.literal('revoke'), targetRequirementId: z.string().trim().min(1) }).strict(),
])
const CreativeConfigDeltaSchema = z.object({
  contentDomain: ContentDomainSchema.optional(),
  aspectRatio: AspectRatioSchema.optional(),
  durationSec: z.number().min(1).max(600).optional(),
  styleIntensity: z.enum(['light', 'medium', 'strong']).optional(),
}).strict()
const StateActionSchema = z.object({
  ref: z.string().trim().min(1).max(80),
  kind: z.literal('requirements.update'),
  operations: z.array(RequirementOperationSchema).min(1).max(20),
}).strict()
const ToolRequestSchema = z.object({
  ref: z.string().trim().min(1).max(80),
  toolId: z.string().trim().min(1),
  skillId: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  requestedMode: z.enum(['preview', 'execute']),
  dependsOn: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).strict()

const DecisionFields = {
  replyDraft: z.string().trim().min(1),
  creationSummary: z.object({
    goal: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(300).optional(),
    openQuestions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  }).strict().optional(),
  creativeConfigDelta: CreativeConfigDeltaSchema.default({}),
  stateActions: z.array(StateActionSchema).max(1).default([]),
  skillRequests: z.array(z.object({ skillId: z.string().trim().min(1), purpose: z.string().trim().min(1) }).strict()).default([]),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
} as const
const LlmIntentResultSchema = z.discriminatedUnion('intent', [
  z.object({
    ...DecisionFields,
    intent: z.enum(['chat', 'clarify']),
    toolRequests: z.array(ToolRequestSchema).max(0).default([]),
  }).strict(),
  z.object({
    ...DecisionFields,
    intent: z.enum(['create', 'revise', 'execute']),
    toolRequests: z.array(ToolRequestSchema).max(20).default([]),
  }).strict(),
]).superRefine((decision, context) => {
  const refs = [
    ...decision.stateActions.map((action) => action.ref),
    ...decision.toolRequests.map((request) => request.ref),
  ]
  const duplicate = refs.find((ref, index) => refs.indexOf(ref) !== index)
  if (duplicate) {
    context.addIssue({
      code: 'custom',
      message: `globally unique action ref required: ${duplicate}`,
      path: ['ref'],
    })
  }
})

const DirectorDecisionJsonSchema = z.toJSONSchema(LlmIntentResultSchema, {
  target: 'draft-7',
}) as Record<string, unknown>

const DirectorFinalReplyOpeningSchema = z.enum([
  '',
  '我看过这次的处理结果了',
  '我把这次的处理结果整理好了',
  '我把刚才的处理情况核对了一遍',
  '这次的处理情况我已经梳理好了',
  '我按你的要求逐项看过结果了',
  '刚才的处理结果我已经逐项确认过了',
])
const DirectorFinalReplyNextStepSchema = z.enum([
  '',
  '你可以继续告诉我接下来想怎么调整',
  '你可以先看看当前结果，再决定下一步',
  '如果需要，我可以继续按当前结果往下处理',
  '你可以先确认这些结果，再告诉我下一步想怎么处理',
  '接下来想继续调整哪一部分，直接告诉我就可以',
  '如果想换一种处理方式，也可以继续告诉我',
  '你可以根据当前结果决定继续调整还是先保留',
])
const DirectorFinalReplyConnectorSchema = z.enum(['', '另外，', '同时，', '不过，', '至于另一项，'])
const DirectorFinalReplySchema = z.object({
  opening: DirectorFinalReplyOpeningSchema,
  outcomes: z.array(z.object({
    ref: z.string().trim().min(1).max(80),
    status: z.enum(['succeeded', 'failed', 'skipped']),
    connector: DirectorFinalReplyConnectorSchema,
  }).strict()).max(50),
  nextStep: DirectorFinalReplyNextStepSchema,
}).strict()
const DirectorFinalReplyJsonSchema = z.toJSONSchema(DirectorFinalReplySchema, {
  target: 'draft-7',
}) as Record<string, unknown>

type LlmIntentResult = z.infer<typeof LlmIntentResultSchema> & {
  normalizedActionableQuestion?: boolean
}
export type DirectorStateAction = z.infer<typeof StateActionSchema>

export interface LlmIntentRouterOutput {
  source: 'llm' | 'llm_unstructured_safe_reply' | 'context_fallback'
  result: DirectorIntentResult
  publicThoughts: string[]
  fallbackReason?: string
  responseId?: string
  responseContinuityRejected?: boolean
  modelCalled: boolean
  modelOutputText?: string
  modelResponseAudit?: unknown
  protocolError?: { kind: 'json_syntax' | 'field_validation'; message: string }
  structuredOutput?: { requested: boolean; providerFallback: boolean; reason?: string }
  imageInputWarnings?: string[]
  proposalReplyFallbackRequired?: boolean
  jsonRepair?: {
    request: string
    responseAudit?: unknown
    protocolError?: { kind: 'json_syntax' | 'field_validation'; message: string }
  }
  conversationIntent?: z.infer<typeof CanonicalIntentSchema>
  stateActions: DirectorStateAction[]
  missingInformation: string[]
}

export interface DirectorFinalReplyFact {
  ref: string
  status: 'succeeded' | 'failed' | 'skipped'
  summary: string
}

export interface DirectorFinalReplyResult {
  message: string
  source: 'llm' | 'fallback'
  responseId?: string
  audit?: unknown
  validationError?: string
}

function summarizeCurrentTimeline(context: DirectorContext) {
  const timeline = context.currentTimeline ?? context.directorState?.timeline
  if (!timeline) return undefined
  return {
    kind: timeline.kind,
    status: timeline.status,
    draftId: timeline.draftId,
    currentRevision: timeline.currentRevision,
    savedRevision: timeline.savedRevision,
    renderedRevision: timeline.renderedRevision,
    lastRunId: timeline.lastRunId,
    sceneCount: context.currentTimeline?.sceneCount,
    lastChangeSummary: timeline.lastChangeSummary,
  }
}

interface DirectorPromptInput {
  prompt: string
  surfaceMode?: DirectorSurfaceMode
  currentTurnId?: string
  currentTurnMaterialIds?: string[]
  context: DirectorContext
  runtime: DirectorConversationRuntime
  visualInputCount?: number
  confirmedRequirements?: ConfirmedRequirement[]
  pendingTimelineRevisions?: DirectorWorkspaceState['pendingTimelineRevisions']
  recentFailure?: DirectorWorkspaceState['recentFailure']
  retrievedCreativeMemories?: CreativeMemorySearchResult
  promotedComponents?: RenderComponentSummary[]
  timelineSpec?: RemotionTimelineSpecV1
}

function isReadOnlySurface(mode?: DirectorSurfaceMode) {
  return mode === 'creative_guide'
    || mode === 'capability_intro'
    || mode === 'help'
    || mode === 'smalltalk'
}

function withoutEmptyPromptValues<T>(value: T): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value
      .map((item) => withoutEmptyPromptValues(item))
      .filter((item) => item !== undefined)
    return (items.length > 0 ? items : undefined) as T | undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => {
        const compact = withoutEmptyPromptValues(item)
        return compact === undefined ? [] : [[key, compact] as const]
      })
    return (entries.length > 0 ? Object.fromEntries(entries) : undefined) as T | undefined
  }
  return value
}

function toolCapabilitiesForPrompt(input: DirectorPromptInput) {
  const timelineSummary = summarizeCurrentTimeline(input.context)
  const tools = listV2AgentToolCards().map(({ effectiveMode: _effectiveMode, ...tool }) => {
    const readiness = evaluateV2AgentToolReadiness({
      toolId: tool.id,
      context: input.context,
      runtime: input.runtime,
      workspace: {
        draftId: timelineSummary?.draftId,
        baseRevision: timelineSummary?.currentRevision,
        pendingTimelineRevisions: input.pendingTimelineRevisions,
      },
      timelineSpec: input.timelineSpec,
    })
    const reason = readiness.missing
      .map((item) => `${item.code}: ${item.description}`)
      .join('；')
    return {
      ...tool,
      status: readiness.status,
      ...(reason ? { reason } : {}),
      ...(readiness.alternatives.length > 0 ? { alternatives: readiness.alternatives } : {}),
    }
  })
  return isReadOnlySurface(input.surfaceMode) ? [] : tools
}

export function compactDirectorContextForPrompt(input: DirectorPromptInput) {
  const timelineSummary = summarizeCurrentTimeline(input.context)
  const hasDraft = Boolean(timelineSummary?.draftId && timelineSummary.currentRevision)
  const effectiveConfig = input.context.effectiveCreativeConfig ?? {
    aspectRatio: input.context.slots.aspectRatio,
    durationSec: input.context.slots.durationSec,
    styleIntensity: input.context.slots.styleIntensity,
  }
  const activeMemories = (input.retrievedCreativeMemories?.active ?? []).map((item) => ({
    id: item.memory.id,
    scopeType: item.memory.scopeType,
    draftId: item.memory.draftId,
    statement: item.memory.statement,
    sourceExcerpt: item.memory.sourceExcerpt,
  }))
  return withoutEmptyPromptValues({
    turn: {
      currentTurnId: input.currentTurnId,
      visualInputCount: input.visualInputCount ?? 0,
    },
    creative: {
      goal: input.context.userIntent.goal,
      contentDomain: input.context.slots.contentDomain,
      effectiveConfig,
    },
    workspace: {
      timelineSummary: hasDraft ? timelineSummary : undefined,
      timelineFacts: hasDraft ? input.context.timelineFacts : undefined,
      pendingTimelineRevisions: input.pendingTimelineRevisions,
      recentFailure: input.recentFailure,
    },
    references: {
      sampleVideo: input.context.sampleVideo
        ? {
            id: input.context.sampleVideo.id,
            name: input.context.sampleVideo.name,
            hasReferenceSummary: Boolean(input.context.sampleVideo.reference),
            reference: input.context.sampleVideo.reference
              ? {
                  summary: input.context.sampleVideo.reference.summary,
                  methodHighlights: input.context.sampleVideo.reference.methodHighlights,
                  transferableKnowledge: input.context.sampleVideo.reference.transferableKnowledge,
                  shotCount: input.context.sampleVideo.reference.shotCount,
                  warnings: input.context.sampleVideo.reference.warnings,
                }
              : undefined,
          }
        : undefined,
      materials: input.context.materials.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        tags: item.tags ?? [],
        hasSummary: Boolean(item.summary),
        attachedThisTurn: input.currentTurnMaterialIds?.includes(item.id) || undefined,
      })),
    },
    requirements: (input.confirmedRequirements ?? []).filter((item) => item.status === 'active'),
    memories: { active: activeMemories },
    conversationSummary: input.context.conversationSummary,
    renderedComponents: input.promotedComponents ?? [],
  })!
}

export function buildDirectorModelPrompt(input: DirectorPromptInput) {
  const timelineSummary = summarizeCurrentTimeline(input.context)
  const hasDraft = Boolean(timelineSummary?.draftId && timelineSummary.currentRevision)
  const creationRules = hasDraft
    ? ''
    : `首次创建：
- 当前不存在草稿时使用 timeline.plan。creationSummary 只概括本轮目标、用户已提供的受众和真正待确认的问题，不得编造信息或替代 toolRequests。
- 首次创建先形成提案，用户确认后才执行；当前回复不得宣称方案已经创建。`
  const revisionRules = hasDraft
    ? `修改现有方案：
- 当前已有草稿，修改使用 timeline.patch，不得再次使用 timeline.plan。目标 ID 必须来自 timelineFacts；界面选中项不能替模型补全目标，目标不明确时先澄清。
- 修改具体字幕使用 subtitle，并传入目标 overlayIds；如果是给明确镜头新增字幕，且 timelineFacts.visibleText 中没有该镜头的现有字幕，则传 sceneId 并省略 overlayIds，不得预先编造字幕 ID。修改具体转场使用 transition，并传入全部目标 transitionIds。镜头增删、拆分或合并使用 structure 和连续 sceneIds；默认 durationMode=preserve_range，只有用户明确改变镜头或全片总时长时才用 resize_timeline。
- structure.sceneIds 只列当前草稿中被调整或替换的连续已有镜头。新增镜头不得预先编造 ID，由 Planner 在该范围内创建。
- 全片表达方向调整使用 global.brief_update；只有用户明确推翻整案时才使用 global.full_replan。
- scene 修改目标镜头的人物、地点、动作、事件和道具等叙事内容，并同步该镜头的人工智能生成任务；不修改字幕、时间、转场和视觉呈现。
- visual_strategy 修改目标镜头如何呈现，例如色彩、光线、背景、构图、景别、镜头运动、画面适配、素材绑定和对应呈现提示；现有镜头需要绑定用户素材时，只在该范围传 requiredMaterialIds。若素材绑定同时伴随叙事内容变化，分别输出 scene 和 visual_strategy，由服务端联合执行；不修改字幕和转场。
- 例如：“只把背景改为暖棕并缓慢拉远”使用 visual_strategy，不是 scene。
- 例如：“必须用这张图作为第四镜头画面，其他内容不变”使用 visual_strategy 并传入该图的素材 ID，不是 scene。
- 例如：“人物走进电梯查看手机，同时改成冷蓝低照度并缓慢推近”同时使用 scene 和 visual_strategy。
- 例如：“背景改为深紫蓝并缓慢推近，同时修改字幕背景透明度”同时使用 visual_strategy 和 subtitle。
- 当前输入同时改变同一镜头的内容、视觉呈现、字幕或相邻转场时，为每个明确要求且实际受影响的范围各输出一条 timeline.patch。不得把多个范围折叠成一个 scope，也不得补充用户没有要求的范围；服务端会在同一基础版本上联合执行兼容的同镜头修改。
- 修改先形成提案，用户确认后才执行；当前回复不得宣称修改已经完成。`
    : ''
  const pendingRules = input.pendingTimelineRevisions?.length
    ? `待处理的失败修改：
- 重试失败修改时原样传回对应 resolvesPendingCallId；新修改不得冒充解决旧失败。
- ${input.pendingTimelineRevisions.length === 1
  ? `当前只有这一项失败修改；用户明确重试它时，timeline.patch 必须传 resolvesPendingCallId=${input.pendingTimelineRevisions[0]!.callId}。`
  : '用户明确重试其中一项时，必须根据失败要求选择并传回该项的 resolvesPendingCallId。'}
- 只有用户明确放弃某项失败修改并保留当前草稿时，才调用 timeline.pending.dismiss 并传入对应 callId。`
    : ''
  const sampleDependencyRule = input.context.sampleVideo?.url && !input.runtime.isSampleParsed
    ? '- 当前样例尚未解析；只有用户明确要求当前创建或修改参考该样例时，才先请求 sample.analyze，让对应 timeline.plan 或 timeline.patch 通过 dependsOn 等待分析完成，并设置 useSampleReference=true。'
    : ''
  const stateRules = [creationRules, revisionRules, pendingRules].filter(Boolean).join('\n\n')
  const readOnlySurface = isReadOnlySurface(input.surfaceMode)
  const skillCards = readOnlySurface
    ? []
    : listV2AgentSkillCards().map(({ id, card }) => ({ id, card }))
  const interactionRule = readOnlySurface
    ? '本轮是创作咨询或普通对话：使用 chat 自然回答；不得创建提案或修改状态，stateActions、skillRequests 和 toolRequests 都返回空数组。'
    : '本轮没有只读限制；仍须根据当前用户原话判断是否获得创建、修改或执行授权。'

  return `你是视频创作平台的导演决策智能体，专门负责理解用户创作意图、维护已确认要求，并把本轮目标规划为讨论、澄清、方案创建、局部修改或成片交付。你只决定本轮意图、作用范围、依赖和 Tool 计划；具体时间线内容由 Planner 生成，执行结果以服务端真实回执为准。

冲突处理顺序：当前用户输入 > 已确认要求 > 服务端权威事实 > 召回偏好与对话摘要。历史信息只用于理解指代和延续，不得在无关轮次主动触发动作；“暂时不要修改”等本轮控制不写入持久要求。

最高优先级：
- ${interactionRule}
- intent 只使用 chat、create、revise、execute、clarify。讨论、建议、评价、假设和只读问答使用 chat，不请求 Tool。
- 只有当前输入明确授权创建、修订或执行时才请求 Tool。交付操作使用 execute；用户明确要求渲染、导出、提交或生成成片即构成本轮授权，服务端仍会做最终权限校验。
- 目标和 ID 只能来自服务端提供的事实；不得编造样例、素材、草稿、版本、项目、用户或时间线对象 ID。
- replyDraft 不得宣称要求或执行动作已成功保存或完成；最终结果以服务端真实回执为准。
- toolRequests 必须完整覆盖用户明确要求且实际受影响的范围，不得遗漏，也不得增加用户未要求的修改。

意图对照示例：
- 征求建议：“我想做一条校园宣传片，你有什么建议？” → intent=chat，自然给出建议，stateActions 和 toolRequests 均为空。
- 采纳建议并创建：“就按刚才建议的方向创建方案。” → intent=create，请求 timeline.plan；先形成可核对的创作摘要，不宣称已经创建。
- 已有草稿修改：“把第二个镜头拆成两个，其他内容不变。” → intent=revise，请求 structure 范围的 timeline.patch；先形成修改提案，不宣称已经修改。
- 同一句中先咨询再明确执行时，回答咨询内容并只为明确授权的动作请求 Tool；不能因为提到视频目标就把咨询本身当成创建授权。

通用判断：
- 单独记录、替换、撤销或查询创作要求时使用 chat；不得因为要求中出现画面、字幕或风格就自动修改草稿。
- sampleVideo 只提供结构、节奏和表达方法参考，materials 才是候选成片素材。
${sampleDependencyRule}
- 只有本轮明确采用当前样例时，timeline.plan 或 timeline.patch 才设置 useSampleReference=true；当前存在样例不等于每次修改都要重新注入样例方法。
- materials 默认只是可选候选。只有用户明确要求本轮方案必须使用某项素材时，才填写 requiredMaterialIds，且 ID 必须来自当前 materials。局部 scene、structure、visual_strategy 只可绑定视觉素材；global.brief_update 不可绑定新素材，只有 global.full_replan 可以。用户没有要求使用的历史素材不得列入。
- 本轮有视觉输入时，结合当前用户的具体问题和创作目标观察真实图片，提取与任务相关的可见事实，用于理解、比较或创意建议；不要机械枚举全部元素，也不得编造不可见事实。只读任务仍使用 chat，不得自动创建方案或渲染。
- 判断画面是否已实现，只依据 timelineFacts 的真实类型、素材和生成任务。image_motion 只能移动或裁剪原图像素；新增动态画面需要 ai_video + generate_video，或确实实现目标效果的已注册画面组件。创作描述不等于已经实现。
- creativeConfigDelta 只填写本轮新确认的参数；服务端给出的最终生效配置优先。
- Tool 的定义、inputSchema 和可用状态以 TOOL_CAPABILITIES_JSON 为准。优先选择 ready 路径；blocked 时说明真实缺失项和 alternatives，不得把局部缺失夸大成整个任务不可执行。

${stateRules}

当前项目要求：
- requirements.update 只维护用户明确要求长期约束当前项目的独立规则；普通咨询、一次创建或修改指令本身已经由 Tool 承接，不要重复写入项目要求。replace/revoke 只能引用 requirements 中的 active id，并填写 targetRequirementId。
- memories 只用于理解用户可能延续的偏好，不是已确认的当前项目要求；偏好沉淀由独立学习链路处理，本轮不要输出偏好操作。

动作、依赖与技能：
- stateActions 和 toolRequests 的 ref 在本轮必须全局唯一。
- 只有存在真实先后关系时才填写 dependsOn；独立动作使用空数组。
- toolRequest.skillId 从该 Tool 允许的技能中选择；skillRequests 只补充额外技能上下文。Tool 参数严格符合 inputSchema，不得增加字段。
- 对滤镜、合成、动画和转场，先按效果语义复用匹配的内置实现或 renderedComponents；确实没有可用实现时才使用 render.author。若同轮应用新组件，对应方案动作必须依赖组件创建结果。

回复与输出：
- replyDraft 只自然说明当前理解、真正待确认的信息或准备执行的内容，不得暴露内部版本、实现名、调用标识、对象 ID 或协议字段。
- 所有自然语言输出必须使用当前用户输入的主要语言，包括 replyDraft、creationSummary、requirements.update 的 statement、skillRequests 的 purpose，以及 Tool arguments 中面向 Planner 的 instruction；不得擅自翻译用户要求。协议字段、ID 和枚举保持原定义。
- missingInformation 只列真正阻塞当前目标的事实。
- missingInformation 非空时使用 clarify，toolRequests 必须为空；不得一边追问阻塞信息，一边猜测答案并创建提案。
- 严格按照给定协议输出 replyDraft、creationSummary、intent、creativeConfigDelta、stateActions、skillRequests、toolRequests、missingInformation，不增加字段。

精简技能卡（SKILL_CARDS_JSON）：
${JSON.stringify(skillCards)}

工具定义、输入 Schema 与当前可用状态（TOOL_CAPABILITIES_JSON）：
${JSON.stringify(toolCapabilitiesForPrompt(input))}

精简当前上下文（COMPACT_CONTEXT_JSON）：
${JSON.stringify(compactDirectorContextForPrompt(input))}

当前用户输入（CURRENT_USER_PROMPT_JSON）：
${JSON.stringify(input.prompt)}

输出前只核对三件事：当前输入是否授权本轮动作；目标和 ID 是否来自权威上下文；toolRequests 是否完整覆盖用户明确要求且实际受影响的范围。只输出最终 JSON。`
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text

  const output = record.output
  if (Array.isArray(output)) {
    const parts: string[] = []
    for (const item of output) {
      if (!item || typeof item !== 'object') continue
      const content = (item as Record<string, unknown>).content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const blockRecord = block as Record<string, unknown>
        if (typeof blockRecord.text === 'string') parts.push(blockRecord.text)
        if (typeof blockRecord.output_text === 'string') parts.push(blockRecord.output_text)
      }
    }
    if (parts.length) return parts.join('\n')
  }

  return ''
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('LLM returned empty text.')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('LLM did not return JSON.')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

/** Exported for the routing smoke test and for a single, audited model boundary. */
export function parseDirectorModelDecision(text: string): LlmIntentResult {
  const decision = LlmIntentResultSchema.parse(extractJson(text))
  return decision.toolRequests.length > 0 && decision.missingInformation.length > 0
    ? {
        ...decision,
        creationSummary: decision.creationSummary
          ? { ...decision.creationSummary, openQuestions: [] }
          : undefined,
        missingInformation: [],
        normalizedActionableQuestion: true,
      }
    : decision
}

function responseAudit(raw: unknown, finalText: string) {
  if (!raw || typeof raw !== 'object') return { output_text: finalText }
  const record = raw as Record<string, unknown>
  return {
    id: record.id,
    model: record.model,
    status: record.status,
    created_at: record.created_at,
    usage: record.usage,
    output_text: finalText,
  }
}

async function prepareDirectorImageInputs(
  context: DirectorContext,
  currentTurnMaterialIds?: string[],
) {
  const allImages = context.materials.filter((material) => material.type === 'image')
  const currentIds = new Set(currentTurnMaterialIds)
  const images = (currentIds.size
    ? allImages.filter((material) => currentIds.has(material.id))
    : []
  )
  return prepareArkImageInputs({
    materials: images.map((image) => ({ id: image.id, name: image.name, source: image.url })),
    maxInputs: MAX_DIRECTOR_IMAGE_INPUTS,
  })
}

export async function callResponsesApi(input: {
  promptText: string
  imageInputs?: ArkResponsesImageInput[]
  previousResponseId?: string
  allowStructuredOutput?: boolean
  structuredOutput?: { name: string; schema: Record<string, unknown> }
  maxOutputTokens?: number
  retryWithoutSchema?: boolean
}): Promise<{
  raw: unknown
  structuredOutput: { requested: boolean; providerFallback: boolean; reason?: string }
}> {
  if (!env.directorAgentApiKey) {
    throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')
  }

  const requested = env.directorAgentStructuredOutputMode === 'auto' && input.allowStructuredOutput !== false
  const structuredOutput = input.structuredOutput ?? {
    name: 'v2_director_decision',
    schema: DirectorDecisionJsonSchema,
  }
  const body = (useSchema: boolean) => ({
    model: env.directorAgentModel,
    ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
    ...(env.directorAgentResponseContinuity && input.previousResponseId
      ? { previous_response_id: input.previousResponseId }
      : {}),
    ...(useSchema
      ? { text: { format: { type: 'json_schema', name: structuredOutput.name, schema: structuredOutput.schema } } }
      : {}),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: input.promptText },
          ...(input.imageInputs ?? []),
        ],
      },
    ],
  })
  const request = async (useSchema: boolean) => fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body(useSchema)),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  let response = await request(requested)
  let text = await response.text()
  const schemaRejected = requested && !response.ok && [400, 404, 422].includes(response.status)
  if (schemaRejected && input.retryWithoutSchema !== false) {
    response = await request(false)
    const retryText = await response.text()
    if (!response.ok) throw new Error(`Responses API returned ${response.status}: ${retryText.slice(0, 500)}`)
    try {
      return {
        raw: JSON.parse(retryText),
        structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) },
      }
    } catch {
      return {
        raw: retryText,
        structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) },
      }
    }
  }
  if (!response.ok) {
    throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  }
  try {
    return { raw: JSON.parse(text), structuredOutput: { requested, providerFallback: false } }
  } catch {
    return { raw: text, structuredOutput: { requested, providerFallback: false } }
  }
}

function validateFinalReply(input: {
  candidate: z.infer<typeof DirectorFinalReplySchema>
  facts: DirectorFinalReplyFact[]
}) {
  if (input.candidate.outcomes.length !== input.facts.length) {
    throw new Error('final reply did not acknowledge every authoritative receipt')
  }
  input.candidate.outcomes.forEach((outcome, index) => {
    const fact = input.facts[index]
    if (!fact || outcome.ref !== fact.ref || outcome.status !== fact.status) {
      throw new Error(`outcome order or status mismatch at index ${index}`)
    }
    if ((index === 0) !== (outcome.connector === '')) {
      throw new Error('only the first outcome may omit its connector')
    }
  })
}

function punctuateReplyPart(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /[。！？!?；;]$/u.test(trimmed) ? trimmed : `${trimmed}。`
}

function finalReplyPrompt(input: {
  userPrompt: string
  replyDraft: string
  facts: DirectorFinalReplyFact[]
}) {
  return [
    '你是直接与视频创作者对话的 AI 导演。请根据已经发生的真实结果，写一段自然、简洁的中文回复。',
    'outcomes 是唯一事实来源；replyDraft 只供参考语气，不能覆盖真实结果。',
    '请为 opening 和 nextStep 各选择一个最合适的安全承接语。outcomes 必须严格保持给定顺序；第一项 connector 必须为空，后续项根据并列或转折关系选择 connector。',
    'outcomes 只返回 ref 和 status；不要复述 summary。服务端会按 ref 放回对应的权威事实，不能改写、对调或遗漏。',
    '不要使用“模块已执行/未执行”式清单。最终回复会由 opening、按你排列的权威结果和 nextStep 组成。',
    '不要向用户展示内部版本号、revision、V2 Timeline、Tool、Skill、Provider、Backend、Worker、调用 ID 或协议字段。',
    '失败、跳过或部分完成时必须如实保留对应 summary，不能把计划、尝试、预览或失败说成已经完成。',
    `用户原话：${JSON.stringify(input.userPrompt)}`,
    `执行前回复草稿：${JSON.stringify(input.replyDraft)}`,
    `权威 outcomes：${JSON.stringify(input.facts)}`,
    '只输出符合给定 JSON Schema 的 JSON。',
  ].join('\n')
}

export async function composeDirectorFinalReply(input: {
  userPrompt: string
  replyDraft: string
  facts: DirectorFinalReplyFact[]
  previousResponseId?: string
  fallbackMessage: string
}): Promise<DirectorFinalReplyResult> {
  let rawText = ''
  try {
    const response = await callResponsesApi({
      promptText: finalReplyPrompt(input),
      previousResponseId: input.previousResponseId,
      maxOutputTokens: 512,
      retryWithoutSchema: false,
      structuredOutput: {
        name: 'v2_director_final_reply',
        schema: DirectorFinalReplyJsonSchema,
      },
    })
    rawText = extractText(response.raw)
    const candidate = DirectorFinalReplySchema.parse(extractJson(rawText))
    validateFinalReply({ candidate, facts: input.facts })
    const message = [
      candidate.opening,
      ...candidate.outcomes.map((outcome, index) => `${outcome.connector}${input.facts[index]?.summary ?? ''}`),
      candidate.nextStep,
    ].map(punctuateReplyPart).filter(Boolean).join('')
    return {
      message,
      source: 'llm',
      responseId: responseIdFrom(response.raw),
      audit: responseAudit(response.raw, rawText),
    }
  } catch (error) {
    return {
      message: input.fallbackMessage,
      source: 'fallback',
      validationError: error instanceof Error ? error.message : String(error),
    }
  }
}

function responseIdFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const id = (payload as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id : undefined
}

function workspaceIntentFor(candidate: LlmIntentResult) {
  return candidate.intent
}

function decisionForSurface(
  candidate: LlmIntentResult,
  surfaceMode?: DirectorSurfaceMode,
): LlmIntentResult {
  if (!isReadOnlySurface(surfaceMode)) return candidate
  return {
    ...candidate,
    intent: 'chat',
    creationSummary: undefined,
    creativeConfigDelta: {},
    stateActions: [],
    skillRequests: [],
    toolRequests: [],
  }
}

function continuityWasRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /previous_response_id|previous response/i.test(message)
}

function executionEffectFor(candidate: LlmIntentResult): DirectorExecutionEffect {
  const effects = candidate.toolRequests.map((request) => findV2AgentTool(request.toolId)?.effect)
  if (effects.includes('delivery')) return 'delivery'
  if (effects.includes('draft')) return 'draft_change'
  if (effects.includes('read')) return 'workspace_change'
  return 'none'
}

function intentResultKind(candidate: LlmIntentResult): DirectorIntentResult['intent'] {
  const toolIds = candidate.toolRequests.map((request) => request.toolId)
  if (toolIds.includes('timeline.render')) return 'render'
  if (toolIds.includes('timeline.patch')) return 'revise_timeline'
  if (toolIds.includes('timeline.plan')) return 'generate_timeline'
  if (toolIds.includes('sample.analyze')) return 'analyze_sample'
  if (toolIds.includes('material.inspect')) return 'analyze_materials'
  if (candidate.intent === 'chat') return 'chat'
  return candidate.intent === 'clarify' ? 'clarify' : 'unknown'
}

function nextActionFor(candidate: LlmIntentResult): DirectorIntentResult['nextAction'] {
  const intent = intentResultKind(candidate)
  if (intent === 'render') return 'RENDER'
  if (intent === 'revise_timeline') return 'REVISE_TIMELINE'
  if (intent === 'generate_timeline') return 'GENERATE_TIMELINE'
  if (intent === 'analyze_sample') return 'ANALYZE_SAMPLE'
  if (candidate.intent === 'clarify') return 'ASK_USER'
  return 'ACKNOWLEDGE'
}

function toDirectorIntentResult(
  candidate: LlmIntentResult,
  context: DirectorContext,
  runtime: DirectorConversationRuntime,
): DirectorIntentResult {
  const creativeConfigDelta = candidate.creativeConfigDelta
  const slotsPatch: Partial<DirectorContextSlots> = {
    ...creativeConfigDelta,
    ...deriveRuntimeSlotStatus(runtime),
    contentDomain: creativeConfigDelta.contentDomain ?? context.slots.contentDomain,
    aspectRatio: context.explicitUiControls?.aspectRatio ?? creativeConfigDelta.aspectRatio ?? context.slots.aspectRatio,
    durationSec: context.explicitUiControls?.durationSec ?? creativeConfigDelta.durationSec ?? context.slots.durationSec,
    styleIntensity: context.explicitUiControls?.styleIntensity ?? creativeConfigDelta.styleIntensity ?? context.slots.styleIntensity,
  }
  return {
    intent: intentResultKind(candidate),
    confidence: candidate.missingInformation.length ? 0.7 : 0.9,
    contentDomain: slotsPatch.contentDomain ?? context.slots.contentDomain,
    slotsPatch,
    modelInferredSlots: creativeConfigDelta,
    missingSlots: candidate.missingInformation,
    requiresConfirmation: candidate.intent === 'clarify' && candidate.missingInformation.length > 0,
    nextAction: nextActionFor(candidate),
    executionEffect: executionEffectFor(candidate),
    assistantMessage: candidate.replyDraft,
    creationSummary: candidate.creationSummary,
    skillRequests: candidate.skillRequests,
    toolRequests: candidate.toolRequests,
  }
}

function fallbackContextFacts(input: {
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  const timeline = summarizeCurrentTimeline(input.context)
  const facts: string[] = []

  if (timeline) {
    facts.push('当前有一份可继续编辑的视频方案')
  }
  if (input.context.sampleVideo?.reference?.summary) {
    facts.push(`样例理解摘要：${input.context.sampleVideo.reference.summary}`)
  }
  if (input.context.materials.length) {
    const names = input.context.materials
      .slice(0, 3)
      .map((item) => item.name ?? item.type)
      .join('、')
    facts.push(`可用素材：${names}${input.context.materials.length > 3 ? ' 等' : ''}`)
  }
  if (!facts.length && input.runtime.hasV2Timeline) {
    facts.push('当前存在可编辑的视频方案')
  }
  return facts
}

function quotedPrompt(prompt: string) {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact
}

/**
 * Model failures are deliberately non-executing. Unlike the retired rule
 * fallback, this response does not infer an operation from keywords: it keeps
 * the user's actual question and only supplies durable V2 context facts.
 */
export function buildDirectorContextFallback(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  reason?: string
}): LlmIntentRouterOutput {
  const facts = fallbackContextFacts(input)
  const question = quotedPrompt(input.prompt)
  const contextLine = facts.length ? ` 当前保留的信息是：${facts.join('；')}。` : ''
  const assistantMessage = question
    ? `我没能可靠完成这轮判断，因此不会擅自把“${question}”变成修改、生成或渲染。${contextLine}`
    : `这一轮无法可靠判断下一步；当前讨论和已有方案都会保留，也不会触发任何执行。${contextLine}`

  return {
    source: 'context_fallback',
    modelCalled: false,
    result: {
      intent: 'clarify',
      confidence: 0,
      contentDomain: input.context.slots.contentDomain,
      slotsPatch: {
        ...deriveRuntimeSlotStatus(input.runtime),
        contentDomain: input.context.slots.contentDomain,
      },
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      executionEffect: 'none',
      assistantMessage,
    },
    fallbackReason: input.reason,
    publicThoughts: ['这一轮没有得到可靠的执行判断；已保留当前问题和方案，也没有开始修改或导出。'],
    stateActions: [],
    missingInformation: [],
  }
}

function safeUnstructuredLlmReply(input: {
  text: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): LlmIntentRouterOutput | undefined {
  const message = input.text.trim()
  if (!message || message.length > 4_000 || /^[{[]/.test(message)) return undefined

  return {
    source: 'llm_unstructured_safe_reply',
    modelCalled: true,
    result: {
      intent: 'clarify',
      confidence: 0.5,
      contentDomain: input.context.slots.contentDomain,
      slotsPatch: {
        ...deriveRuntimeSlotStatus(input.runtime),
        contentDomain: input.context.slots.contentDomain,
      },
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      executionEffect: 'none',
      assistantMessage: message,
    },
    publicThoughts: ['导演模型给出了自由回复；因未返回执行协议，本轮只作为讨论处理。'],
    stateActions: [],
    missingInformation: [],
  }
}

function directorJsonRepairPrompt(input: { invalidText: string; error: string }) {
  return [
    'Repair only the JSON format of the final answer below.',
    'Do not reinterpret the user request, change intent, add/remove business meaning, or propose execution.',
    'Return JSON only, following this schema:',
    JSON.stringify(DirectorDecisionJsonSchema),
    `Parse error: ${input.error}`,
    'Original final answer:',
    input.invalidText,
  ].join('\n')
}

export async function routeDirectorIntentWithLlm(input: {
  prompt: string
  surfaceMode?: DirectorSurfaceMode
  currentTurnId?: string
  currentTurnMaterialIds?: string[]
  context: DirectorContext
  runtime: DirectorConversationRuntime
  previousResponseId?: string
  confirmedRequirements?: ConfirmedRequirement[]
  pendingTimelineRevisions?: DirectorWorkspaceState['pendingTimelineRevisions']
  recentFailure?: DirectorWorkspaceState['recentFailure']
  retrievedCreativeMemories?: CreativeMemorySearchResult
  timelineSpec?: RemotionTimelineSpecV1
}): Promise<LlmIntentRouterOutput> {
  const aspectRatio = input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio
  const [aspectWidth, aspectHeight] = aspectRatio.split(':').map(Number)
  const promotedComponents = isReadOnlySurface(input.surfaceMode)
    ? []
    : await listPromotedComponents(
        input.timelineSpec?.canvas ?? { width: aspectWidth!, height: aspectHeight! },
      )
  if (!env.directorAgentEnabled) {
    return buildDirectorContextFallback({
      ...input,
      reason: 'director agent is disabled',
    })
  }

  let temporaryImageFileIds: string[] = []
  let imageInputWarnings: string[] = []
  let modelCalled = false
  try {
    const imageInputs = await prepareDirectorImageInputs(input.context, input.currentTurnMaterialIds)
    temporaryImageFileIds = imageInputs.temporaryFileIds
    imageInputWarnings = imageInputs.warnings
    const promptText = buildDirectorModelPrompt({
      ...input,
      promotedComponents,
      visualInputCount: imageInputs.content.length,
    })
    modelCalled = true
    const response = await callResponsesApi({
      promptText,
      imageInputs: imageInputs.content,
      previousResponseId: input.previousResponseId,
    })
    const raw = response.raw
    const text = extractText(raw)
    const audit = responseAudit(raw, text)
    let parsed: LlmIntentResult
    try {
      parsed = parseDirectorModelDecision(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const protocolError = { kind: text.trim().startsWith('{') ? 'field_validation' as const : 'json_syntax' as const, message }
      const repairPrompt = directorJsonRepairPrompt({ invalidText: text, error: message })
      let repairAudit: unknown
      try {
        const repairedResponse = await callResponsesApi({ promptText: repairPrompt, allowStructuredOutput: false })
        const repairedText = extractText(repairedResponse.raw)
        repairAudit = responseAudit(repairedResponse.raw, repairedText)
        const repaired = decisionForSurface(
          parseDirectorModelDecision(repairedText),
          input.surfaceMode,
        )
        return {
          source: 'llm', modelCalled: true,
          result: toDirectorIntentResult(repaired, input.context, input.runtime),
          publicThoughts: [], responseId: responseIdFrom(raw),
          modelOutputText: text, modelResponseAudit: audit,
          conversationIntent: workspaceIntentFor(repaired),
          stateActions: repaired.stateActions,
          missingInformation: repaired.missingInformation,
          structuredOutput: response.structuredOutput,
          imageInputWarnings,
          proposalReplyFallbackRequired: repaired.normalizedActionableQuestion,
          jsonRepair: { request: repairPrompt, responseAudit: repairAudit },
        }
      } catch (repairError) {
        const repairMessage = repairError instanceof Error ? repairError.message : String(repairError)
        const safeReply = safeUnstructuredLlmReply({ ...input, text })
        if (safeReply) return {
          ...safeReply, responseId: responseIdFrom(raw), modelOutputText: text, modelResponseAudit: audit,
          protocolError, structuredOutput: response.structuredOutput,
          imageInputWarnings,
          jsonRepair: { request: repairPrompt, responseAudit: repairAudit, protocolError: { kind: 'json_syntax', message: repairMessage } },
        }
      return {
        ...buildDirectorContextFallback({
          ...input,
          reason: 'director model returned no valid response protocol',
        }),
        modelCalled: true,
        responseId: responseIdFrom(raw),
        modelOutputText: text,
        modelResponseAudit: audit,
        protocolError,
        structuredOutput: response.structuredOutput,
        imageInputWarnings,
        jsonRepair: { request: repairPrompt, responseAudit: repairAudit, protocolError: { kind: 'json_syntax', message: repairMessage } },
      }
      }
    }

    parsed = decisionForSurface(parsed, input.surfaceMode)
    return {
      source: 'llm',
      modelCalled: true,
      result: toDirectorIntentResult(parsed, input.context, input.runtime),
      publicThoughts: [],
      responseId: responseIdFrom(raw),
      modelOutputText: text,
      modelResponseAudit: audit,
      conversationIntent: workspaceIntentFor(parsed),
      stateActions: parsed.stateActions,
      missingInformation: parsed.missingInformation,
      structuredOutput: response.structuredOutput,
      imageInputWarnings,
      proposalReplyFallbackRequired: parsed.normalizedActionableQuestion,
    }
  } catch (error) {
    const fallback = buildDirectorContextFallback({
      ...input,
      reason: error instanceof Error ? error.message.slice(0, 500) : 'director model request failed',
    })
    return {
      ...fallback,
      modelCalled,
      imageInputWarnings,
      responseContinuityRejected:
        Boolean(input.previousResponseId) && continuityWasRejected(error),
    }
  } finally {
    await releaseArkImageInputs({ temporaryFileIds: temporaryImageFileIds })
  }
}
