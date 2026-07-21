import type { RenderAsset, RenderPlanV1 } from '../types/render-plan.v1.js';
/** 将用户素材绑定进 RenderPlan（不触发渲染） */
export declare function injectMaterialsIntoRenderPlan(input: {
    plan: RenderPlanV1;
    assets: RenderAsset[];
    prompt?: string;
}): RenderPlanV1;
//# sourceMappingURL=render-plan-materials.d.ts.map