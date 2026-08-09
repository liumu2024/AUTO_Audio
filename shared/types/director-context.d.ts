import type { DirectorSessionState, DirectorTimelineSnapshot } from './director-state.js';
import type { V2SampleUnderstandingResult } from './v2-sample-understanding.js';
export type DirectorGoal = 'analyze_sample' | 'analyze_materials' | 'generate_timeline' | 'revise_timeline' | 'render';
export type DirectorAspectRatio = '9:16' | '16:9' | '1:1' | '4:3';
/** 对话层识别的用户意图（比 goal 更细，含澄清/未知） */
export type DirectorConversationIntent = 'chat' | 'analyze_sample' | 'analyze_materials' | 'revise_timeline' | 'generate_timeline' | 'render' | 'clarify' | 'unknown';
/** 对话管理器输出的下一步动作 */
export type DirectorNextAction = 'ASK_USER' | 'ANALYZE_SAMPLE' | 'GENERATE_TIMELINE' | 'RENDER' | 'REVISE_TIMELINE' | 'ACKNOWLEDGE' | 'NEED_BACKEND' | 'NEED_SAMPLE' | 'WAIT';
/**
 * The model's assessment of whether a message should have a side effect.
 * `none` is the normal result for discussion, questions, critique, and advice.
 */
export type DirectorExecutionEffect = 'none' | 'workspace_change' | 'draft_change' | 'delivery';
export type DirectorContentDomain = 'landscape_montage' | 'music_video' | 'product_marketing' | 'general';
export type DirectorSampleVideoStatus = 'missing' | 'attached' | 'parsed';
export type DirectorMaterialStatus = 'missing' | 'partial' | 'ready';
export type DirectorSubtitlePolicy = 'keep' | 'none' | 'rewrite';
export interface DirectorPendingConfirmation {
    intent: DirectorConversationIntent;
    summary: string;
    slotsPatch?: Partial<DirectorContextSlots>;
}
export interface DirectorContextSlots {
    sampleVideoStatus: DirectorSampleVideoStatus;
    materialStatus: DirectorMaterialStatus;
    contentDomain: DirectorContentDomain;
    aspectRatio: DirectorAspectRatio;
    durationSec?: number;
    styleIntensity: 'light' | 'medium' | 'strong';
    subtitlePolicy: DirectorSubtitlePolicy;
    selectedClipId?: string;
    /** A video material explicitly selected by the director as the sample reference. */
    sampleMaterialId?: string;
    pendingConfirmation?: DirectorPendingConfirmation;
}
/** Values deliberately selected in the UI; they outrank model inference. */
export interface DirectorExplicitUiControls {
    aspectRatio?: DirectorAspectRatio;
    durationSec?: number;
    styleIntensity?: 'light' | 'medium' | 'strong';
}
export interface DirectorEffectiveCreativeConfig {
    aspectRatio: DirectorAspectRatio;
    durationSec?: number;
    styleIntensity: 'light' | 'medium' | 'strong';
    sources: Partial<Record<'aspectRatio' | 'durationSec' | 'styleIntensity', 'ui' | 'confirmed' | 'model' | 'default'>>;
    conflicts: Array<{
        field: 'aspectRatio' | 'durationSec' | 'styleIntensity';
        uiValue: string | number;
        modelValue: string | number;
        effectiveValue: string | number;
    }>;
}
export interface DirectorIntentResult {
    intent: DirectorConversationIntent;
    confidence: number;
    contentDomain: DirectorContentDomain;
    slotsPatch: Partial<DirectorContextSlots>;
    /** Model-inferred values before explicit UI controls are resolved. */
    modelInferredSlots?: Partial<DirectorContextSlots>;
    missingSlots: string[];
    requiresConfirmation: boolean;
    nextAction: DirectorNextAction;
    assistantMessage: string;
    /** Optional for wire compatibility; V2 agent responses always provide it. */
    executionEffect?: DirectorExecutionEffect;
    /** Exact user wording that the model treated as authorisation for a side effect. */
    authorizationEvidence?: string;
    /** Agent-selected operational guidance. The backend validates every id. */
    skillRequests?: Array<{
        skillId: string;
        purpose: string;
    }>;
    /** Provider-neutral tool proposals. They never execute on the client. */
    toolRequests?: Array<{
        /** Model-local action reference; the server owns execution ids. */
        ref: string;
        toolId: string;
        skillId: string;
        arguments: Record<string, unknown>;
        requestedMode: 'preview' | 'execute';
        dependsOn: string[];
    }>;
}
export interface SampleStyleRecipe {
    style_id: string;
    reference_source: 'sample_video';
    pacing: 'slow_cinematic' | 'medium' | 'fast_cut' | 'beat_sync';
    visual_motifs: string[];
    recommended_presets: string[];
    timeline_pattern: Array<{
        phase: string;
        duration_sec: number;
        effect_preset?: string;
        purpose: string;
        transition_to_next?: string;
    }>;
    notes?: string[];
}
/** A compact V2-facing summary of reference-video understanding. */
export interface DirectorReferenceSummary {
    source: 'sample_video';
    summary: string;
    atmosphere?: string;
    editing?: string;
    rhythm?: string;
    reusableStyle?: string;
    segmentCount: number;
    warnings?: string[];
}
/** A compact V2-facing summary of a candidate creation material. */
export interface DirectorMaterialSummary {
    asset_id: string;
    source: 'user_material';
    type: 'video' | 'image' | 'audio';
    usable_segments: Array<{
        start_sec: number;
        end_sec: number;
        shot_type?: string;
        motion?: string;
        quality_score: number;
        recommended_usage: string[];
    }>;
    tags: string[];
    summary: string;
}
export interface DirectorUserIntent {
    /** Absent until the user or model has actually established a task goal. */
    goal?: DirectorGoal;
    aspectRatio?: DirectorAspectRatio;
    durationSec?: number;
    fps?: number;
    styleIntensity?: 'light' | 'medium' | 'strong';
}
export interface DirectorSampleVideoContext {
    id: string;
    url: string;
    name?: string;
    reference?: DirectorReferenceSummary;
    styleRecipe?: SampleStyleRecipe;
    /** Persisted V2-only understanding used by the planner; never a V1 state. */
    sampleUnderstanding?: V2SampleUnderstandingResult;
}
export interface DirectorMaterialContext {
    id: string;
    type: 'video' | 'image' | 'audio';
    url: string;
    name?: string;
    tags?: string[];
    summary?: DirectorMaterialSummary;
}
/**
 * Compact, protocol-neutral timeline context for the director prompt.
 * It intentionally excludes the editable timeline spec and legacy protocol details.
 */
