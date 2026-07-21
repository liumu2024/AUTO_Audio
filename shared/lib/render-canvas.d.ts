import type { RenderPlanV1 } from '../types/render-plan.v1.js';
export type RenderAspectRatio = RenderPlanV1['canvas']['ratio'];
export declare const DEFAULT_RENDER_ASPECT_RATIO: RenderAspectRatio;
export declare const RENDER_ASPECT_RATIO_OPTIONS: Array<{
    value: RenderAspectRatio;
    label: string;
}>;
export declare function normalizeRenderAspectRatio(value: unknown): RenderAspectRatio;
export declare function buildRenderCanvas(aspectRatio?: RenderAspectRatio | unknown): RenderPlanV1['canvas'];
export declare function applyAspectRatioToRenderPlan(plan: RenderPlanV1, aspectRatio: RenderAspectRatio): RenderPlanV1;
export declare function aspectRatioToTailwindClass(ratio: RenderAspectRatio): string;
//# sourceMappingURL=render-canvas.d.ts.map