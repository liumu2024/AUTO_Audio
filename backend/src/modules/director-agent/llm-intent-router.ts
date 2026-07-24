import { z } from 'zod'

import { env } from '../../config/env.js'
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
      generationMode: z
        .enum(['style_replicate', 'montage', 'beat_sync', 'custom'])
        .optional(),
      subtitlePolicy: z.enum(['keep', 'none', 'rewrite']).optional(),
      audioPolicy: z.enum(['keep_sample_bgm', 'user_audio', 'mute']).optional(),
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
})

type LlmIntentResult = z.infer<typeof LlmIntentResultSchema>

export interface LlmIntentRouterOutput {
  source: 'llm' | 'llm_unstructured_safe_reply' | 'context_fallback'
  result: DirectorIntentResult
  publicThoughts: string[]
  fallbackReason?: string
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
    // V2 receives only its structured timeline context. A legacy free-text
    // summary can carry old outline/diff wording, so it is excluded entirely.
    ...(isV2 ? {} : { conversationSummary: input.context.conversationSummary }),
  }
}

function buildPrompt(input: {
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
- RENDER 是昂贵的交付动作：只有用户明确要求“渲染 / 导出 / 输出 MP4 / 出片”时才用 RENDER。用户在描述对节奏、画面、镜头、转场、字幕、声音或素材的期望时，即使没有说“修改”，也应使用 REVISE_TIMELINE；不能因已有时间线就直接渲染。
- 用户说“重新生成方案”：这是重排 V2 时间线方案，nextAction 用 GENERATE_TIMELINE，不要直接渲染。
- 用户说“重新渲染”：这是使用当前 V2 时间线方案出新 MP4，nextAction 用 RENDER。
- 用户说“按提示修改后渲染/先修改再渲染”：优先从提示中抽取 slotsPatch，然后 nextAction 用 RENDER。

V2 branch rules:
- V2 supports three generation branches: sample_replicate when a sample video is available, material_brief when only user text/materials are available, and text_to_video when the user only provides text.
- Do not require a sample video for GENERATE_TIMELINE. A sample video is only mandatory for ANALYZE_SAMPLE or when the user explicitly asks to copy/analyze a sample.
- Do not require user visual materials for GENERATE_TIMELINE. If no visual material is available, use text_to_video and let the video generation adapter create visual material from the prompt.
- If textToVideoAvailable is false and the user provides no visual material, explain that the system can draft an editable timeline but cannot create realistic generated footage until the video generation provider is configured.

Conversation freedom rules:
- 如果用户是在聊天、咨询方案、解释结果、问你能做什么、讨论项目设计，不要因为缺样例或缺素材而要求上传；先自然回答问题，再给一个可选下一步。
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
    "generationMode": "style_replicate|montage|beat_sync|custom",
    "subtitlePolicy": "keep|none|rewrite",
    "audioPolicy": "keep_sample_bgm|user_audio|mute"
  },
  "missingSlots": [],
  "requiresConfirmation": false,
  "executionEffect": "none|workspace_change|draft_change|delivery",
  "authorizationEvidence": "仅在 executionEffect 不是 none 时，摘录用户明确授权执行的原话；否则省略",
  "nextAction": "ASK_USER|ANALYZE_SAMPLE|GENERATE_TIMELINE|RENDER|REVISE_TIMELINE|ACKNOWLEDGE|NEED_BACKEND|NEED_SAMPLE|WAIT",
  "assistantMessage": "自然中文回复",
  "publicThoughts": ["给用户看的简短步骤"]
}

当前上下文：
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
  return LlmIntentResultSchema.parse(extractJson(text))
}

async function callResponsesApi(promptText: string): Promise<unknown> {
  if (!env.directorAgentApiKey) {
    throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')
  }

  const response = await fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.directorAgentModel,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: promptText }],
        },
      ],
    }),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text)
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
  }
}

function actionMatchesExecutionEffect(
  effect: DirectorExecutionEffect,
  nextAction: DirectorIntentResult['nextAction'],
) {
  if (effect === 'none') return true
  if (effect === 'workspace_change') {
    return nextAction === 'ANALYZE_SAMPLE'
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
    aspectRatio: llmResult.slotsPatch.aspectRatio ?? context.slots.aspectRatio,
    durationSec: llmResult.slotsPatch.durationSec ?? context.slots.durationSec,
    styleIntensity: llmResult.slotsPatch.styleIntensity ?? context.slots.styleIntensity,
  }

  if (effect === 'none') {
    return {
      ...llmResult,
      slotsPatch,
      nextAction: 'ACKNOWLEDGE',
      missingSlots: [],
      requiresConfirmation: false,
      executionEffect: 'none',
      authorizationEvidence: undefined,
    }
  }

  if (!llmResult.authorizationEvidence?.trim() || !actionMatchesExecutionEffect(effect, llmResult.nextAction)) {
    return {
      ...llmResult,
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
      slotsPatch,
      nextAction: 'NEED_BACKEND',
      missingSlots: ['backend'],
      requiresConfirmation: false,
      executionEffect: 'none',
    }
  }

  if (
    effect === 'workspace_change' &&
    !runtime.sampleUrl.trim() &&
    !hasSelectedSampleCandidate(runtime, llmResult.slotsPatch.sampleMaterialId)
  ) {
    return {
      ...llmResult,
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
      slotsPatch,
      nextAction: 'ASK_USER',
      missingSlots: ['timeline'],
      requiresConfirmation: false,
      executionEffect: 'none',
      assistantMessage: '当前还没有可交付的 V2 时间线版本。先生成或采用一版方案后，我才能为你渲染。',
    }
  }

  return { ...llmResult, slotsPatch }
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
  const contextLine = facts.length ? ` 我目前掌握的是：${facts.join('；')}。` : ''
  const assistantMessage = question
    ? `我先保留你刚才的问题：“${question}”。${contextLine} 导演理解暂时不可用，所以我不会把这句话猜成修改、生成或渲染指令；你可以继续展开你的想法，模型恢复后会按完整语义再判断。`
    : `我会保留当前讨论和已有的 V2 上下文，不会发起修改、生成或渲染。你可以继续描述想法。`

  return {
    source: 'context_fallback',
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
    publicThoughts: ['导演理解暂时不可用；已保留这轮问题与当前 V2 上下文，不会执行工作流。'],
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

export async function routeDirectorIntentWithLlm(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): Promise<LlmIntentRouterOutput> {
  if (!env.directorAgentEnabled) {
    return buildDirectorContextFallback({
      ...input,
      reason: 'director agent is disabled',
    })
  }

  try {
    const raw = await callResponsesApi(buildPrompt(input))
    const text = extractText(raw)
    let parsed: LlmIntentResult
    try {
      parsed = parseDirectorModelDecision(text)
    } catch {
      return (
        safeUnstructuredLlmReply({ ...input, text }) ??
        buildDirectorContextFallback({
          ...input,
          reason: 'director model returned no valid response protocol',
        })
      )
    }
    const guarded = finalizeModelDecision({
      llmResult: toDirectorIntentResult(parsed),
      context: input.context,
      runtime: input.runtime,
    })

    return {
      source: 'llm',
      result: guarded,
      publicThoughts: parsed.publicThoughts.slice(0, 4),
    }
  } catch (error) {
    return buildDirectorContextFallback({
      ...input,
      reason: error instanceof Error ? error.name : 'director model request failed',
    })
  }
}
