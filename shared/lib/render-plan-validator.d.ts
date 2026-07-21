import type { DirectorFailureCode, DirectorToolResult } from '../types/director-action.js';
import type { RenderPlanV1 } from '../types/render-plan.v1.js';
export type RenderPlanValidationPhase = 'before_save' | 'before_render';
export interface RenderPlanValidationIssue {
    code: DirectorFailureCode;
    path: string;
    message: string;
    severity: 'error' | 'warning';
    recoverable: boolean;
}
export interface RenderPlanValidationReport {
    phase: RenderPlanValidationPhase;
    valid: boolean;
    durationSec?: number;
    sceneCount: number;
    assetCount: number;
    issues: RenderPlanValidationIssue[];
}
export interface RenderPlanValidationInput {
    renderPlan?: RenderPlanV1 | null;
    phase?: RenderPlanValidationPhase;
    allowPlaceholderUrls?: boolean;
}
export declare function validateRenderPlanHard(input: RenderPlanValidationInput): DirectorToolResult<RenderPlanValidationReport>;
export declare function formatRenderPlanValidationFailure(result: DirectorToolResult<RenderPlanValidationReport>): string;
export declare function assertRenderPlanValid(input: RenderPlanValidationInput): RenderPlanValidationReport;
//# sourceMappingURL=render-plan-validator.d.ts.map