import { z } from 'zod'

import { env } from '../../config/env.js'
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
  'revise_plan',
  'generate_video',
  'render',
  'clarify',
  'unknown',
])
const NextActionSchema = z.enum([
  'ASK_USER',
  'ANALYZE_SAMPLE',
  'GENERATE_VIDEO',
  'RENDER',
  'REVISE_PLAN',
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

function summarizeCurrentPlan(context: DirectorContext) {
  const plan = context.currentRenderPlan
  if (!plan) return undefined
  return {
    ratio: plan.canvas.ratio,
    duration_sec: plan.duration_sec,
    scene_count: plan.scenes.length,
    scenes: plan.scenes.slice(0, 8).map((scene) => ({
      id: scene.id,
      name: scene.name,
      role: scene.role,
      start_sec: scene.start_sec,
      end_sec: scene.end_sec,
      intent: scene.intent,
      effect: scene.effects?.preset,
    })),
  }
}

function compactContext(input: {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}) {
  return {
    prompt: input.prompt,
    runtime: input.runtime,
    slots: input.context.slots,
    sampleVideo: input.context.sampleVideo
      ? {
          id: input.context.sampleVideo.id,
          name: input.context.sampleVideo.name,
          hasUnderstanding: Boolean(input.context.sampleVideo.understanding),
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
      hasAnalysis: Boolean(item.analysis || item.assetAnalysis),
    })),
    currentRenderPlan: summarizeCurrentPlan(input.context),
    directorState: input.context.directorState
      ? {
          phase: input.context.directorState.phase,
          sampleStatus: input.context.directorState.sampleStatus,
          materialStatus: input.context.directorState.materialStatus,
          renderPlanStatus: input.context.directorState.renderPlanStatus,
          currentRevision: input.context.directorState.currentRevision,
          syncedRevision: input.context.directorState.syncedRevision,
          renderedRevision: input.context.directorState.renderedRevision,
          selectedClipId: input.context.directorState.selectedClipId,
          selectedSceneId: input.context.directorState.selectedSceneId,
          lastDiff: input.context.directorState.lastDiff,
          lastError: input.context.directorState.lastError
            ? {
                code: input.context.directorState.lastError.code,
                message: input.context.directorState.lastError.message,
                suggestions: input.context.directorState.lastError.suggestions.map(
                  (suggestion) => suggestion.label,
                ),
              }
            : undefined,
          recentActions: input.context.directorState.actionLedger.slice(-5).map((item) => ({
            type: item.type,
            status: item.status,
            revisionBefore: item.revisionBefore,
            revisionAfter: item.revisionAfter,
            message: item.message,
          })),
        }
      : undefined,
    userIntent: input.context.userIntent,
    conversationSummary: input.context.conversationSummary,
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
2. 输出严格 JSON，让系统知道下一步是否要解析样例、生成 RenderPlan、渲染、修改方案或追问。

业务边界必须遵守：
- sample video 只是结构、风格、节奏来源，不是成片素材。
- reference materials / materials 才是成片候选素材。
- 用户说“只解析/先解析/不要生成/不出片”时，不得生成或渲染。
- 风景、音乐、氛围向视频不要强行套 Hook/Demo/CTA，可以使用“开篇、推进、高潮、收束”等创作角色。
- 如果缺样例、缺素材、缺当前任务上下文，必须追问或说明缺什么，不要假装已经能执行。
- 你只做意图路由和自然回复，不写 RenderPlan，不编造不存在的 Remotion preset。
- publicThoughts 是给用户看的简短工作说明，最多 4 条，不要暴露私密推理链。
- assistantMessage 要像真实导演助理说话：具体、短、结合上下文，有下一步建议。

特殊场景：
- 用户问“你是什么/你能做什么”：nextAction 用 ACKNOWLEDGE，assistantMessage 介绍能力。
- 用户问“讲讲分析结果/你看到了什么”：nextAction 用 ACKNOWLEDGE，根据 sample style recipe 或当前计划摘要解释。
- 用户问“怎么做某种风格”：nextAction 用 ACKNOWLEDGE，给创作流程建议。
- 用户说“生成成片/按这个做”：如果样例已解析且有用户素材，nextAction 用 GENERATE_VIDEO；否则 ASK_USER。
- 用户说“渲染/导出”：只有已经有 RenderPlan/任务上下文时才 RENDER，否则 ASK_USER。
- 用户说“重新生成方案”：这是重写 RenderPlan，nextAction 用 GENERATE_VIDEO，不要直接渲染。
- 用户说“重新渲染”：这是使用当前 RenderPlan 出新 MP4，nextAction 用 RENDER。
- 用户说“按提示修改后渲染/先修改再渲染”：优先从提示中抽取 slotsPatch，然后 nextAction 用 RENDER。

Revision / state machine rules:
- directorState.phase tells you where the product currently is; do not answer as if starting from scratch.
- currentRevision is the editable RenderPlan version, syncedRevision is the backend-saved version, renderedRevision is the MP4 version.
- If renderedRevision is lower than currentRevision, tell the user the MP4 is older and needs "重新渲染" to reflect the latest right-panel edits.
- If renderPlanStatus is dirty, mention unsaved edits when the user asks whether changes took effect.
- If the user refers to "上一步/刚才/撤销/改回去", use directorState.lastDiff and recentActions.
- If directorState.lastError exists, prefer one recovery suggestion over repeating raw logs.

输出 JSON schema：
{
  "intent": "analyze_sample|analyze_materials|revise_plan|generate_video|render|clarify|unknown",
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
  "nextAction": "ASK_USER|ANALYZE_SAMPLE|GENERATE_VIDEO|RENDER|REVISE_PLAN|ACKNOWLEDGE|NEED_BACKEND|NEED_SAMPLE|WAIT",
  "assistantMessage": "自然中文回复",
  "publicThoughts": ["给用户看的简短步骤"]
}

当前上下文：
${JSON.stringify(compactContext(input), null, 2)}

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

function applyHardGuards(input: {
  llmResult: DirectorIntentResult
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}): DirectorIntentResult {
  const { llmResult, runtime, prompt, context } = input
  const runtimeSlots = deriveRuntimeSlotStatus(runtime)
  const slotsPatch = {
    ...parseDirectorSlotsFromText(prompt),
    ...llmResult.slotsPatch,
    ...runtimeSlots,
    contentDomain: llmResult.contentDomain,
  }
  const wantsOutput =
    llmResult.intent === 'generate_video' ||
    llmResult.intent === 'render' ||
    llmResult.nextAction === 'GENERATE_VIDEO' ||
    llmResult.nextAction === 'RENDER'
  const analyzeOnly = /只解析|先解析|不要生成|不生成|不要出片|不出片/.test(prompt)

  if (!runtime.backendEnabled) {
    return {
      ...llmResult,
      slotsPatch,
      missingSlots: ['backend'],
      requiresConfirmation: false,
      nextAction: 'NEED_BACKEND',
      assistantMessage: '需要先启动后端、analyzer worker 和 generator worker，我才能执行解析或渲染任务。',
    }
  }

  if (!runtime.sampleUrl.trim()) {
    return {
      ...llmResult,
      intent: 'analyze_sample',
      slotsPatch,
      missingSlots: ['sampleVideoStatus'],
      requiresConfirmation: false,
      nextAction: 'NEED_SAMPLE',
      assistantMessage: '请先上传 1 个样例视频。样例只用于学习结构、风格和节奏，不会直接进入成片。',
    }
  }

  if (analyzeOnly && !runtime.isSampleParsed) {
    return {
      ...llmResult,
      intent: 'analyze_sample',
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ANALYZE_SAMPLE',
      assistantMessage: '明白，这次只解析样例，不生成成片。解析完成后我会停在样例风格拆解视图。',
    }
  }

  if (wantsOutput) {
    const missingSlots: string[] = []
    if (!runtime.isSampleParsed) missingSlots.push('sampleVideoStatus')
    if (!runtime.hasVisualMaterial) missingSlots.push('materialStatus')
    if (!runtime.hasPipeline || !runtime.activeTaskId) missingSlots.push('activeTask')

    if (missingSlots.length) {
      return {
        ...llmResult,
        slotsPatch,
        missingSlots,
        requiresConfirmation: false,
        nextAction: 'ASK_USER',
        assistantMessage: missingSlots.includes('materialStatus')
          ? '样例已经能作为风格参考了，但还缺真正用于成片的素材。请上传图片或视频作为 reference material；样例本身不会被当作成片素材。'
          : '现在还不能直接生成。需要先完成样例解析，并保留当前任务上下文，再进入 RenderPlan 生成。',
      }
    }
  }

  if (
    llmResult.nextAction === 'REVISE_PLAN' &&
    !context.currentRenderPlan &&
    runtime.isSampleParsed
  ) {
    return {
      ...llmResult,
      slotsPatch,
      nextAction: 'ACKNOWLEDGE',
      assistantMessage:
        `${llmResult.assistantMessage} 我先记下这个偏好；当前还没有生成编辑方案，等你说“生成成片”后会应用到 RenderPlan。`,
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
        '样例已经解析完成：我会把它作为结构、节奏和风格参考；成片需要你再补充 reference materials，之后说“生成成片”即可进入可编辑方案。',
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
        '风景混剪建议按“样例拆风格、素材做成片”的方式走：先解析参考视频的节奏、转场、画面运动和特效；再上传自己的风景镜头作为 reference materials；最后生成 RenderPlan，把卡点、调色、分屏、黑白转彩色或水波扩散这类效果映射到 Remotion 插件。Remotion 不需要大模型才能渲染，但需要前面的理解层把风格和参数说清楚。',
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
    const guarded = applyHardGuards({
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
