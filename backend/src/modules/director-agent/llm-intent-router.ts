import { z } from 'zod'

import { env } from '../../config/env.js'
import { listV2AgentSkillCards } from '../../pipeline-v2/agent-skills/registry.js'
import { listV2AgentToolCards } from '../../pipeline-v2/agent-tools/registry.js'
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
import type { DirectorWorkspacePatch } from './director-workspace-session.js'

const AspectRatioSchema = z.enum(['9:16', '16:9', '1:1', '4:3'])
const ContentDomainSchema = z.enum([
  'landscape_montage',
  'music_video',
  'product_marketing',
  'general',
])
const IntentSchema = z.enum([
  'analyze_sample',
  'analyze_materials',
  'revise_timeline',
  'generate_timeline',
  'render',
  'clarify',
  'unknown',
])
const NextActionSchema = z.enum([
  'ASK_USER',
  'ANALYZE_SAMPLE',
  'GENERATE_TIMELINE',
  'RENDER',
  'REVISE_TIMELINE',
  'ACKNOWLEDGE',
  'NEED_BACKEND',
  'NEED_SAMPLE',
  'WAIT',
])

const ExecutionEffectSchema = z.enum([
  'none',
  'workspace_change',
  'draft_change',
  'delivery',
])
const WorkspaceIntentSchema = z.enum(['chat', 'create', 'revise', 'execute', 'clarify'])
const V2CreationModeSchema = z.enum(['sample_replicate', 'material_brief', 'text_to_video'])
const DirectorDecisionJsonSchema = {
  type: 'object',
  required: ['intent', 'confidence', 'contentDomain', 'slotsPatch', 'nextAction', 'assistantMessage', 'skillRequests', 'toolRequests'],
  properties: {
    intent: { type: 'string', enum: IntentSchema.options },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    contentDomain: { type: 'string', enum: ContentDomainSchema.options },
    slotsPatch: { type: 'object' },
    missingSlots: { type: 'array', items: { type: 'string' } },
    requiresConfirmation: { type: 'boolean' },
    executionEffect: { type: 'string', enum: ExecutionEffectSchema.options },
    authorizationEvidence: { type: 'string' },
    nextAction: { type: 'string', enum: NextActionSchema.options },
    assistantMessage: { type: 'string' },
    publicThoughts: { type: 'array', items: { type: 'string' } },
    v2CreationMode: { type: 'string', enum: V2CreationModeSchema.options },
    conversationIntent: { type: 'string', enum: WorkspaceIntentSchema.options },
    statePatch: { type: 'object' },
    nextStep: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
    skillRequests: { type: 'array', items: { type: 'object', required: ['skillId', 'purpose'], properties: { skillId: { type: 'string' }, purpose: { type: 'string' } } } },
    toolRequests: { type: 'array', items: { type: 'object', required: ['callId', 'toolId', 'skillId', 'arguments', 'requestedMode'], properties: { callId: { type: 'string' }, toolId: { type: 'string' }, skillId: { type: 'string' }, arguments: { type: 'object' }, requestedMode: { type: 'string', enum: ['preview', 'execute'] } } } },
  },
} as const
const DirectorToolFeedbackJsonSchema = {
  type: 'object',
  required: ['assistantMessage', 'publicThoughts'],
  properties: {
    assistantMessage: { type: 'string', minLength: 1 },
    publicThoughts: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
  additionalProperties: false,
} as const
const DirectorToolFeedbackSchema = z.object({
  assistantMessage: z.string().trim().min(1),
  publicThoughts: z.array(z.string().trim().min(1)).max(4).default([]),
})
const WorkspaceStatePatchSchema = z.object({
  selectedItemId: z.string().nullable().optional(),
  pendingQuestion: z.string().nullable().optional(),
  context: z
    .object({
      userIntent: z
        .object({
          requestedStyle: z.string().nullable().optional(),
          constraints: z.array(z.string()).nullable().optional(),
        })
        .optional(),
    })
    .optional(),
}).default({})

/**
 * Models commonly serialize an omitted optional field as an empty string.
 * Treat blank values as absent at the protocol boundary, before validating a
 * side-effect proposal. This keeps a non-executing conversation from being
 * discarded because it has no authorization evidence to provide.
 */
function optionalNonBlankString(value: unknown): unknown {
  return typeof value === 'string' && !value.trim() ? undefined : value
}

const LlmIntentResultSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  contentDomain: ContentDomainSchema,
  slotsPatch: z
    .object({
      sampleVideoStatus: z.enum(['missing', 'attached', 'parsed']).optional(),
      materialStatus: z.enum(['missing', 'partial', 'ready']).optional(),
      contentDomain: ContentDomainSchema.optional(),
      aspectRatio: AspectRatioSchema.optional(),
      durationSec: z.number().min(1).max(600).optional(),
      styleIntensity: z.enum(['light', 'medium', 'strong']).optional(),
      subtitlePolicy: z.enum(['keep', 'none', 'rewrite']).optional(),
      selectedClipId: z.string().optional(),
      sampleMaterialId: z.string().optional(),
    })
    .default({}),
  missingSlots: z.array(z.string()).default([]),
  requiresConfirmation: z.boolean().default(false),
  nextAction: NextActionSchema,
  executionEffect: ExecutionEffectSchema.default('none'),
  authorizationEvidence: z.preprocess(
    optionalNonBlankString,
    z.string().trim().min(1).optional(),
  ),
  assistantMessage: z.string().min(1),
  publicThoughts: z.array(z.string()).default([]),
  /** Advisory only; effective V2 creation mode is derived from actual inputs. */
  v2CreationMode: V2CreationModeSchema.optional(),
  conversationIntent: WorkspaceIntentSchema.optional(),
  statePatch: WorkspaceStatePatchSchema,
  nextStep: z.enum(['discuss', 'plan_create', 'plan_revise', 'execute', 'await_input']).optional(),
  requirements: z.array(z.string()).default([]),
  skillRequests: z.array(z.object({ skillId: z.string().trim().min(1), purpose: z.string().trim().min(1) })).default([]),
  toolRequests: z.array(z.object({
    callId: z.string().trim().min(1), toolId: z.string().trim().min(1), skillId: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}), requestedMode: z.enum(['preview', 'execute']),
  })).default([]),
})

