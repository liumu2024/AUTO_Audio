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
import type { ConfirmedRequirement } from '../../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
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
const MemoryActionEvidenceFields = {
  ref: z.string().trim().min(1).max(80),
  sourceTurnIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  sourceExcerpt: z.string().trim().min(1).max(1_000).optional(),
} as const
const MemoryActionSchema = z.discriminatedUnion('operation', [
  z.object({
    ...MemoryActionEvidenceFields,
    operation: z.literal('add'),
    scopeType: z.enum(['user', 'draft']),
    statement: z.string().trim().min(1).max(500),
    status: z.enum(['active', 'candidate']),
    origin: z.enum(['explicit', 'inferred']),
  }).strict(),
  z.object({
    ...MemoryActionEvidenceFields,
    operation: z.literal('replace'),
    targetMemoryId: z.string().trim().min(1),
    statement: z.string().trim().min(1).max(500),
    status: z.enum(['active', 'candidate']),
    origin: z.enum(['explicit', 'inferred']),
  }).strict(),
  z.object({
    ...MemoryActionEvidenceFields,
    operation: z.literal('revoke'),
    targetMemoryId: z.string().trim().min(1),
  }).strict(),
])
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
  creativeConfigDelta: CreativeConfigDeltaSchema.default({}),
  stateActions: z.array(StateActionSchema).max(1).default([]),
  memoryActions: z.array(MemoryActionSchema).max(20).default([]),
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
])

const DirectorDecisionJsonSchema = z.toJSONSchema(LlmIntentResultSchema, {
  target: 'draft-7',
}) as Record<string, unknown>

type LlmIntentResult = z.infer<typeof LlmIntentResultSchema>
export type DirectorStateAction = z.infer<typeof StateActionSchema>
export type DirectorMemoryAction = z.infer<typeof MemoryActionSchema>

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
  jsonRepair?: {
    request: string
    responseAudit?: unknown
    protocolError?: { kind: 'json_syntax' | 'field_validation'; message: string }
  }
  conversationIntent?: z.infer<typeof CanonicalIntentSchema>
  stateActions: DirectorStateAction[]
  memoryActions: DirectorMemoryAction[]
  missingInformation: string[]
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

export function compactDirectorContextForPrompt(input: {
  prompt: string
  currentTurnId?: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  confirmedRequirements?: ConfirmedRequirement[]
  retrievedCreativeMemories?: CreativeMemorySearchResult
  promotedComponents?: RenderComponentSummary[]
  timelineSpec?: RemotionTimelineSpecV1
}) {
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
    currentTurnId: input.currentTurnId,
    runtime: input.runtime,
    capabilitySnapshot: listV2AgentToolCards().map((tool) =>
      evaluateV2AgentToolReadiness({
        toolId: tool.id,
        context: input.context,
        runtime: input.runtime,
        workspace: {
          draftId: input.context.currentTimeline?.draftId,
          baseRevision: input.context.currentTimeline?.currentRevision,
        },
        timelineSpec: input.timelineSpec,
      })),
    slots: input.context.slots,
    explicitUiControls: input.context.explicitUiControls,
    effectiveCreativeConfig: input.context.effectiveCreativeConfig,
    timelineFacts: input.context.timelineFacts,
    sampleVideo: input.context.sampleVideo
      ? {
          id: input.context.sampleVideo.id,
          name: input.context.sampleVideo.name,
          hasReferenceSummary: Boolean(input.context.sampleVideo.reference),
          reference: input.context.sampleVideo.reference
            ? {
                summary: input.context.sampleVideo.reference.summary,
                atmosphere: input.context.sampleVideo.reference.atmosphere,
                editing: input.context.sampleVideo.reference.editing,
                rhythm: input.context.sampleVideo.reference.rhythm,
                reusableStyle: input.context.sampleVideo.reference.reusableStyle,
                segmentCount: input.context.sampleVideo.reference.segmentCount,
                shotCount: input.context.sampleVideo.reference.shotCount,
                warnings: input.context.sampleVideo.reference.warnings,
              }
            : undefined,
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
    activeRequirements: (input.confirmedRequirements ?? [])
      .filter((item) => item.status === 'active'),
    recentRequirementChanges: (input.confirmedRequirements ?? [])
      .filter((item) => item.status !== 'active')
      .slice(-20),
    retrievedCreativeMemories: {
      active: (input.retrievedCreativeMemories?.active ?? []).map((item) => ({
        id: item.memory.id,
        scopeType: item.memory.scopeType,
        draftId: item.memory.draftId,
        statement: item.memory.statement,
        sourceExcerpt: item.memory.sourceExcerpt,
      })),
      candidate: (input.retrievedCreativeMemories?.candidate ?? []).map((item) => ({
        id: item.memory.id,
        scopeType: item.memory.scopeType,
        draftId: item.memory.draftId,
        statement: item.memory.statement,
        sourceExcerpt: item.memory.sourceExcerpt,
      })),
    },
    // This is server-owned V2 session memory, never a legacy timeline summary.
    conversationMemory: input.context.conversationSummary,
    renderedComponents: input.promotedComponents ?? [],
  }
}

