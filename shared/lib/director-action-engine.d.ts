import { type DirectorConversationRuntime } from './director-understanding.js';
import type { DirectorAction, DirectorActionOutcome, DirectorActionType, DirectorExecutionPlan } from '../types/director-action.js';
import type { DirectorContext, DirectorContextSlots, DirectorExecutionEffect } from '../types/director-context.js';
import type { DirectorIntentResult } from '../types/director-context.js';
export type { DirectorAction, DirectorActionOutcome, DirectorActionPayload, DirectorActionType, DirectorActionPhase, DirectorExecutionPlan, DirectorPlanStep, DirectorToolName, } from '../types/director-action.js';
export interface ResolveDirectorActionInput {
    prompt: string;
    context: DirectorContext;
    runtime: DirectorConversationRuntime;
}
export interface DirectorActionExecutionContext {
    prompt: string;
    sampleVideoUrl: string;
    sampleVideoName?: string;
    aspectRatio: DirectorContextSlots['aspectRatio'];
    durationSec?: number;
    styleIntensity: DirectorContextSlots['styleIntensity'];
    materials: Array<{
        id: string;
        name: string;
        type: 'video' | 'image' | 'audio';
        url: string;
        tags?: string[];
    }>;
    conversationSummary?: string;
    activeTaskId?: string | null;
    execution?: {
        effect?: Exclude<DirectorExecutionEffect, 'none'>;
        authorizationEvidence?: string;
    };
}
export interface DirectorActionExecutor {
    analyzeSample: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>;
    analyzeMaterials: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>;
    generateTimeline: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>;
    reviseTimeline: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>;
    renderVideo: (ctx: DirectorActionExecutionContext) => Promise<DirectorActionOutcome>;
    askUser: (ctx: DirectorActionExecutionContext, action: DirectorAction) => Promise<DirectorActionOutcome>;
    requestPlugin: (ctx: DirectorActionExecutionContext, action: DirectorAction) => Promise<DirectorActionOutcome>;
}
export declare function mapNextActionToDirectorActionType(result: DirectorIntentResult): DirectorActionType;
export declare function buildExecutionPlanFromDirectorAction(action: Pick<DirectorAction, 'type'>): DirectorExecutionPlan;
export declare function directorActionFromIntentResult(input: ResolveDirectorActionInput & {
    result: DirectorIntentResult;
}): DirectorAction;
export declare function resolveDirectorAction(input: ResolveDirectorActionInput): DirectorAction;
export declare function executeDirectorAction(input: {
    action: DirectorAction;
    executor: DirectorActionExecutor;
    context: DirectorActionExecutionContext;
}): Promise<DirectorActionOutcome>;
//# sourceMappingURL=director-action-engine.d.ts.map