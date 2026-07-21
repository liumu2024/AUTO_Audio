import type { AssetAnalysisV1 } from '../types/asset-analysis.v1.js'
import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js'
import type { UserMaterialDto } from '../types/pipeline.js'
import type {
  DirectorAspectRatio,
  DirectorContentDomain,
  DirectorContextSlots,
  DirectorConversationIntent,
  DirectorGoal,
  DirectorIntentResult,
  DirectorMaterialStatus,
  DirectorSampleVideoStatus,
  DirectorUserIntent,
  MaterialAnalysis,
  SampleStyleRecipe,
} from '../types/director-context.js'
import type { TemplateSchemaV1 } from '../types/template-schema.v1.js'

export interface DirectorConversationRuntime {
  backendEnabled: boolean
  sampleUrl: string
  sampleName?: string
  isSampleParsed: boolean
  hasPipeline: boolean
  activeTaskId?: string | null
  hasVisualMaterial: boolean
  materialCount: number
}

const words = {
  analyze: ['解析', '拆解', '分析样例', '理解样例', '识别结构', '样例视频'],
  analyzeOnly: ['只解析', '先解析', '不要生成', '不生成', '不要出片', '不出片'],
  generate: ['生成', '成片', '做成', '开始做', '出片', '生成视频', '重新生成方案', '重写 RenderPlan'],
  render: ['渲染', '重新渲染', '导出', '输出mp4', '输出 MP4', 'render', 'export'],
  revise: ['修改', '调整', '改成', '换成', '改为', '不要', '去掉', '保留'],
  material: ['素材', '镜头', '片段', '上传', '候选素材'],
  landscape: ['风景', '风光', '旅拍', '混剪', '自然', '治愈', '山水', '海边', '日落'],
  music: ['音乐', '节拍', '卡点', 'bgm', '配乐', '律动', '鼓点'],
  product: ['产品', '广告', '营销', '卖点', '带货', '商品'],
  noSubtitle: ['不要字幕', '无字幕', '去掉字幕', '禁用字幕', '不加字幕', '不要花字'],
  keepSubtitle: ['保留字幕', '要字幕', '加字幕', '要花字'],
  rewriteSubtitle: ['重写字幕', '改字幕', '字幕文案'],
  styleReplicate: ['按样例风格', '样例风格', '学习样例', '复刻样例', '保持样例'],
  montage: ['混剪', 'montage'],
  beatSync: ['卡点', '节奏', '强拍', 'beat', '鼓点'],
  horizontal: ['横屏', '16:9'],
  square: ['方形', '方屏', '1:1'],
  vertical: ['竖屏', '抖音', '快手', '9:16'],
  strong: ['强一点', '夸张', '强烈', '炸裂', '更明显'],
  light: ['轻一点', '克制', '淡一点', '柔和', '细腻'],
}

function includesAny(text: string, candidates: string[]): boolean {
  return candidates.some((word) => text.toLowerCase().includes(word.toLowerCase()))
}

function hasAnalyzeOnly(text: string): boolean {
  return includesAny(text, words.analyzeOnly)
}

export function createDefaultDirectorSlots(
  partial?: Partial<DirectorContextSlots>,
): DirectorContextSlots {
  return {
    sampleVideoStatus: 'missing',
    materialStatus: 'missing',
    contentDomain: 'general',
    aspectRatio: '9:16',
    styleIntensity: 'medium',
    generationMode: 'style_replicate',
    subtitlePolicy: 'keep',
    audioPolicy: 'keep_sample_bgm',
    ...partial,
  }
}

export function mergeDirectorSlots(
  base: DirectorContextSlots,
  patch: Partial<DirectorContextSlots>,
): DirectorContextSlots {
  return {
    ...base,
    ...patch,
    pendingConfirmation: patch.pendingConfirmation ?? base.pendingConfirmation,
  }
}

