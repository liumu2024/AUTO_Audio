import type { DirectorContextSlots, DirectorExecutionEffect, DirectorIntentResult, DirectorUserIntent } from './director-context.js';
/** 对话层可输出的导演动作（不直接绑定具体任务实现） */
export type DirectorActionType = 'ANALYZE_SAMPLE' | 'ANALYZE_MATERIALS' | 'GENERATE_TIMELINE' | 'REVISE_TIMELINE' | 'RENDER_VIDEO' | 'ASK_USER';
export interface DirectorActionPayload {
    missingSlots?: string[];
    requiresConfirmation?: boolean;
    executionEffect?: Exclude<DirectorExecutionEffect, 'none'>;
    authorizationEvidence?: string;
}
export interface DirectorAction {
    type: DirectorActionType;
    message: string;
    intent: DirectorUserIntent;
    slots: DirectorContextSlots;
    result: DirectorIntentResult;
    payload?: DirectorActionPayload;
}
//# sourceMappingURL=director-action.d.ts.map