type LlmIntentResult = z.infer<typeof LlmIntentResultSchema>

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
  proposedV2CreationMode?: z.infer<typeof V2CreationModeSchema>
  structuredOutput?: { requested: boolean; providerFallback: boolean; reason?: string }
  jsonRepair?: {
    request: string
    responseAudit?: unknown
    protocolError?: { kind: 'json_syntax' | 'field_validation'; message: string }
  }
  conversationIntent?: z.infer<typeof WorkspaceIntentSchema>
  statePatch?: DirectorWorkspacePatch
  requirements?: string[]
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
    selectedClipId: timeline.selectedClipId,
    selectedSceneId: timeline.selectedSceneId,
    lastChangeSummary: timeline.lastChangeSummary,
  }
}

function hasCurrentV2Timeline(runtime: DirectorConversationRuntime) {
  return Boolean(runtime.hasV2Timeline)
}

function hasSelectedSampleCandidate(
  runtime: DirectorConversationRuntime,
  candidateId: string | undefined,
) {
  return Boolean(
    candidateId && runtime.sampleCandidates?.some((candidate) => candidate.id === candidateId),
  )
}

export function compactDirectorContextForPrompt(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  const isV2 = hasCurrentV2Timeline(input.runtime)
  const state = input.context.directorState
  const compactDirectorState = state
    ? {
        phase: state.phase,
        sampleStatus: state.sampleStatus,
        materialStatus: state.materialStatus,
        timeline: summarizeCurrentTimeline(input.context),
        lastError: state.lastError
          ? {
              code: state.lastError.code,
              message: state.lastError.message,
              suggestions: state.lastError.suggestions.map((suggestion) => suggestion.label),
            }
          : undefined,
        recentActions: state.actionLedger.slice(-5).map((item) => ({
          type: item.type,
          status: item.status,
          revisionBefore: item.revisionBefore,
          revisionAfter: item.revisionAfter,
          message: item.message,
        })),
      }
    : undefined

  return {
    prompt: input.prompt,
    runtime: input.runtime,
    v2Capabilities: {
      creationModes: ['sample_replicate', 'material_brief', 'text_to_video'],
      videoGenerationProvider: env.v2VideoGenerationProvider,
      videoGenerationConfigured:
        env.v2VideoGenerationProvider !== 'none' &&
        Boolean(env.v2VideoGenerationApiKey),
      textToVideoAvailable:
        env.v2VideoGenerationProvider !== 'none' &&
        Boolean(env.v2VideoGenerationApiKey),
      imageToVideoRequiresPublicImageUrl: true,
    },
    slots: input.context.slots,
    explicitUiControls: input.context.explicitUiControls,
    effectiveCreativeConfig: input.context.effectiveCreativeConfig,
    timelineFacts: input.context.timelineFacts,
    sampleVideo: input.context.sampleVideo
      ? {
          id: input.context.sampleVideo.id,
          name: input.context.sampleVideo.name,
          hasReferenceSummary: Boolean(input.context.sampleVideo.reference),
          hasStyleRecipe: Boolean(input.context.sampleVideo.styleRecipe),
          styleRecipe: input.context.sampleVideo.styleRecipe
            ? {
                pacing: input.context.sampleVideo.styleRecipe.pacing,
                visual_motifs: input.context.sampleVideo.styleRecipe.visual_motifs,
                recommended_presets:
                  input.context.sampleVideo.styleRecipe.recommended_presets,
                timeline_pattern:
                  input.context.sampleVideo.styleRecipe.timeline_pattern.slice(0, 8),
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
    })),
    currentEditableTimeline: summarizeCurrentTimeline(input.context),
    directorState: compactDirectorState,
    userIntent: input.context.userIntent,
    // This is server-owned V2 session memory, never a legacy timeline summary.
    conversationMemory: input.context.conversationSummary,
  }
}

