import type { DirectorContextSlots, DirectorReferenceSummary } from '../types/director-context.js';
import type { V2SampleUnderstandingResult } from '../types/v2-sample-understanding.js';
export interface DirectorConversationRuntime {
    backendEnabled: boolean;
    sampleUrl: string;
    sampleName?: string;
    isSampleParsed: boolean;
    activeTaskId?: string | null;
    hasV2Timeline?: boolean;
    v2TaskId?: string | null;
    v2SceneCount?: number;
    v2TraceDir?: string | null;
    hasVisualMaterial: boolean;
    materialCount: number;
    /** Video materials that the director may explicitly promote to a sample reference. */
    sampleCandidates?: Array<{
        id: string;
        url: string;
        name?: string;
    }>;
}
export declare function createDefaultDirectorSlots(partial?: Partial<DirectorContextSlots>): DirectorContextSlots;
export declare function mergeDirectorSlots(base: DirectorContextSlots, patch: Partial<DirectorContextSlots>): DirectorContextSlots;
export declare function deriveRuntimeSlotStatus(runtime: DirectorConversationRuntime): Pick<DirectorContextSlots, 'sampleVideoStatus' | 'materialStatus'>;
export declare function summarizeDirectorReference(understanding: V2SampleUnderstandingResult): DirectorReferenceSummary;
//# sourceMappingURL=director-understanding.d.ts.map