export function deriveRuntimeSlotStatus(
  runtime: DirectorConversationRuntime,
): Pick<DirectorContextSlots, 'sampleVideoStatus' | 'materialStatus'> {
  const sampleVideoStatus: DirectorSampleVideoStatus = runtime.isSampleParsed
    ? 'parsed'
    : runtime.sampleUrl.trim()
      ? 'attached'
      : 'missing'

  const materialStatus: DirectorMaterialStatus = runtime.hasVisualMaterial
    ? runtime.materialCount > 0
      ? 'ready'
      : 'partial'
    : 'missing'

  return { sampleVideoStatus, materialStatus }
}

export function inferContentDomain(text: string): DirectorContentDomain {
  const lower = text.toLowerCase()
  if (includesAny(text, words.product) || /product|marketing|ad\b/.test(lower)) {
    return 'product_marketing'
  }
  if (includesAny(text, words.landscape) || /landscape|scenic|travel/.test(lower)) {
    return 'landscape_montage'
  }
  if (includesAny(text, words.music) || /music video|mv\b|beat/.test(lower)) {
    return 'music_video'
  }
  return 'general'
}

export function isLandscapeLikeDomain(domain: DirectorContentDomain): boolean {
  return domain === 'landscape_montage' || domain === 'music_video'
}

export function parseDirectorIntent(text: string): DirectorUserIntent {
  const rawText = text.trim()
  const lower = rawText.toLowerCase()

  let goal: DirectorGoal = 'analyze_sample'
  if (hasAnalyzeOnly(rawText) || includesAny(rawText, words.analyze)) {
    goal = 'analyze_sample'
  } else if (includesAny(rawText, words.render)) {
    goal = 'render'
  } else if (includesAny(rawText, words.generate) || /\bgenerate\b|\bmake\b/.test(lower)) {
    goal = 'generate_video'
  } else if (includesAny(rawText, words.revise) || /\brevise\b|\bchange\b|\badjust\b/.test(lower)) {
    goal = 'revise_plan'
  } else if (includesAny(rawText, words.material)) {
    goal = 'analyze_materials'
  }

  const aspectRatio: DirectorAspectRatio | undefined =
    includesAny(rawText, words.horizontal) ||
    rawText.includes('16:9') ||
    lower.includes('youtube')
      ? '16:9'
      : includesAny(rawText, words.square) || rawText.includes('1:1')
        ? '1:1'
        : includesAny(rawText, words.vertical) ||
            rawText.includes('9:16') ||
            lower.includes('shorts') ||
            lower.includes('vertical')
          ? '9:16'
          : undefined

  const durationMatch = rawText.match(/(\d{1,3})\s*(秒|s|sec|seconds)/i)
  const durationSec = durationMatch ? Number(durationMatch[1]) : undefined
  const styleIntensity =
    includesAny(rawText, words.strong) || lower.includes('strong')
      ? 'strong'
      : includesAny(rawText, words.light) || lower.includes('light')
        ? 'light'
        : undefined

  return {
    goal,
    aspectRatio,
    durationSec,
    styleIntensity,
    requestedStyle: rawText || undefined,
    constraints: [],
    rawText,
  }
}

export function parseDirectorSlotsFromText(
  text: string,
): Partial<DirectorContextSlots> {
  const rawText = text.trim()
  const lower = rawText.toLowerCase()
  const patch: Partial<DirectorContextSlots> = {}
  const parsed = parseDirectorIntent(rawText)

  if (parsed.aspectRatio) patch.aspectRatio = parsed.aspectRatio
  if (parsed.durationSec) patch.durationSec = parsed.durationSec
  if (parsed.styleIntensity) patch.styleIntensity = parsed.styleIntensity

  const domain = inferContentDomain(rawText)
  if (domain !== 'general') patch.contentDomain = domain

  if (includesAny(rawText, words.noSubtitle)) {
    patch.subtitlePolicy = 'none'
  } else if (includesAny(rawText, words.rewriteSubtitle)) {
    patch.subtitlePolicy = 'rewrite'
  } else if (includesAny(rawText, words.keepSubtitle)) {
    patch.subtitlePolicy = 'keep'
  }

  if (includesAny(rawText, words.beatSync)) {
    patch.generationMode = 'beat_sync'
  } else if (includesAny(rawText, words.montage)) {
    patch.generationMode = 'montage'
  } else if (includesAny(rawText, words.styleReplicate)) {
    patch.generationMode = 'style_replicate'
  }

  if (/静音|不要音乐|无配乐|mute/.test(rawText) || lower.includes('mute')) {
    patch.audioPolicy = 'mute'
  } else if (/用户音频|自己的音乐|替换音乐|user audio/.test(rawText)) {
    patch.audioPolicy = 'user_audio'
  }

  return patch
}