export function buildDirectorModelPrompt(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  return `你是 AI Video Studio 的产品级导演对话 Agent。

你要同时完成两件事：
1. 像专业混剪导演一样自然回应用户，不要模板腔，不要机械说“当前停留在...”，除非用户真的问状态。
2. 在自然回复之外，判断这条消息是否真的授权了系统执行工作。讨论、提问、评价、比较、假设和创作咨询都可以且通常应该不执行任何工作。

业务边界必须遵守：
- sample video 只是结构、风格、节奏来源，不是成片素材。
- reference materials / materials 才是成片候选素材。
- 用户说“只解析/先解析/不要生成/不出片”时，不得生成或渲染。
- 当没有已选样例、但 runtime.sampleCandidates 提供视频候选时，只有用户明确要求把某个视频作为样例理解，才可在 slotsPatch.sampleMaterialId 选择其中一个候选 id；绝不能凭关键词把任意视频自动升格为样例。
- 风景、音乐、氛围向视频不要强行套 Hook/Demo/CTA，可以使用“开篇、推进、高潮、收束”等创作角色。
- 执行前只校验对应分支：解析或复刻样例时需要样例视频；渲染时需要当前 V2 时间线；生成方案可直接使用文字，也可选用样例或素材。
- 你只做意图路由和自然回复，不直接写最终时间线 JSON，不编造不存在的 Remotion preset。
- publicThoughts 是给用户看的简短工作说明，最多 4 条，不要暴露私密推理链。
- assistantMessage 要像真实导演助理说话：具体、短、结合上下文，有下一步建议。

特殊场景：
- 用户问“你是什么/你能做什么”：nextAction 用 ACKNOWLEDGE，assistantMessage 介绍能力。
- 用户问“讲讲分析结果/你看到了什么”：nextAction 用 ACKNOWLEDGE，根据 sample style recipe 或当前计划摘要解释。
- 用户问“怎么做某种风格”：nextAction 用 ACKNOWLEDGE，给创作流程建议。
- 用户说“生成成片/按这个做”：有样例时走 sample_replicate；有图片或视频素材时走 material_brief；只有文字时走 text_to_video。三种情况都可用 GENERATE_TIMELINE，除非生成能力未配置。
- RENDER 是昂贵的交付动作：只有用户明确要求“渲染 / 导出 / 输出 MP4 / 出片”时才用 RENDER。修订同样需要用户表达“把当前方案改成这样 / 采纳这个建议 / 调整并保存”等改变现有方案的意图。仅描述期望、询问“这版会如何呈现 / 是否合适 / 有什么建议 / 为什么这样安排”、评价、比较或提出假设时，都是讨论：executionEffect 必须为 none，nextAction 必须为 ACKNOWLEDGE；可以解释可采用的改法，但不能假装已修改。不要用单个词判断，须按整句话和上下文判断用户是在问、在讨论，还是在要求把建议落入当前方案。
- 用户以直接祈使方式为当前方案指定一个目标状态（例如要求统一、替换、保留、移除、采用、调整某部分）时，即使没有逐字说“修改”，也是修订授权；不要把明确的方案约束误降级为聊天。输出中 intent、conversationIntent、nextStep、nextAction 与 executionEffect 必须表达同一个选择，不能一边说会更新方案、一边把 executionEffect 写成 none。
- 用户说“重新生成方案”：这是重排 V2 时间线方案，nextAction 用 GENERATE_TIMELINE，不要直接渲染。
- 用户说“重新渲染”：这是使用当前 V2 时间线方案出新 MP4，nextAction 用 RENDER。
- 用户说“按提示修改后渲染/先修改再渲染”：优先从提示中抽取 slotsPatch，然后 nextAction 用 RENDER。
- explicitUiControls 是用户在界面中明确选定的硬约束。若它与本轮文字推断冲突，保留 UI 值作为最终采用值；自然回复应说明冲突并请用户在 UI 中确认是否切换，不能悄悄覆盖。

V2 branch rules:
- V2 supports three generation branches: sample_replicate when a sample video is available, material_brief when only user text/materials are available, and text_to_video when the user only provides text.
- Do not require a sample video for GENERATE_TIMELINE. A sample video is only mandatory for ANALYZE_SAMPLE or when the user explicitly asks to copy/analyze a sample.
- Do not require user visual materials for GENERATE_TIMELINE. If no visual material is available, use text_to_video and let the video generation adapter create visual material from the prompt.
- If textToVideoAvailable is false and the user provides no visual material, explain that the system can draft an editable timeline but cannot create realistic generated footage until the video generation provider is configured.

Conversation freedom rules:
- 如果用户是在聊天、咨询方案、解释结果、问你能做什么、讨论项目设计，不要因为缺样例或缺素材而要求上传；先自然回答问题，再给一个可选下一步。
- clarify 只用于缺失的信息确实阻塞当前目标时；提出“还可以继续细化/也可以补充素材”的可选建议不是澄清，不得写 pendingQuestion，conversationIntent 应为 chat。
- 只有用户明确要执行“解析样例 / 生成方案 / 渲染导出 / 修改时间线方案”时，才检查该动作对应的条件；不要把样例或素材当成所有生成路径的前置条件。
- 不要根据孤立关键词决定是否执行；要理解整句话是在提问、讨论、提出假设，还是在授权执行。
- assistantMessage 不要复述内部状态机、slot、nextAction 或置信度；这些只放在 debug/publicThoughts。
- 缺少条件时也要像协作伙伴一样说明“现在能聊什么、下一步补什么”，不要只说固定模板。

Revision / state machine rules:
- directorState.phase tells you where the product currently is; do not answer as if starting from scratch.
- directorState.timeline is the editable timeline state. currentRevision is its draft revision, savedRevision is the persisted revision, renderedRevision belongs to the completed render task.
- If renderedRevision is lower than currentRevision, tell the user the成片 is older and needs "重新渲染" to reflect the latest right-panel edits.
- If directorState.timeline.status is dirty, mention unsaved draft edits when the user asks whether changes took effect.
- If the user refers to "上一步/刚才/撤销/改回去", use timeline.lastChangeSummary and recentActions.
- If directorState.lastError exists, prefer one recovery suggestion over repeating raw logs.

输出 JSON schema：
{
  "intent": "analyze_sample|analyze_materials|revise_timeline|generate_timeline|render|clarify|unknown",
  "confidence": 0.0,
  "contentDomain": "landscape_montage|music_video|product_marketing|general",
  "slotsPatch": {
    "aspectRatio": "9:16|16:9|1:1|4:3",
    "durationSec": 10,
    "styleIntensity": "light|medium|strong",
    "subtitlePolicy": "keep|none|rewrite",
  },
  "missingSlots": [],
  "requiresConfirmation": false,
  "executionEffect": "none|workspace_change|draft_change|delivery",
  "authorizationEvidence": "仅在 executionEffect 不是 none 时，摘录用户明确授权执行的原话；否则省略",
  "nextAction": "ASK_USER|ANALYZE_SAMPLE|GENERATE_TIMELINE|RENDER|REVISE_TIMELINE|ACKNOWLEDGE|NEED_BACKEND|NEED_SAMPLE|WAIT",
  "assistantMessage": "自然中文回复",
  "publicThoughts": ["给用户看的简短步骤"],
  "v2CreationMode": "sample_replicate|material_brief|text_to_video（仅说明建议；实际分支由服务端真实输入决定）",
  "conversationIntent": "chat|create|revise|execute|clarify",
  "statePatch": {
    "selectedItemId": "only when the user explicitly selects an item",
    "pendingQuestion": "only when essential information is missing",
    "context": { "userIntent": { "requestedStyle": "optional", "constraints": ["only newly confirmed constraints"] } }
  },
  "nextStep": "discuss|plan_create|plan_revise|execute|await_input",
  "requirements": ["only facts essential for the requested next step"],
  "skillRequests": [{"skillId": "one available Skill id", "purpose": "why this Skill is needed now"}],
  "toolRequests": [{
    "callId": "stable unique id for this turn",
    "toolId": "one available Tool id",
    "skillId": "must also appear in skillRequests",
    "arguments": {"follow": "the Tool inputSchema exactly"},
    "requestedMode": "preview|execute"
  }]
}

当前上下文：
Tool / Skill policy:
- skillRequests and toolRequests are server proposals, never proof that a tool ran. For chat or advice, return empty arrays.
- Every toolRequests[].skillId must also appear in skillRequests and must be allowed by that Skill. Follow each Tool inputSchema exactly; do not add undeclared arguments.
- Select only the Skill needed for the current Tool stage. Dependencies are loaded by the backend and must not be requested as primary Skills.
- assistantMessage before Tool execution may say what you are about to do, but must not claim that the Tool already succeeded. A second model pass will receive the real Tool results and produce the final reply.
- An explicitly authorized creation may request timeline.plan in preview mode. A narrow subtitle edit may request timeline.patch only with {"scope":"subtitle"}. A delivery request needs timeline.render in execute mode and explicit authorization.
- Use only the cards below. Never request planned, disabled, arbitrary, or internal pipeline tools. Select skills for the current phase only.

Available Skill cards:
${JSON.stringify(listV2AgentSkillCards())}

Available Tool cards:
${JSON.stringify(listV2AgentToolCards())}

Current context:
${JSON.stringify(compactDirectorContextForPrompt(input), null, 2)}

只输出 JSON，不要 Markdown，不要解释。`
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
  const value = extractJson(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return LlmIntentResultSchema.parse(value)
  const candidate = { ...(value as Record<string, unknown>) }
  const slots = candidate.slotsPatch
  if (slots && typeof slots === 'object' && !Array.isArray(slots)) {
    const normalizedSlots = { ...(slots as Record<string, unknown>) }
    const legacyMode = normalizedSlots.generationMode
    delete normalizedSlots.generationMode
    candidate.slotsPatch = normalizedSlots
    if (candidate.v2CreationMode === undefined && V2CreationModeSchema.safeParse(legacyMode).success) {
      candidate.v2CreationMode = legacyMode
    }
  }
  return LlmIntentResultSchema.parse(candidate)
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

async function callResponsesApi(input: {
  promptText: string
  previousResponseId?: string
  allowStructuredOutput?: boolean
  structuredOutput?: { name: string; schema: Record<string, unknown> }
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
    ...(env.directorAgentResponseContinuity && input.previousResponseId
      ? { previous_response_id: input.previousResponseId }
      : {}),
    ...(useSchema
      ? { text: { format: { type: 'json_schema', name: structuredOutput.name, schema: structuredOutput.schema } } }
      : {}),
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: input.promptText }],
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
  if (schemaRejected) {
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

export interface DirectorToolFeedbackInput {
  prompt: string
  previousResponseId?: string
  initialAssistantMessage: string
  workspaceFacts: unknown
  selectedSkills: Array<{ id: string; version: string; hash: string }>
  toolResults: Array<{
    callId: string
    toolId: string
    ok: boolean
    summary: string
    output?: unknown
    recovery?: string
  }>
}

export interface DirectorToolFeedbackOutput {
  assistantMessage: string
  publicThoughts: string[]
  modelCalled: boolean
  responseId?: string
  responseAudit?: unknown
  fallbackReason?: string
  jsonRepair?: { request: string; responseAudit?: unknown; error?: string }
  responseContinuityRejected?: boolean
}

function groundedToolFeedbackFallback(input: DirectorToolFeedbackInput, reason: string): DirectorToolFeedbackOutput {
  const failed = input.toolResults.find((result) => !result.ok)
  const completed = input.toolResults.filter((result) => result.ok)
  const assistantMessage = failed
    ? `本轮没有完成所请求的操作：${failed.summary}${failed.recovery ? ` ${failed.recovery}` : ''}`
    : completed.length
      ? completed.map((result) => result.summary).join('；')
      : input.initialAssistantMessage
  return {
    assistantMessage,
    publicThoughts: ['已按真实 Tool 结果生成保守回复。'],
    modelCalled: true,
    fallbackReason: reason,
  }
}

/**
 * Completes the Agent loop after external state has changed. The first model
 * call chooses Skills and Tools; this second call can only explain actual
 * results and cannot propose or execute another Tool.
 */
export async function respondToDirectorToolResultsWithLlm(
  input: DirectorToolFeedbackInput,
): Promise<DirectorToolFeedbackOutput> {
  const facts = JSON.stringify({
    user_prompt: input.prompt,
    initial_model_reply: input.initialAssistantMessage,
    workspace_facts_after_tools: input.workspaceFacts,
    selected_skills: input.selectedSkills,
    actual_tool_results: input.toolResults,
  }).slice(0, 16_000)
  const promptText = [
    'You are the V2 director after the backend has finished the model-selected Tool stage.',
    'Reply naturally in Chinese and ground every claim in actual_tool_results and workspace_facts_after_tools.',
    'Do not claim success for a failed Tool. Do not claim a draft, render, material analysis, or output that is absent.',
    'If a Tool failed, explain the real failure and one concrete recovery. Do not request or propose another Tool in this response.',
    'Return JSON only with assistantMessage and publicThoughts.',
    facts,
  ].join('\n')

  try {
    const response = await callResponsesApi({
      promptText,
      previousResponseId: input.previousResponseId,
      structuredOutput: {
        name: 'v2_director_tool_feedback',
        schema: DirectorToolFeedbackJsonSchema,
      },
    })
    const text = extractText(response.raw)
    try {
      const parsed = DirectorToolFeedbackSchema.parse(extractJson(text))
      return {
        ...parsed,
        modelCalled: true,
        responseId: responseIdFrom(response.raw),
        responseAudit: responseAudit(response.raw, text),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const repairPrompt = [
        'Repair only the JSON syntax/shape of this Tool-result reply.',
        'Do not change whether any Tool succeeded or failed and do not invent results.',
        JSON.stringify(DirectorToolFeedbackJsonSchema),
        `Validation error: ${message}`,
        text,
      ].join('\n')
      try {
        const repaired = await callResponsesApi({
          promptText: repairPrompt,
          allowStructuredOutput: false,
        })
        const repairedText = extractText(repaired.raw)
        const parsed = DirectorToolFeedbackSchema.parse(extractJson(repairedText))
        return {
          ...parsed,
          modelCalled: true,
          responseId: responseIdFrom(response.raw),
          responseAudit: responseAudit(response.raw, text),
          jsonRepair: { request: repairPrompt, responseAudit: responseAudit(repaired.raw, repairedText) },
        }
      } catch (repairError) {
        return {
          ...groundedToolFeedbackFallback(input, 'tool feedback protocol repair failed'),
          responseId: responseIdFrom(response.raw),
          responseAudit: responseAudit(response.raw, text),
          jsonRepair: {
            request: repairPrompt,
            error: repairError instanceof Error ? repairError.message : String(repairError),
          },
        }
      }
    }
  } catch (error) {
    return {
      ...groundedToolFeedbackFallback(
        input,
        error instanceof Error ? error.message : String(error),
      ),
      responseContinuityRejected:
        Boolean(input.previousResponseId) && continuityWasRejected(error),
    }
  }
}

function responseIdFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const id = (payload as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id : undefined
}

function workspaceIntentFor(candidate: LlmIntentResult): z.infer<typeof WorkspaceIntentSchema> {
  if (candidate.conversationIntent) return candidate.conversationIntent
  if (candidate.executionEffect !== 'none') {
    if (candidate.nextAction === 'RENDER') return 'execute'
    if (candidate.nextAction === 'REVISE_TIMELINE') return 'revise'
    return 'create'
  }
  return candidate.intent === 'clarify' ? 'clarify' : 'chat'
}

/**
 * The model owns the semantic decision. This only detects internally
 * contradictory structured fields before an external action can run.
 */
export function directorDecisionConsistencyIssue(candidate: LlmIntentResult): string | undefined {
  const claimsPlanChange =
    candidate.conversationIntent === 'create' ||
    candidate.conversationIntent === 'revise' ||
    candidate.nextStep === 'plan_create' ||
    candidate.nextStep === 'plan_revise' ||
    candidate.nextAction === 'GENERATE_TIMELINE' ||
    candidate.nextAction === 'REVISE_TIMELINE'
  if (claimsPlanChange && candidate.executionEffect !== 'draft_change') {
    return 'The decision claims a timeline create/revise action but executionEffect is not draft_change.'
  }
  if (candidate.executionEffect === 'draft_change' && !['GENERATE_TIMELINE', 'REVISE_TIMELINE'].includes(candidate.nextAction)) {
    return 'draft_change requires a timeline create/revise nextAction.'
  }
  return undefined
}

function continuityWasRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /previous_response_id|previous response/i.test(message)
}

function toDirectorIntentResult(candidate: LlmIntentResult): DirectorIntentResult {
  const slotsPatch: Partial<DirectorContextSlots> = {
    ...candidate.slotsPatch,
    contentDomain: candidate.slotsPatch.contentDomain ?? candidate.contentDomain,
  }

  let nextAction = candidate.nextAction
  let requiresConfirmation = candidate.requiresConfirmation
  let missingSlots = candidate.missingSlots

  if (candidate.confidence < 0.5 && nextAction !== 'NEED_BACKEND' && nextAction !== 'NEED_SAMPLE') {
    nextAction = 'ASK_USER'
    requiresConfirmation = true
    missingSlots = Array.from(new Set([...missingSlots, 'userIntent']))
  }

  return {
    intent: candidate.intent,
    confidence: candidate.confidence,
    contentDomain: candidate.contentDomain,
    slotsPatch,
    missingSlots,
    requiresConfirmation,
    nextAction,
    executionEffect: candidate.executionEffect,
    authorizationEvidence: candidate.authorizationEvidence,
    assistantMessage: candidate.assistantMessage,
    skillRequests: candidate.skillRequests,
    toolRequests: candidate.toolRequests,
  }
}

function actionMatchesExecutionEffect(
  effect: DirectorExecutionEffect,
  nextAction: DirectorIntentResult['nextAction'],
  intent: DirectorIntentResult['intent'],
) {
  if (effect === 'none') return true
  if (effect === 'workspace_change') {
    return nextAction === 'ANALYZE_SAMPLE' || intent === 'analyze_materials'
  }
  if (effect === 'draft_change') {
    return nextAction === 'GENERATE_TIMELINE' || nextAction === 'REVISE_TIMELINE'
  }
  return nextAction === 'RENDER'
}

/**
 * This is the execution seam: the model interprets language, while code only
 * validates the proposed side effect against runtime facts and V2 invariants.
 * It deliberately does not inspect user wording or maintain keyword lists.
 */
export function finalizeModelDecision(input: {
  llmResult: DirectorIntentResult
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): DirectorIntentResult {
  const { llmResult, context, runtime } = input
  const effect = llmResult.executionEffect ?? 'none'
  const runtimeSlots = deriveRuntimeSlotStatus(runtime)
  const slotsPatch = {
    ...llmResult.slotsPatch,
    ...runtimeSlots,
    contentDomain: llmResult.contentDomain,
    aspectRatio: context.explicitUiControls?.aspectRatio ?? llmResult.slotsPatch.aspectRatio ?? context.slots.aspectRatio,
    durationSec: context.explicitUiControls?.durationSec ?? llmResult.slotsPatch.durationSec ?? context.slots.durationSec,
    styleIntensity: context.explicitUiControls?.styleIntensity ?? llmResult.slotsPatch.styleIntensity ?? context.slots.styleIntensity,
  }

  if (effect === 'none') {
    return {
      ...llmResult,
      modelInferredSlots: llmResult.slotsPatch,
      slotsPatch,
      nextAction: 'ACKNOWLEDGE',
      missingSlots: [],
      requiresConfirmation: false,
      executionEffect: 'none',
      authorizationEvidence: undefined,
    }
  }

  if (!actionMatchesExecutionEffect(effect, llmResult.nextAction, llmResult.intent)) {
    return {
      ...llmResult,
      modelInferredSlots: llmResult.slotsPatch,
      slotsPatch,
      intent: 'clarify',
      nextAction: 'ASK_USER',
      missingSlots: [],
      requiresConfirmation: false,
      executionEffect: 'none',
      authorizationEvidence: undefined,
      assistantMessage: `${llmResult.assistantMessage}\n\n如果你希望我实际执行，请直接确认要生成新方案、修改当前方案，或渲染当前版本。`,
    }
  }

  if (!runtime.backendEnabled) {
    return {
      ...llmResult,
      modelInferredSlots: llmResult.slotsPatch,
      slotsPatch,
      nextAction: 'NEED_BACKEND',
      missingSlots: ['backend'],
      requiresConfirmation: false,
      executionEffect: 'none',
    }
  }

  if (
    effect === 'workspace_change' &&
    (
      llmResult.nextAction === 'ANALYZE_SAMPLE' ||
      llmResult.toolRequests?.some((request) => request.toolId === 'sample.analyze')
    ) &&
    !runtime.sampleUrl.trim() &&
    !hasSelectedSampleCandidate(runtime, llmResult.slotsPatch.sampleMaterialId)
  ) {
    return {
      ...llmResult,
      modelInferredSlots: llmResult.slotsPatch,
      slotsPatch,
      nextAction: 'NEED_SAMPLE',
      missingSlots: ['sampleVideoStatus'],
      requiresConfirmation: false,
      executionEffect: 'none',
    }
  }

  if (effect === 'delivery' && !hasCurrentV2Timeline(runtime)) {
    return {
      ...llmResult,
      modelInferredSlots: llmResult.slotsPatch,
      slotsPatch,
      nextAction: 'ASK_USER',
      missingSlots: ['timeline'],
      requiresConfirmation: false,
      executionEffect: 'none',
      assistantMessage: '当前还没有可交付的 V2 时间线版本。先生成或采用一版方案后，我才能为你渲染。',
    }
  }

  return { ...llmResult, modelInferredSlots: llmResult.slotsPatch, slotsPatch }
}

function fallbackContextFacts(input: {
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  const timeline = summarizeCurrentTimeline(input.context)
  const facts: string[] = []

  if (timeline) {
    const revision = timeline.currentRevision ?? timeline.savedRevision
    facts.push(
      revision == null
        ? `当前有一版 ${timeline.kind} 草稿`
        : `当前有一版 ${timeline.kind} 草稿（修订 ${revision}）`,
    )
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
    facts.push('当前存在可编辑的 V2 时间线')
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
  const contextLine = facts.length ? ` 当前保留的 V2 事实是：${facts.join('；')}。` : ''
  const assistantMessage = question
    ? `我没能可靠完成这轮判断，因此不会擅自把“${question}”变成修改、生成或渲染。${contextLine}`
    : `这一轮无法可靠判断下一步；当前讨论和已有 V2 方案都会保留，也不会触发任何执行。${contextLine}`

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
    publicThoughts: ['本轮未得到可执行模型决策；已保留问题与 V2 上下文，未触发工作流。'],
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

function directorConsistencyRepairPrompt(input: { originalText: string; issue: string }) {
  return [
    'Repair only a contradictory V2 director decision JSON.',
    'Keep the user-facing meaning and do not invent an operation.',
    'The fields intent, conversationIntent, nextStep, nextAction, and executionEffect must describe one coherent choice.',
    'For a discussion choose chat/discuss/ACKNOWLEDGE/none. For a timeline create or revise choose the matching plan action/draft_change. Return JSON only using the original response schema.',
    `Consistency issue: ${input.issue}`,
    'Original final answer:',
    input.originalText,
  ].join('\n')
}

export async function routeDirectorIntentWithLlm(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  previousResponseId?: string
}): Promise<LlmIntentRouterOutput> {
  if (!env.directorAgentEnabled) {
    return buildDirectorContextFallback({
      ...input,
      reason: 'director agent is disabled',
    })
  }

  try {
    const response = await callResponsesApi({
      promptText: buildDirectorModelPrompt(input),
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
        const repaired = parseDirectorModelDecision(repairedText)
        const guarded = finalizeModelDecision({
          llmResult: toDirectorIntentResult(repaired), context: input.context, runtime: input.runtime,
        })
        return {
          source: 'llm', modelCalled: true, result: guarded,
          publicThoughts: repaired.publicThoughts.slice(0, 4), responseId: responseIdFrom(raw),
          modelOutputText: text, modelResponseAudit: audit,
          conversationIntent: workspaceIntentFor(repaired), statePatch: repaired.statePatch as DirectorWorkspacePatch,
          requirements: repaired.requirements, proposedV2CreationMode: repaired.v2CreationMode,
          structuredOutput: response.structuredOutput,
          jsonRepair: { request: repairPrompt, responseAudit: repairAudit },
        }
      } catch (repairError) {
        const repairMessage = repairError instanceof Error ? repairError.message : String(repairError)
        const safeReply = safeUnstructuredLlmReply({ ...input, text })
        if (safeReply) return {
          ...safeReply, responseId: responseIdFrom(raw), modelOutputText: text, modelResponseAudit: audit,
          protocolError, structuredOutput: response.structuredOutput,
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
        jsonRepair: { request: repairPrompt, responseAudit: repairAudit, protocolError: { kind: 'json_syntax', message: repairMessage } },
      }
      }
    }
    const consistencyIssue = directorDecisionConsistencyIssue(parsed)
    if (consistencyIssue) {
      const repairPrompt = directorConsistencyRepairPrompt({ originalText: text, issue: consistencyIssue })
      let repairAudit: unknown
      try {
        const repairedResponse = await callResponsesApi({ promptText: repairPrompt, allowStructuredOutput: false })
        const repairedText = extractText(repairedResponse.raw)
        repairAudit = responseAudit(repairedResponse.raw, repairedText)
        const repaired = parseDirectorModelDecision(repairedText)
        const repairedIssue = directorDecisionConsistencyIssue(repaired)
        if (repairedIssue) throw new Error(repairedIssue)
        const guarded = finalizeModelDecision({
          llmResult: toDirectorIntentResult(repaired), context: input.context, runtime: input.runtime,
        })
        return {
          source: 'llm', modelCalled: true, result: guarded,
          publicThoughts: repaired.publicThoughts.slice(0, 4), responseId: responseIdFrom(raw),
          modelOutputText: text, modelResponseAudit: audit,
          conversationIntent: workspaceIntentFor(repaired), statePatch: repaired.statePatch as DirectorWorkspacePatch,
          requirements: repaired.requirements, proposedV2CreationMode: repaired.v2CreationMode,
          structuredOutput: response.structuredOutput,
          jsonRepair: { request: repairPrompt, responseAudit: repairAudit, protocolError: { kind: 'field_validation', message: consistencyIssue } },
        }
      } catch (repairError) {
        return {
          ...buildDirectorContextFallback({ ...input, reason: 'director decision fields were contradictory' }),
          modelCalled: true, responseId: responseIdFrom(raw), modelOutputText: text, modelResponseAudit: audit,
          protocolError: { kind: 'field_validation', message: repairError instanceof Error ? repairError.message : String(repairError) },
          structuredOutput: response.structuredOutput,
          jsonRepair: { request: repairPrompt, responseAudit: repairAudit, protocolError: { kind: 'field_validation', message: consistencyIssue } },
        }
      }
    }
    const guarded = finalizeModelDecision({
      llmResult: toDirectorIntentResult(parsed),
      context: input.context,
      runtime: input.runtime,
    })

    return {
      source: 'llm',
      modelCalled: true,
      result: guarded,
      publicThoughts: parsed.publicThoughts.slice(0, 4),
      responseId: responseIdFrom(raw),
      modelOutputText: text,
      modelResponseAudit: audit,
      conversationIntent: workspaceIntentFor(parsed),
      statePatch: parsed.statePatch as DirectorWorkspacePatch,
      requirements: parsed.requirements,
      proposedV2CreationMode: parsed.v2CreationMode,
      structuredOutput: response.structuredOutput,
    }
  } catch (error) {
    const fallback = buildDirectorContextFallback({
      ...input,
      reason: error instanceof Error ? error.name : 'director model request failed',
    })
    return {
      ...fallback,
      modelCalled: true,
      responseContinuityRejected:
        Boolean(input.previousResponseId) && continuityWasRejected(error),
    }
  }
}
