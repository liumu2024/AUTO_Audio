import type { DirectorContentDomain, DirectorContextSlots, DirectorMaterialSummary, DirectorReferenceSummary } from '../types/director-context.js';
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
export declare function inferContentDomain(text: string): DirectorContentDomain;
export declare function isLandscapeLikeDomain(domain: DirectorContentDomain): boolean;
export declare function summarizeDirectorReference(understanding: V2SampleUnderstandingResult): DirectorReferenceSummary;
export interface DirectorMaterialSummaryInput {
    id: string;
    type: 'video' | 'image' | 'audio';
    name?: string;
    tags?: string[];
    durationSec?: number;
}
export declare function summarizeDirectorMaterial(material: DirectorMaterialSummaryInput): DirectorMaterialSummary;
//# sourceMappingURL=director-understanding.d.ts.map