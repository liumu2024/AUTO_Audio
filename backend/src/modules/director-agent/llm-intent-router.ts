import { z } from 'zod'

import { env } from '../../config/env.js'
import { routeConversationSurface } from './surface-router.js'
import {
  deriveRuntimeSlotStatus,
  parseDirectorSlotsFromText,
  routeDirectorConversation,
} from '../../../../shared/lib/director-understanding.js'
import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type {
  DirectorContext,
  DirectorContextSlots,
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
    })
    .default({}),
  missingSlots: z.array(z.string()).default([]),
  requiresConfirmation: z.boolean().default(false),
  nextAction: NextActionSchema,
  assistantMessage: z.string().min(1),
  publicThoughts: z.array(z.string()).default([]),
})

type LlmIntentResult = z.infer<typeof LlmIntentResultSchema>

export interface LlmIntentRouterOutput {
  source: 'llm' | 'rule_fallback'
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

function hasEditableTimelineContext(
  context: DirectorContext,
  runtime: DirectorConversationRuntime,
) {
  if (hasCurrentV2Timeline(runtime)) return true
  if (context.currentTimeline ?? context.directorState?.timeline) return true
  return /当前已有 V2 时间线方案|最近一次 preview trace|最近一次 render trace/.test(
    context.conversationSummary ?? '',
  )
}

function hasCurrentV2Timeline(runtime: DirectorConversationRuntime) {
  return Boolean(runtime.hasV2Timeline)
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
2. 输出严格 JSON，让系统知道下一步是否要解析样例、生成 V2 时间线方案、渲染、修改方案或追问。

业务边界必须遵守：
- sample video 只是结构、风格、节奏来源，不是成片素材。
- reference materials / materials 才是成片候选素材。
- 用户说“只解析/先解析/不要生成/不出片”时，不得生成或渲染。
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
    assistantMessage: candidate.assistantMessage,
  }
}

function hasExplicitRenderCommand(prompt: string): boolean {
  return /渲染吧|你渲染|现在渲染|开始渲染|重新渲染|导出吧|出片吧|渲染|导出|输出\s*mp4|输出\s*MP4/i.test(
    prompt,
  )
}

function currentTimelineActionAuthority(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  if (!hasCurrentV2Timeline(input.runtime) || hasExplicitRenderCommand(input.prompt)) {
    return undefined
  }

  const surface = routeConversationSurface(input)
  return surface.mode === 'edit' ? 'revise' : 'withhold_render'
}