export interface DirectorTimelineContext extends DirectorTimelineSnapshot {
    sceneCount?: number;
}
/** Read-only factual projection of the persisted V2 revision for later chat. */
export interface DirectorTimelineFacts {
    revision: number;
    scenes: Array<{
        id: string;
        title?: string;
        description?: string;
        visualRole?: string;
        durationSec: number;
    }>;
    visibleText: Array<{
        id: string;
        sceneId?: string;
        type: string;
        text: string;
        yPct: number;
        maxLines?: number;
        animation?: string;
    }>;
    transitions: Array<{
        id: string;
        fromSceneId: string;
        toSceneId: string;
        fromSceneIndex: number;
        toSceneIndex: number;
        type: string;
        durationSec: number;
    }>;
    audioClipCount: number;
    notes: string[];
}
export interface DirectorContext {
    sampleVideo?: DirectorSampleVideoContext;
    materials: DirectorMaterialContext[];
    userIntent: DirectorUserIntent;
    currentTimeline?: DirectorTimelineContext;
    /** Server-derived facts for grounded discussion of the current V2 revision. */
    timelineFacts?: DirectorTimelineFacts;
    directorState?: DirectorSessionState;
    conversationSummary?: string;
    slots: DirectorContextSlots;
    /** Explicit UI values are passed separately from model-inferred intent. */
    explicitUiControls?: DirectorExplicitUiControls;
    /** Server-resolved, V2-only configuration used by planning and trace. */
    effectiveCreativeConfig?: DirectorEffectiveCreativeConfig;
}
//# sourceMappingURL=director-context.d.ts.map