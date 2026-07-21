import type { DirectorContextSlots } from '../types/director-context.js';
import type { RenderAction, RenderActionBatch } from '../types/render-action.js';
import type { RenderPlanV1, SceneEffects } from '../types/render-plan.v1.js';
export declare function applyRenderAction(plan: RenderPlanV1, action: RenderAction): RenderPlanV1;
export declare function applyRenderActions(plan: RenderPlanV1, actions: RenderAction[]): RenderPlanV1;
export declare function applyRenderActionBatch(plan: RenderPlanV1, batch: RenderActionBatch): RenderPlanV1;
/** 将 REVISE_RENDER_PLAN 的 slots 变更翻译为 RenderAction 列表 */
export declare function renderActionsFromSlotsPatch(slots: Partial<DirectorContextSlots>, plan: RenderPlanV1): RenderAction[];
export declare function sceneEffectFromPreset(preset: string): SceneEffects | undefined;
//# sourceMappingURL=render-action-engine.d.ts.map