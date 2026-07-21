import type { AssetAnalysisV1 } from './asset-analysis.v1.js'
import type { DirectorSessionState } from './director-state.js'
import type { RenderPlanV1 } from './render-plan.v1.js'
import type { TemplateSchemaV1 } from './template-schema.v1.js'

export type DirectorGoal =
  | 'analyze_sample'
  | 'analyze_materials'
  | 'generate_video'
  | 'revise_plan'
  | 'render'

export type DirectorAspectRatio = RenderPlanV1['canvas']['ratio']

/** 对话层识别的用户意图（比 goal 更细，含澄清/未知） */
export type DirectorConversationIntent =
  | 'analyze_sample'
  | 'analyze_materials'
  | 'revise_plan'
  | 'generate_video'
  | 'render'
  | 'clarify'
  | 'unknown'

/** 对话管理器输出的下一步动作 */
export type DirectorNextAction =
  | 'ASK_USER'
  | 'ANALYZE_SAMPLE'
  | 'GENERATE_VIDEO'
  | 'RENDER'
  | 'REVISE_PLAN'
  | 'ACKNOWLEDGE'
  | 'NEED_BACKEND'
  | 'NEED_SAMPLE'
  | 'WAIT'

export type DirectorContentDomain =
  | 'landscape_montage'
  | 'music_video'
  | 'product_marketing'
  | 'general'

export type DirectorSampleVideoStatus = 'missing' | 'attached' | 'parsed'

export type DirectorMaterialStatus = 'missing' | 'partial' | 'ready'

export type DirectorGenerationMode =
  | 'style_replicate'
  | 'montage'
  | 'beat_sync'
  | 'custom'

export type DirectorSubtitlePolicy = 'keep' | 'none' | 'rewrite'

export type DirectorAudioPolicy = 'keep_sample_bgm' | 'user_audio' | 'mute'

export interface DirectorPendingConfirmation {
  intent: DirectorConversationIntent
  summary: string
  slotsPatch?: Partial<DirectorContextSlots>
}

export interface DirectorContextSlots {
  sampleVideoStatus: DirectorSampleVideoStatus
  materialStatus: DirectorMaterialStatus
  contentDomain: DirectorContentDomain
  aspectRatio: DirectorAspectRatio
  durationSec?: number
  styleIntensity: 'light' | 'medium' | 'strong'
  generationMode: DirectorGenerationMode
  subtitlePolicy: DirectorSubtitlePolicy
  audioPolicy: DirectorAudioPolicy
  selectedClipId?: string
  pendingConfirmation?: DirectorPendingConfirmation
}

export interface DirectorIntentResult {
  intent: DirectorConversationIntent
  confidence: number
  contentDomain: DirectorContentDomain
  slotsPatch: Partial<DirectorContextSlots>
  missingSlots: string[]
  requiresConfirmation: boolean
  nextAction: DirectorNextAction
  assistantMessage: string
}

export interface SampleStyleRecipe {
  style_id: string
  reference_source: 'sample_video'
  pacing: 'slow_cinematic' | 'medium' | 'fast_cut' | 'beat_sync'
  visual_motifs: string[]
  recommended_presets: string[]
  timeline_pattern: Array<{
    phase: string
    duration_sec: number
    effect_preset?: string
    purpose: string
    transition_to_next?: string
  }>
  notes?: string[]
}

export interface MaterialAnalysis {
  asset_id: string
  source: 'user_material'
  type: 'video' | 'image' | 'audio'
  usable_segments: Array<{
    start_sec: number
    end_sec: number
    shot_type?: string
    motion?: string
    quality_score: number
    recommended_usage: string[]
  }>
  tags: string[]
  summary: string
}

export interface DirectorUserIntent {
  goal: DirectorGoal
  aspectRatio?: DirectorAspectRatio
  durationSec?: number
  fps?: number
  styleIntensity?: 'light' | 'medium' | 'strong'
  requestedStyle?: string
  constraints?: string[]
  rawText?: string
}

export interface DirectorSampleVideoContext {
  id: string
  url: string
  name?: string
  understanding?: TemplateSchemaV1
  styleRecipe?: SampleStyleRecipe
}

export interface DirectorMaterialContext {
  id: string
  type: 'video' | 'image' | 'audio'
  url: string
  name?: string
  tags?: string[]
  analysis?: MaterialAnalysis
  assetAnalysis?: AssetAnalysisV1
}

export interface DirectorContext {
  sampleVideo?: DirectorSampleVideoContext
  materials: DirectorMaterialContext[]
  userIntent: DirectorUserIntent
  currentRenderPlan?: RenderPlanV1
  directorState?: DirectorSessionState
  conversationSummary?: string
  slots: DirectorContextSlots
}