export function buildDirectorModelPrompt(input: {
  prompt: string
  currentTurnId?: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  confirmedRequirements?: ConfirmedRequirement[]
  retrievedCreativeMemories?: CreativeMemorySearchResult
  promotedComponents?: RenderComponentSummary[]
  timelineSpec?: RemotionTimelineSpecV1
}) {
  return `你是 AI Video Studio 的导演 Agent。请自然理解当前输入，并结合结构化事实和历史上下文处理指代、延续与冲突。

信息优先级：
1. 当前输入决定本轮目标、修改范围和执行授权。
2. 已确认结构化要求持续有效，直到用户明确替换或撤销。
3. 历史摘要和最近对话只帮助理解“它、刚才那版、第二段、沿用之前风格”等表达，不能在当前无关轮次主动触发状态更新或 Tool。
4. “暂时不要修改草稿”等本轮控制不是持久创作要求。

决策规则：
- intent 只使用 chat、create、revise、execute、clarify。讨论、建议、评价、假设和只读问答使用 chat，不请求 Tool。
- 如果当前输入唯一要求是记录、替换、撤销或查询创作要求，intent 必须为 chat 且 toolRequests 必须为空；create/revise 只表示用户同时明确要求创建或修订可编辑草稿，不能因要求文本出现“画面、字幕、风格”等词就主动执行。
- 只有当前输入明确授权创建、修订或执行时才请求 Tool；渲染、导出等交付操作必须使用 execute。用户明确命令“渲染、导出、提交、生成成片”等交付动作即本轮授权，不要再次询问（服务端仍会执行最终权限校验）。
- capabilitySnapshot 是服务端权威能力事实。不要从缺少某类素材推导整个任务不可执行；优先选择 ready 路径。blocked 时说明具体缺失项和 alternatives。
- sample video 是结构和风格参考，materials 才是候选成片素材。模型不得填写样例、素材、草稿、版本、项目或用户 ID；这些由服务端绑定。
- 当 Current context 声明本轮已附加视觉输入时，必须直接观察图片回答内容、比较或创意建议；不得声称无法读取图片。只读问答仍使用 chat，不能因此创建或渲染。
- 回答当前方案“哪些内容会由 AI 生成”或判断方案是否实现画面要求时，只能依据 timelineFacts 的 type、assetId 和 materialJobs：image_motion 只能移动或裁剪原图像素，不能生成原图中不存在的内容；只有 ai_video 配套 generate_video（或明确实现该效果的已注册 scene 组件）才算新增动态画面。不得把 creative_intent 的文字描述当成已实现结果。
- creativeConfigDelta 只写本轮新确认的创作参数；UI 明确值优先，不能被模型覆盖。
- 用户明确要求记录、替换或撤销创作要求时，输出一个 requirements.update stateAction。replace/revoke 只能使用 activeRequirements 中的 id，并填写 targetRequirementId；不得使用字幕、场景、素材、样例或草稿 ID。
- stateActions 和 toolRequests 使用本轮局部 ref。Tool 只有真实依赖前序状态或 Tool 结果时才写 dependsOn；独立动作使用空数组。
- 用户用“只有 A 成功后才做 B、先 A 再基于结果 B”等条件明确建立依赖时，B 的 dependsOn 必须引用 A 的 ref；不能因为同轮返回就省略真实依赖。
- 每个 toolRequest 的 skillId 是该 Tool 的主 Skill 选择；skillRequests 只用于本轮额外需要的 Skill 上下文，不要重复声明 Tool 已选择的主 Skill。
- replyDraft 不能声称要求、长期知识或 Tool 已成功保存/执行，服务端会根据实际 receipts 生成最终回复。
- missingInformation 只列出真正阻塞当前目标的事实；可选补充不算阻塞。
- Tool arguments 必须严格符合 Tool 卡片中的 inputSchema，不得增加字段。
- 用户在本轮明确请求修改草稿（改字幕、换转场、换视觉策略、重排镜头）即为本轮执行授权；draft 修订不需要再次确认，直接选择 timeline.patch 执行。
- 用户表达的效果需求（滤镜、合成、动画、转场）超出预置集时：先查 Current context 中 renderedComponents 清单，有则用 custom_render 引用；没有则通过 render.author 创作组件（用户无需明确要求写代码）。
- render.author 提交 purpose、用户原话中的简短 displayName、effectBrief 和逐项 acceptanceCriteria，不得生成 React 源码或组件 ID。displayName 优先沿用用户给出的中文效果名，不得使用“自定义转场”等含糊名称。服务端编码 Agent 负责生成、试渲染和验收；同轮需要立即应用时，让 timeline.plan/timeline.patch 显式 dependsOn 该 author 动作。
- timeline.patch 的 sceneId 必须使用当前草稿 timelineFacts 中真实存在的场景 id；不确定时省略 sceneId，服务端会按当前选中镜头解析。subtitle 范围可全量修订字幕，也可带目标 sceneId 只改该场景字幕。
- 已有草稿后不得再次使用 timeline.plan。拆分、合并、插入或删除镜头使用 timeline.patch 的 structure 范围，并从 timelineFacts.scenes 选择一个连续的 sceneIds 范围；只有用户明确要求整体推翻重做时才使用 global。
- 修改一个或多个具体转场时使用 transition 范围，并从 timelineFacts.transitions 选择全部真实 transitionIds；用户用镜头顺序描述时，根据 fromSceneIndex/toSceneIndex 选择对应转场，不要把转场修改伪装成 scene 或 global 修订。
- scene 范围修改目标镜头的画面事实、字幕与相邻转场；visual_strategy 只切换目标镜头的视觉呈现（type/fit/motion/background/素材绑定），不动字幕与转场；两者都需要目标场景。
- 要求台账（stateActions）与创作记忆（memoryActions）不要对同一句话同时输出：记录为“要求/约束”走 stateActions；记住“偏好/长期/以后都这样”走 memoryActions。
- 用户明确说“记住/保存/沉淀”，或表达明确偏好（我喜欢、偏好、习惯、总是用…）时，必须输出对应的 memoryAction：稳定且跨项目→user+active；仅当前草稿→draft+active；不确定或仅一次选择→candidate。

长期创作知识规则：
- memoryActions 是可选附加动作；没有可跨轮复用的创作知识时省略或返回空数组，闲聊不得为了填字段而沉淀。
- retrievedCreativeMemories 是召回候选，不是 confirmedRequirements。不得仅因为召回到 active 记忆就把它复制进 stateActions；需要规划时它会由服务端作为临时 Planner 上下文传入。
- 用户长期稳定偏好使用 user scope；只适用于当前持久草稿的知识使用 draft scope。不要输出草稿 ID，服务端会绑定当前草稿。
- 推断或不确定的知识只能标记 candidate，candidate 不直接控制创作。
- replace/revoke 只能引用 retrievedCreativeMemories 中的 memory id。每项必须引用本轮 currentTurnId；记忆失败不会阻断其他动作。
输出字段：replyDraft、intent、creativeConfigDelta、stateActions、memoryActions、skillRequests、toolRequests、missingInformation。只输出 JSON。
1
Available Skill cards:
${JSON.stringify(listV2AgentSkillCards())}

Available Tool cards:
${JSON.stringify(listV2AgentToolCards())}

Current context:
${JSON.stringify(compactDirectorContextForPrompt(input), null, 2)}

输出前的最终核对：
- 只看这条当前用户输入：${JSON.stringify(input.prompt)}
- 它是否明确要求本轮创建、修订或执行产物？如果没有，toolRequests 必须为空；“记录要求”不等于“应用草稿”，只有同一句同时提出两者才同时返回状态动作与 Tool。
只输出最终 JSON。`
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
  return LlmIntentResultSchema.parse(extractJson(text))
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

async function callResponsesApi(input: {
  promptText: string
  imageInputs?: ArkResponsesImageInput[]
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

function responseIdFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const id = (payload as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id : undefined
}

function workspaceIntentFor(candidate: LlmIntentResult) {
  return candidate.intent
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
    stateActions: [],
    memoryActions: [],
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
    memoryActions: [],
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
  currentTurnId?: string
  currentTurnMaterialIds?: string[]
  context: DirectorContext
  runtime: DirectorConversationRuntime
  previousResponseId?: string
  confirmedRequirements?: ConfirmedRequirement[]
  retrievedCreativeMemories?: CreativeMemorySearchResult
  timelineSpec?: RemotionTimelineSpecV1
}): Promise<LlmIntentRouterOutput> {
  const aspectRatio = input.context.effectiveCreativeConfig?.aspectRatio ?? input.context.slots.aspectRatio
  const [aspectWidth, aspectHeight] = aspectRatio.split(':').map(Number)
  const promotedComponents = await listPromotedComponents(
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
    const promptText = [
      buildDirectorModelPrompt({ ...input, promotedComponents }),
      `本轮已附加视觉输入：${imageInputs.content.length} 张。`,
    ].join('\n\n')
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
        const repaired = parseDirectorModelDecision(repairedText)
        return {
          source: 'llm', modelCalled: true,
          result: toDirectorIntentResult(repaired, input.context, input.runtime),
          publicThoughts: [], responseId: responseIdFrom(raw),
          modelOutputText: text, modelResponseAudit: audit,
          conversationIntent: workspaceIntentFor(repaired),
          stateActions: repaired.stateActions,
          memoryActions: repaired.memoryActions,
          missingInformation: repaired.missingInformation,
          structuredOutput: response.structuredOutput,
          imageInputWarnings,
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
      memoryActions: parsed.memoryActions,
      missingInformation: parsed.missingInformation,
      structuredOutput: response.structuredOutput,
      imageInputWarnings,
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
