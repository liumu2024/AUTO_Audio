import type { DirectorContext } from './director-context.js';
import type { DirectorTimelineRevisionIntent } from './director-stream.js';
import type { DirectorConversationRuntime } from '../lib/director-understanding.js';
export interface DirectorPendingTimelineRevisionConfirmation {
    confirmationId: string;
    draftId: string;
    baseRevision: number;
    originalTurnRequestId: string;
    originalRequest: string;
    intent: 'revise' | 'execute';
    skillRequests: Array<{
        skillId: string;
        purpose: string;
    }>;
    /** Requirement action refs already committed by the proposal turn. */
    resolvedStateActionRefs: string[];
    toolRequests: Array<{
        ref: string;
        toolId: string;
        skillId: string;
        arguments: Record<string, unknown>;
        requestedMode: 'preview' | 'execute';
        dependsOn: string[];
    }>;
    revisionIntents: DirectorTimelineRevisionIntent[];
    /** Planner-affecting facts frozen when the user reviewed this proposal. */
    executionContext: {
        context: DirectorContext;
        runtime: DirectorConversationRuntime;
        confirmedRequirements: ConfirmedRequirement[];
        selectedItemId?: string;
        recalledCreativeMemories: string[];
        recalledCreativeKnowledge: string[];
    };
}
export type DirectorWorkspaceTurnRole = 'user' | 'assistant' | 'system';
export interface DirectorWorkspaceTurn {
    role: DirectorWorkspaceTurnRole;
    content: string;
    at: string;
    intent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify';
    outcome?: string;
}
export interface ConfirmedRequirement {
    id: string;
    statement: string;
    status: 'active' | 'superseded' | 'revoked';
    sourceTurnId: string;
    supersededBy?: string;
}
export interface DirectorWorkspaceState {
    /** Monotonic server revision used to reject stale workspace events. */
    stateRevision: number;
    context: DirectorContext;
    confirmedRequirements: ConfirmedRequirement[];
    draftId?: string;
    baseRevision?: number;
    selectedItemId?: string;
    latestExecution?: {
        action: string;
        outcome: string;
        traceDir?: string;
    };
    pendingQuestion?: string;
    recentFailure?: {
        reason: string;
        recovery?: string;
    };
    /** Requested draft edits that failed and must not be misrepresented by rendering an older revision. */
    pendingTimelineRevisions?: Array<{
        instruction: string;
        callId: string;
        baseRevision: number;
    }>;
    /** Server-validated revision plan waiting for an explicit UI decision. */
    pendingTimelineRevisionConfirmation?: DirectorPendingTimelineRevisionConfirmation;
    rollingSummary: string;
    turns: DirectorWorkspaceTurn[];
    responseId?: string;
    responseContinuityDisabled?: boolean;
    /** Bounded idempotency ledger for server-authorized V2 tool calls. */
    recentToolCallIds?: string[];
    /** Most recent image group explicitly attached by the user, reused for visual follow-ups. */
    recentVisualMaterialIds?: string[];
}
//# sourceMappingURL=director-workspace-session.d.ts.map