function classifyConversationIntent(
  text: string,
  slots: DirectorContextSlots,
): { intent: DirectorConversationIntent; confidence: number } {
  const raw = text.trim()
  const lower = raw.toLowerCase()

  if (!raw) {
    return slots.sampleVideoStatus === 'parsed'
      ? { intent: 'clarify', confidence: 0.45 }
      : { intent: 'analyze_sample', confidence: 0.7 }
  }
  if (/先修改当前 RenderPlan，再重新渲染|修改后渲染/.test(raw)) {
    return { intent: 'render', confidence: 0.95 }
  }
  if (/重新生成方案|重写 RenderPlan/.test(raw)) {
    return { intent: 'generate_video', confidence: 0.94 }
  }
  if (hasAnalyzeOnly(raw) || includesAny(raw, words.analyze)) {
    return { intent: 'analyze_sample', confidence: hasAnalyzeOnly(raw) ? 0.96 : 0.9 }
  }
  if (includesAny(raw, words.render)) return { intent: 'render', confidence: 0.92 }
  if (includesAny(raw, words.generate) || /\bgenerate\b|\bmake\b/.test(lower)) {
    return { intent: 'generate_video', confidence: 0.88 }
  }
  if (includesAny(raw, words.material)) return { intent: 'analyze_materials', confidence: 0.8 }
  if (includesAny(raw, words.revise) || /\brevise\b|\bchange\b|\badjust\b/.test(lower)) {
    return { intent: 'revise_plan', confidence: 0.78 }
  }

  const slotsPatch = parseDirectorSlotsFromText(raw)
  if (Object.keys(slotsPatch).length > 0) return { intent: 'revise_plan', confidence: 0.7 }
  return { intent: 'unknown', confidence: 0.35 }
}

function goalFromConversationIntent(intent: DirectorConversationIntent): DirectorGoal {
  if (intent === 'render') return 'render'
  if (intent === 'generate_video') return 'generate_video'
  if (intent === 'revise_plan') return 'revise_plan'
  if (intent === 'analyze_materials') return 'analyze_materials'
  return 'analyze_sample'
}

function buildRevisionAckMessage(slots: DirectorContextSlots): string {
  const subtitle =
    slots.subtitlePolicy === 'none'
      ? '不加字幕'
      : slots.subtitlePolicy === 'rewrite'
        ? '重写字幕'
        : '保留字幕策略'
  const mode =
    slots.generationMode === 'beat_sync'
      ? '节拍卡点'
      : slots.generationMode === 'montage'
        ? '混剪编排'
        : slots.generationMode === 'custom'
          ? '自定义生成'
          : '按样例风格复刻'

  return `已记录：画幅 ${slots.aspectRatio}，${mode}，${subtitle}，风格强度 ${slots.styleIntensity}。确认要出方案时请说“生成成片”。`
}

