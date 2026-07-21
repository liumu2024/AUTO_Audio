import type { DirectorFailureCode, DirectorToolResult } from '../types/director-action.js';
import type { RenderPlanV1 } from '../types/render-plan.v1.js';
import { type RenderPlanValidationPhase, type RenderPlanValidationReport } from './render-plan-validator.js';
export interface RenderPlanRepairAction {
    id: string;
    code: DirectorFailureCode;
    path: string;
    message: string;
    applied: boolean;
}
export interface RenderPlanRepairReport {
    phase: RenderPlanValidationPhase;
    repaired: boolean;
    before: RenderPlanValidationReport;
    after?: RenderPlanValidationReport;
    actions: RenderPlanRepairAction[];
}
export interface RenderPlanRepairInput {
    renderPlan?: RenderPlanV1 | null;
    phase?: RenderPlanValidationPhase;
    allowPlaceholderUrls?: boolean;
    validation?: DirectorToolResult<RenderPlanValidationReport>;
    maxActions?: number;
}
export interface RenderPlanRepairOutput {
    plan?: RenderPlanV1;
    validation: DirectorToolResult<RenderPlanValidationReport>;
    report: RenderPlanRepairReport;
}
export declare function repairRenderPlanDeterministically(input: RenderPlanRepairInput): RenderPlanRepairOutput;
//# sourceMappingURL=render-plan-repair.d.ts.map