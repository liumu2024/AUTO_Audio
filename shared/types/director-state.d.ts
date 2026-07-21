import type { DirectorAction, DirectorActionType, DirectorFailureCode, DirectorPlanStepRun } from './director-action.js';
import type { RenderPlanV1 } from './render-plan.v1.js';
export type DirectorSessionPhase = 'idle' | 'sample_analyzing' | 'sample_ready' | 'plan_drafting' | 'plan_editing' | 'rendering' | 'render_done' | 'failed';
export type DirectorRenderPlanStatus = 'missing' | 'dirty' | 'synced' | 'syncing' | 'failed' | 'rendering';
export interface RenderPlanDiff {
    revision: number;
    summary: string;
    at: string;
    sceneId?: string;
    clipId?: string;
}
export interface DirectorActionRecord {
    id: string;
    type: DirectorActionType;
    prompt: string;
    phaseBefore: DirectorSessionPhase;
    phaseAfter: DirectorSessionPhase;
    status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled';
    revisionBefore?: number;
    revisionAfter?: number;
    message?: string;
    error?: string;
    planSteps?: DirectorPlanStepRun[];
    createdAt: string;
    completedAt?: string;
}
export interface DirectorRecoverSuggestion {
    label: string;
    action: Pick<DirectorAction, 'type' | 'message' | 'payload'>;
}
export interface DirectorRecoverableError {
    code: DirectorFailureCode;
    message: string;
    suggestions: DirectorRecoverSuggestion[];
}
export interface DirectorSessionState {
    taskId?: string;
    phase: DirectorSessionPhase;
    sampleStatus: 'missing' | 'uploaded' | 'analyzing' | 'parsed';
    materialStatus: 'missing' | 'partial' | 'ready';
    renderPlanStatus: DirectorRenderPlanStatus;
    selectedClipId?: string;
    selectedSceneId?: string;
    currentRevision?: number;
    syncedRevision?: number;
    renderedRevision?: number;
    lastDiff?: RenderPlanDiff;
    lastAction?: DirectorActionRecord;
    lastError?: DirectorRecoverableError;
    actionLedger: DirectorActionRecord[];
}
export interface DirectorSessionSnapshotInput {
    taskId?: string | null;
    sampleUrl?: string;
    isSampleParsed: boolean;
    hasVisualMaterial: boolean;
    materialCount: number;
    renderPlan?: RenderPlanV1 | null;
    renderPlanStatus?: DirectorRenderPlanStatus;
    selectedClipId?: string | null;
    selectedSceneId?: string | null;
    lastChangeSummary?: string | null;
    renderedRevision?: number;
}
//# sourceMappingURL=director-state.d.ts.map