export function routeDirectorConversation(input: {
  prompt: string
  slots: DirectorContextSlots
  runtime: DirectorConversationRuntime
}): DirectorIntentResult {
  const runtimeSlots = deriveRuntimeSlotStatus(input.runtime)
  const slotsPatchFromText = parseDirectorSlotsFromText(input.prompt)
  const mergedSlots = mergeDirectorSlots(
    mergeDirectorSlots(input.slots, runtimeSlots),
    slotsPatchFromText,
  )
  const signal = classifyConversationIntent(input.prompt, mergedSlots)
  const contentDomain =
    slotsPatchFromText.contentDomain ??
    mergedSlots.contentDomain ??
    inferContentDomain(input.prompt)
  const slotsPatch = { ...slotsPatchFromText, ...runtimeSlots, contentDomain }

  if (!input.runtime.backendEnabled) {
    return {
      intent: signal.intent,
      confidence: 1,
      contentDomain,
      slotsPatch,
      missingSlots: ['backend'],
      requiresConfirmation: false,
      nextAction: 'NEED_BACKEND',
      assistantMessage: '需要先启动后端、analyzer worker 和 generator worker，我才能执行解析或渲染任务。',
    }
  }

  const wantsOutput = signal.intent === 'generate_video' || signal.intent === 'render'
  if (
    mergedSlots.sampleVideoStatus === 'missing' &&
    (signal.intent === 'analyze_sample' || wantsOutput || signal.intent === 'unknown')
  ) {
    return {
      intent: signal.intent === 'unknown' ? 'analyze_sample' : signal.intent,
      confidence: Math.max(signal.confidence, 0.75),
      contentDomain,
      slotsPatch,
      missingSlots: ['sampleVideoStatus'],
      requiresConfirmation: false,
      nextAction: 'NEED_SAMPLE',
      assistantMessage:
        '请先上传 1 个样例视频。样例只作为结构、风格和节奏来源，不会直接进入成片。',
    }
  }

  if (signal.intent === 'analyze_sample' && mergedSlots.sampleVideoStatus !== 'parsed') {
    return {
      intent: 'analyze_sample',
      confidence: Math.max(signal.confidence, 0.85),
      contentDomain,
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'ANALYZE_SAMPLE',
      assistantMessage:
        '我会先解析样例视频，拆出结构、节奏、镜头语言和可复用视觉效果。解析完成后会停在样例分析视图，不会自动生成成片。',
    }
  }

  if (wantsOutput) {
    const missingSlots: string[] = []
    if (mergedSlots.sampleVideoStatus !== 'parsed') missingSlots.push('sampleVideoStatus')
    if (!input.runtime.hasVisualMaterial) missingSlots.push('materialStatus')
    if (!input.runtime.hasPipeline || !input.runtime.activeTaskId) missingSlots.push('activeTask')

    if (missingSlots.length) {
      return {
        intent: signal.intent,
        confidence: signal.confidence,
        contentDomain,
        slotsPatch,
        missingSlots,
        requiresConfirmation: false,
        nextAction: 'ASK_USER',
        assistantMessage: missingSlots.includes('materialStatus')
          ? '样例风格已经可以作为参考，但还缺成片素材。请上传至少 1 个图片或视频作为 reference material。'
          : '需要先完成样例解析，并恢复当前任务上下文后，才能生成或渲染成片。',
      }
    }

    return {
      intent: signal.intent,
      confidence: Math.max(signal.confidence, 0.82),
      contentDomain,
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: signal.intent === 'render' ? 'RENDER' : 'GENERATE_VIDEO',
      assistantMessage:
        signal.intent === 'render'
          ? '我会提交 Remotion 渲染任务。渲染期间你仍然可以查看样例分析和编辑区。'
          : '我会把样例风格和你的素材编排成可编辑 RenderPlan，先进入生成编辑视图，不会直接导出 MP4。',
    }
  }

  if (signal.intent === 'revise_plan' || Object.keys(slotsPatchFromText).length > 0) {
    return {
      intent: 'revise_plan',
      confidence: Math.max(signal.confidence, 0.72),
      contentDomain,
      slotsPatch,
      missingSlots: [],
      requiresConfirmation: false,
      nextAction: 'REVISE_PLAN',
      assistantMessage: buildRevisionAckMessage(mergedSlots),
    }
  }

  return {
    intent: signal.intent === 'unknown' ? 'clarify' : signal.intent,
    confidence: signal.confidence,
    contentDomain,
    slotsPatch,
    missingSlots: ['userIntent'],
    requiresConfirmation: signal.confidence < 0.55,
    nextAction: signal.confidence < 0.55 ? 'ASK_USER' : 'ACKNOWLEDGE',
    assistantMessage:
      mergedSlots.sampleVideoStatus === 'parsed'
        ? '样例已经解析完成。你可以让我讲解拆解结果、继续上传成片素材，或说“生成成片”进入可编辑方案。'
        : '你可以先上传样例视频让我解析，或者告诉我想做哪类风格，我会帮你规划流程。',
  }
}