export function applyDirectorIntentHardGuards(input: {
  llmResult: DirectorIntentResult
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): DirectorIntentResult {
  const { llmResult, runtime, prompt, context } = input
  const runtimeSlots = deriveRuntimeSlotStatus(runtime)
  const explicitSlots = parseDirectorSlotsFromText(prompt)
  const slotsPatch = {
    ...llmResult.slotsPatch,
    ...explicitSlots,
    ...runtimeSlots,
    contentDomain: llmResult.contentDomain,
    aspectRatio: explicitSlots.aspectRatio ?? context.slots.aspectRatio,
    durationSec: explicitSlots.durationSec ?? context.slots.durationSec,
    styleIntensity: explicitSlots.styleIntensity ?? context.slots.styleIntensity,
  }
  const wantsOutput =
    llmResult.intent === 'generate_timeline' ||
    llmResult.intent === 'render' ||
    llmResult.nextAction === 'GENERATE_TIMELINE' ||
    llmResult.nextAction === 'RENDER'
  const needsSampleBeforeWork =
    llmResult.intent === 'analyze_sample' ||
    llmResult.nextAction === 'ANALYZE_SAMPLE' ||
    llmResult.nextAction === 'NEED_SAMPLE'
  const analyzeOnly = /只解析|先解析|不要生成|不生成|不要出片|不出片/.test(prompt)
  const explicitSampleAnalyze =
    /重新理解|重新解析|重新分析|解析.*(样例|视频)|分析.*(样例|视频|主要内容|创作手法|视频结构|镜头|转场|节奏)|理解.*(样例|视频)|拆解.*(样例|视频)|看.*(样例|视频)/.test(prompt)
  const explicitSampleReplicate = /复刻/.test(prompt)
  const explicitRender = hasExplicitRenderCommand(prompt)
  const explicitOutput = /生成|成片|做成|出片|渲染|导出|输出/.test(prompt)
  const qualityFeedback =
    /没用到|没有用到|没用完|太简单|看不到|不清楚|不满意|不符合|不对|不好|很差/.test(prompt)
  const asksForRevision =
    /改|修改|调整|重排|重新生成|换成|变成|用上|补上|增加|减少|改为|做成|生成|渲染|导出/.test(prompt)
  const asksOpenQuestion =
    /为什么|怎么|如何|是什么|是否|是不是|能否|可以吗|讲讲|解释|说明|区别|关系/.test(prompt)
  const hasExecutionWording =
    /帮我|请|直接|现在|开始|按|用|重新|继续|生成一版|生成方案|渲染吧|导出吧|解析这个|分析这个|修改为|调整为|改成|换成/.test(prompt)

  if (!runtime.backendEnabled) {
    return {
      ...llmResult,
      slotsPatch,
      missingSlots: ['backend'],
      requiresConfirmation: false,
      nextAction: 'NEED_BACKEND',
      assistantMessage: '现在执行端还没准备好，所以我暂时不能真正解析或渲染。不过你可以先把想法说给我，我可以先帮你梳理风格和流程。',
    }
  }

  if (asksOpenQuestion && !hasExecutionWording && wantsOutput) {
    return {
      ...llmResult,
      intent: 'clarify',
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        llmResult.assistantMessage ||
        '这个更像是在问方案或流程，我先回答问题，不会直接改方案或渲染。你要执行时再直接说“生成一版方案”或“按当前方案渲染”。',
    }
  }

  const actionAuthority = currentTimelineActionAuthority({ prompt, context, runtime })
  if (actionAuthority === 'revise') {
    return {
      ...llmResult,
      intent: 'revise_timeline',
      confidence: Math.max(llmResult.confidence, 0.9),
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'REVISE_TIMELINE',
      assistantMessage: '我会先把这次对节奏、转场和字幕的要求写进当前 V2 时间线方案，更新后再由你决定是否渲染。',
    }
  }

  if (
    actionAuthority === 'withhold_render' &&
    (llmResult.intent === 'render' || llmResult.nextAction === 'RENDER')
  ) {
    return {
      ...llmResult,
      intent: 'clarify',
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: true,
      nextAction: 'ASK_USER',
      assistantMessage:
        '右侧已有可编辑的 V2 时间线。你是在继续修改方案，还是确认要直接渲染当前版本？',
    }
  }

  if ((explicitRender || llmResult.intent === 'render' || llmResult.nextAction === 'RENDER') && hasCurrentV2Timeline(runtime)) {
    return {
      ...llmResult,
      intent: 'render',
      confidence: Math.max(llmResult.confidence, 0.9),
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'RENDER',
      assistantMessage: '好，我按右侧这版时间线直接渲染，不重新生成方案。',
    }
  }

  if (!runtime.sampleUrl.trim() && (needsSampleBeforeWork || explicitSampleReplicate)) {
    return {
      ...llmResult,
      intent: 'analyze_sample',
      slotsPatch,
      missingSlots: ['sampleVideoStatus'],
      requiresConfirmation: false,
      nextAction: 'NEED_SAMPLE',
      assistantMessage: '要开始拆样例的话，还需要先给我一条参考视频。你也可以先不上传，继续和我聊风格、结构或生成思路。',
    }
  }

  if (
    (analyzeOnly || (explicitSampleAnalyze && !explicitOutput)) &&
    runtime.sampleUrl.trim() &&
    (!runtime.isSampleParsed || /重新|再次|再分析|再看/.test(prompt))
  ) {
    return {
      ...llmResult,
      intent: 'analyze_sample',
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ANALYZE_SAMPLE',
      assistantMessage: '明白，这次我只看样例，不往成片走。我会把它的段落、节奏和镜头方式先拆出来。',
    }
  }

  if (qualityFeedback && !asksForRevision) {
    return {
      ...llmResult,
      intent: 'clarify',
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        '你这个反馈是成立的。我先不直接覆盖当前方案：需要先把哪些素材没被使用、哪些镜头太空、哪些转场不贴样例列清楚。你确认要我改的话，可以直接说“按这个问题重排一版”或指定要保留几段、哪些图片必须出现。',
    }
  }

  if (wantsOutput) {
    const missingSlots: string[] = []
    if (
      (llmResult.intent === 'render' || llmResult.nextAction === 'RENDER') &&
      !hasCurrentV2Timeline(runtime)
    ) {
      missingSlots.push('v2Timeline')
    }

    if (missingSlots.length) {
      return {
        ...llmResult,
        slotsPatch,
        missingSlots,
        requiresConfirmation: false,
        nextAction: 'ASK_USER',
        assistantMessage:
          '现在还没有可渲染的 V2 时间线方案。你可以先按文字、可选样例参考或可用素材生成一版方案，再让我渲染。',
      }
    }
  }

  if (
    llmResult.nextAction === 'REVISE_TIMELINE' &&
    !hasEditableTimelineContext(context, runtime) &&
    runtime.isSampleParsed
  ) {
    return {
      ...llmResult,
      slotsPatch,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        `${llmResult.assistantMessage} 我先把这个偏好记住；现在还没有可编辑方案，等你让我生成一版方案时会一起带进去。`,
    }
  }

  return {
    ...llmResult,
    slotsPatch,
  }
}

function ruleFallback(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  reason?: string
}): LlmIntentRouterOutput {
  const prompt = input.prompt.trim()
  if (
    /讲讲|解释一下|分析结果|解析结果|刚才分析|刚才解析|结果给我|看懂了什么|总结一下/.test(
      prompt,
    ) &&
    input.runtime.isSampleParsed
  ) {
    const runtimeSlots = deriveRuntimeSlotStatus(input.runtime)
    const result: DirectorIntentResult = {
      intent: 'clarify',
      confidence: 0.82,
      contentDomain: input.context.slots.contentDomain,
      slotsPatch: { ...runtimeSlots, contentDomain: input.context.slots.contentDomain },
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        input.context.conversationSummary?.trim() ||
        '样例我已经理解过了。你可以继续问我它的节奏、镜头和风格，也可以直接按文字生成方案，或补充素材后再生成。',
    }
    return {
      source: 'rule_fallback',
      result,
      fallbackReason: input.reason,
      publicThoughts: input.reason
        ? [`意图模型暂不可用，已用当前样例大纲生成解释：${input.reason.slice(0, 120)}`]
        : ['已用当前样例大纲生成解释。'],
    }
  }

  if (/怎么做|如何做|方案|思路|建议/.test(prompt) && /风景|风光|旅拍|混剪|自然|日落|山水|海边/.test(prompt)) {
    const runtimeSlots = deriveRuntimeSlotStatus(input.runtime)
    const result: DirectorIntentResult = {
      intent: 'clarify',
      confidence: 0.78,
      contentDomain: 'landscape_montage',
      slotsPatch: { ...runtimeSlots, contentDomain: 'landscape_montage' },
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        '风景混剪可以先拆参考视频的节奏、转场、画面运动和情绪走向，再用你自己的风景素材去填画面。后面出方案时，我会把这些风格线索翻译成更具体的镜头时长、字幕、转场和覆盖层安排，而不是直接照搬样例。',
    }
    return {
      source: 'rule_fallback',
      result,
      fallbackReason: input.reason,
      publicThoughts: ['已识别为风景混剪创作咨询，不触发解析或生成任务。'],
    }
  }

  const result = routeDirectorConversation({
    prompt: input.prompt,
    slots: input.context.slots,
    runtime: input.runtime,
  })
  return {
    source: 'rule_fallback',
    result,
    fallbackReason: input.reason,
    publicThoughts: input.reason
      ? [`意图模型暂不可用，已切换到安全规则路由：${input.reason.slice(0, 160)}`]
      : ['已使用安全规则路由完成判断。'],
  }
}

export async function routeDirectorIntentWithLlm(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): Promise<LlmIntentRouterOutput> {
  if (!env.directorAgentEnabled) {
    return ruleFallback({ ...input, reason: 'DIRECTOR_AGENT_ENABLED=false' })
  }

  try {
    const raw = await callResponsesApi(buildPrompt(input))
    const text = extractText(raw)
    const parsed = LlmIntentResultSchema.parse(extractJson(text))
  const guarded = applyDirectorIntentHardGuards({
      llmResult: toDirectorIntentResult(parsed),
      prompt: input.prompt,
      context: input.context,
      runtime: input.runtime,
    })

    return {
      source: 'llm',
      result: guarded,
      publicThoughts: parsed.publicThoughts.slice(0, 4),
    }
  } catch (error) {
    return ruleFallback({
      ...input,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
