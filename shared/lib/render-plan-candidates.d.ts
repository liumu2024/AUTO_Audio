import type { RenderPlanV1 } from '../types/render-plan.v1.js';
import { type RenderPlanValidationPhase } from './render-plan-validator.js';
export interface RenderPlanCandidateMetrics {
    assetCoverage: number;
    uniqueAssetCoverage: number;
    effectLayerReadiness: number;
    timelineFit: number;
    promptFit: number;
    validationPenalty: number;
}
export interface RenderPlanCandidateSummary {
    id: string;
    label: string;
    score: number;
    metrics: RenderPlanCandidateMetrics;
    validationOk: boolean;
    warnings: string[];
    errors: string[];
}
export interface RenderPlanCandidate {
    id: string;
    label: string;
    plan: RenderPlanV1;
    score: number;
    metrics: RenderPlanCandidateMetrics;
    validationOk: boolean;
    warnings: string[];
    errors: string[];
}
export interface RenderPlanCandidateSelection {
    selected: RenderPlanCandidate;
    candidates: RenderPlanCandidate[];
    summary: {
        selectedId: string;
        candidates: RenderPlanCandidateSummary[];
    };
}
export interface RenderPlanCandidateInput {
    plan: RenderPlanV1;
    prompt?: string;
    phase?: RenderPlanValidationPhase;
}
export declare function selectRenderPlanCandidate(input: RenderPlanCandidateInput): RenderPlanCandidateSelection;
//# sourceMappingURL=render-plan-candidates.d.ts.map