export function directorIntentToUserIntent(
  result: DirectorIntentResult,
  current: DirectorUserIntent,
  prompt: string,
): DirectorUserIntent {
  const parsed = parseDirectorIntent(prompt)
  return {
    ...current,
    goal: goalFromConversationIntent(result.intent),
    aspectRatio: result.slotsPatch.aspectRatio ?? parsed.aspectRatio ?? current.aspectRatio,
    durationSec: result.slotsPatch.durationSec ?? parsed.durationSec ?? current.durationSec,
    styleIntensity:
      result.slotsPatch.styleIntensity ?? parsed.styleIntensity ?? current.styleIntensity,
    requestedStyle: prompt.trim() || current.requestedStyle,
    rawText: prompt.trim() || current.rawText,
    constraints:
      result.slotsPatch.subtitlePolicy === 'none'
        ? [...(current.constraints ?? []), 'no_subtitle']
        : current.constraints,
  }
}

function motifTextFromTemplate(template: TemplateSchemaV1 | undefined): string {
  const structure = template?.structure ?? []
  return [
    JSON.stringify(template?.style_features ?? {}),
    JSON.stringify(template?.transitions ?? []),
    ...structure.map((segment) =>
      [segment.purpose, segment.camera, segment.motion, segment.subtitle]
        .filter(Boolean)
        .join(' '),
    ),
  ]
    .join(' ')
    .toLowerCase()
}

function motifsFromText(motifText: string): string[] {
  const motifs: string[] = []
  if (/grayscale|black.?white|黑白|去色/.test(motifText)) motifs.push('grayscale_base')
  if (/portal|光环|圆环|局部彩色/.test(motifText)) motifs.push('color_portal')
  if (/ripple|wave|波纹|水波|涟漪/.test(motifText)) motifs.push('ripple_displacement')
  if (/sweep|cinematic|扫光|电影感/.test(motifText)) motifs.push('cinematic_light_sweep')
  if (/split|collage|分屏|拼贴/.test(motifText)) motifs.push('editorial_collage')
  return motifs.length ? motifs : ['template_structure', 'material_montage']
}

function presetsFromMotifs(motifs: string[]): string[] {
  const presets = [
    motifs.includes('grayscale_base') ? 'primitive_color_transform' : undefined,
    motifs.includes('color_portal') ? 'primitive_mask_reveal' : undefined,
    motifs.includes('color_portal') ? 'primitive_ring_overlay' : undefined,
    motifs.includes('ripple_displacement') ? 'primitive_ripple_displacement' : undefined,
    motifs.includes('cinematic_light_sweep') ? 'primitive_light_sweep_overlay' : undefined,
    motifs.includes('editorial_collage') ? 'primitive_collage_layout' : undefined,
    motifs.includes('cinematic_light_sweep') || motifs.includes('grayscale_base')
      ? 'primitive_texture_grade'
      : undefined,
  ].filter((item): item is string => Boolean(item))

  return presets.length ? presets : ['primitive_texture_grade', 'primitive_light_sweep_overlay']
}

