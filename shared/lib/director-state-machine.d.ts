import type { DirectorAction, DirectorActionOutcome, DirectorActionType, DirectorFailureCode, DirectorToolError } from '../types/director-action.js';
import type { DirectorRecoverableError, DirectorSessionSnapshotInput, DirectorSessionState, RenderPlanDiff } from '../types/director-state.js';
export declare function createInitialDirectorSessionState(): DirectorSessionState;
export declare function classifyDirectorFailure(message: string, actionType?: DirectorActionType): DirectorFailureCode;
export declare function directorToolErrorFromMessage(message: string, actionType?: DirectorActionType): DirectorToolError;
export declare function recoverableErrorFromMessage(message: string, actionType?: DirectorActionType): DirectorRecoverableError;
export declare function syncDirectorSessionSnapshot(previous: DirectorSessionState | undefined, input: DirectorSessionSnapshotInput): DirectorSessionState;
export declare function recordDirectorActionPlanned(input: {
    state: DirectorSessionState;
    action: DirectorAction;
    prompt: string;
}): DirectorSessionState;
export declare function recordDirectorActionRunning(input: {
    state: DirectorSessionState;
}): DirectorSessionState;
export declare function recordDirectorActionCompleted(input: {
    state: DirectorSessionState;
    outcome: DirectorActionOutcome;
    currentRevision?: number;
    diff?: RenderPlanDiff;
}): DirectorSessionState;
export declare function recordDirectorActionFailed(input: {
    state: DirectorSessionState;
    actionType?: DirectorActionType;
    error: string;
}): DirectorSessionState;
export declare function summarizeDirectorSessionState(state?: DirectorSessionState): string;
//# sourceMappingURL=director-state-machine.d.ts.map