export function buildSampleStyleRecipe(
  template: TemplateSchemaV1 | undefined,
): SampleStyleRecipe {
  const structure = template?.structure ?? []
  const motifs = motifsFromText(motifTextFromTemplate(template))
  const recommendedPresets = presetsFromMotifs(motifs)

  return {
    style_id: template?.id ?? 'sample_style_recipe',
    reference_source: 'sample_video',
    pacing:
      template?.style_features?.pace === 'fast'
        ? 'fast_cut'
        : template?.style_features?.pace === 'slow'
          ? 'slow_cinematic'
          : 'medium',
    visual_motifs: motifs,
    recommended_presets: recommendedPresets,
    timeline_pattern: structure.length
      ? structure.map((segment, index) => ({
          phase: segment.purpose || `段落_${index + 1}`,
          duration_sec: Math.max(0.5, segment.end - segment.start),
          effect_preset: recommendedPresets[index % recommendedPresets.length],
          purpose: segment.subtitle || segment.purpose || '复刻样例节奏',
          transition_to_next:
            template?.transitions.find(
              (transition) => transition.from_segment_id === segment.id,
            )?.presentation ?? undefined,
        }))
      : [
          {
            phase: '开场氛围',
            duration_sec: 4,
            effect_preset: recommendedPresets[0],
            purpose: '建立画面情绪',
          },
          {
            phase: '视觉高潮',
            duration_sec: 6,
            effect_preset: recommendedPresets[0],
            purpose: '呈现主要视觉亮点',
          },
        ],
    notes: ['样例视频仅作为风格参考，不得作为成片素材来源。'],
  }
}

export function buildSampleStyleRecipeFromMigration(
  structure: MigrationProtocolV12 | undefined,
): SampleStyleRecipe {
  const anchors = structure?.semantic_anchors ?? []
  const motifText = anchors
    .map((anchor) =>
      [
        anchor.logic_intent.marketing_role,
        anchor.logic_intent.creative_role,
        anchor.logic_intent.emotion_vibe,
        anchor.replication_instructions.visual_generation_prompt,
        anchor.replication_instructions.overlay_rewrite_instruction,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ')
    .toLowerCase()
  const motifs = motifsFromText(motifText)
  const recommendedPresets = presetsFromMotifs(motifs)

  return {
    style_id: structure?.metadata.video_id ?? 'sample_style_recipe',
    reference_source: 'sample_video',
    pacing: anchors.length >= 5 ? 'fast_cut' : 'medium',
    visual_motifs: motifs,
    recommended_presets: recommendedPresets,
    timeline_pattern: anchors.map((anchor, index) => ({
      phase:
        anchor.logic_intent.creative_role ??
        anchor.logic_intent.marketing_role ??
        `段落_${index + 1}`,
      duration_sec: Math.max(0.5, anchor.end_sec - anchor.start_sec),
      effect_preset: recommendedPresets[index % recommendedPresets.length],
      purpose:
        anchor.replication_instructions.overlay_rewrite_instruction ||
        anchor.replication_instructions.visual_generation_prompt ||
        '复刻样例节奏',
    })),
    notes: ['样例视频仅作风格参考；成片素材来自用户上传的 reference materials。'],
  }
}

function segmentFromAssetAnalysis(analysis: AssetAnalysisV1 | undefined) {
  return (analysis?.segments ?? []).map((segment) => ({
    start_sec: segment.start_sec,
    end_sec: segment.end_sec,
    shot_type: segment.shot_type,
    motion: segment.motion,
    quality_score: segment.score,
    recommended_usage: [
      ...(segment.tags ?? []),
      ...(segment.emotion_tags ?? []),
    ].slice(0, 5),
  }))
}

export function buildMaterialAnalysis(material: UserMaterialDto): MaterialAnalysis {
  const assetAnalysis = material.asset_analysis
  const segments = segmentFromAssetAnalysis(assetAnalysis)
  const type =
    material.material_type === 'VIDEO'
      ? 'video'
      : material.material_type === 'AUDIO'
        ? 'audio'
        : 'image'

  return {
    asset_id: material.id,
    source: 'user_material',
    type,
    usable_segments:
      segments.length > 0
        ? segments
        : [
            {
              start_sec: 0,
              end_sec: assetAnalysis?.duration_sec ?? 5,
              quality_score: 0.6,
              recommended_usage: material.ai_tags ?? [],
            },
          ],
    tags: material.ai_tags ?? [],
    summary: `${material.label || material.id} 是可用于填槽和成片编排的用户素材。`,
  }
}
