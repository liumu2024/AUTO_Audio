import { directorIntentToUserIntent, mergeDirectorSlots, } from './director-understanding.js';
function includesPluginRequest(text) {
    return /插件|plugin|component|能力缺失|missing capability/i.test(text);
}
function extractPluginId(text) {
    const match = text.match(/(?:plugin[_-]?id|插件)[:：\s]+([a-z0-9_/-]+)/i);
    return match?.[1];
}
export function mapNextActionToDirectorActionType(result) {
    if (result.intent === 'analyze_materials' && result.nextAction !== 'ANALYZE_SAMPLE') {
        return 'ANALYZE_MATERIALS';
    }
    const map = {
        NEED_BACKEND: 'ASK_USER',
        NEED_SAMPLE: 'ASK_USER',
        ANALYZE_SAMPLE: 'ANALYZE_SAMPLE',
        GENERATE_TIMELINE: 'GENERATE_TIMELINE',
        RENDER: 'RENDER_VIDEO',
        REVISE_TIMELINE: 'REVISE_TIMELINE',
        ACKNOWLEDGE: 'ASK_USER',
        ASK_USER: 'ASK_USER',
        WAIT: 'ASK_USER',
    };
    return map[result.nextAction] ?? 'ASK_USER';
}
function planStep(id, tool, reason, retryLimit = 0) {
    return {
        id,
        tool,
        reason,
        required: true,
        retryLimit,
    };
}
export function buildExecutionPlanFromDirectorAction(action) {
    const stepsByAction = {
        ANALYZE_SAMPLE: [
            planStep('analyze_sample', 'sample_understanding.analyze', 'Analyze the reference sample for structure, rhythm, style, and reusable constraints.', 1),
        ],
        ANALYZE_MATERIALS: [
            planStep('analyze_materials', 'material.analyze_basic', 'Read user materials as candidate assets for the final video.'),
        ],
        GENERATE_TIMELINE: [
            planStep('analyze_materials', 'material.analyze_basic', 'Refresh material facts before planning scenes.'),
            planStep('plan_v2_timeline', 'timeline.plan', '根据样例结构、用户意图和素材生成 V2 时间线方案。'),
            planStep('map_timeline_effects', 'timeline.effect_map', '把风格和动效意图映射到当前 Remotion 时间线能力。'),
            planStep('validate_v2_timeline', 'timeline.validate', '在保存前检查时间线结构、素材引用和可渲染性。'),
        ],
        REVISE_TIMELINE: [
            planStep('revise_v2_timeline', 'timeline.revise', '把用户修改要求应用到当前可编辑时间线方案。'),
            planStep('validate_v2_timeline', 'timeline.validate', '检查修改后的时间线方案是否仍可渲染。'),
        ],
        RENDER_VIDEO: [
            planStep('validate_v2_timeline', 'timeline.validate', '提交渲染前检查已保存的 V2 时间线方案。'),
            planStep('render_video', 'video.render', '使用 Remotion 渲染已保存的 V2 时间线方案。', 1),
        ],
        ASK_USER: [
            planStep('ask_user', 'user.ask', 'Ask for missing information or acknowledge the user without starting backend work.'),
        ],
        REQUEST_PLUGIN: [
            planStep('request_plugin', 'user.ask', 'Record the missing capability and ask how to proceed.'),
        ],
    };
    return {
        version: 'director_plan_v2',
        sourceAction: action.type,
        steps: stepsByAction[action.type],
    };
}
export function directorActionFromIntentResult(input) {
    const { result } = input;
    const slots = mergeDirectorSlots(input.context.slots, result.slotsPatch);
    const intent = directorIntentToUserIntent(result, input.context.userIntent, input.prompt);
    let type = mapNextActionToDirectorActionType(result);
    const payload = {
        missingSlots: result.missingSlots,
        requiresConfirmation: result.requiresConfirmation,
        ...(result.executionEffect && result.executionEffect !== 'none'
            ? { executionEffect: result.executionEffect, authorizationEvidence: result.authorizationEvidence }
            : {}),
    };
    if (includesPluginRequest(input.prompt)) {
        type = 'REQUEST_PLUGIN';
        payload.pluginId = extractPluginId(input.prompt);
    }
    payload.executionPlan = buildExecutionPlanFromDirectorAction({ type });
    return {
        type,
        message: result.assistantMessage,
        intent,
        slots,
        result,
        payload,
    };
}
export async function executeDirectorAction(input) {
    const { action, executor, context } = input;
    switch (action.type) {
        case 'ANALYZE_SAMPLE':
            return executor.analyzeSample(context);
        case 'ANALYZE_MATERIALS':
            return executor.analyzeMaterials(context);
        case 'GENERATE_TIMELINE':
            return executor.generateTimeline(context);
        case 'REVISE_TIMELINE':
            return executor.reviseTimeline(context);
        case 'RENDER_VIDEO':
            return executor.renderVideo(context);
        case 'REQUEST_PLUGIN':
            return executor.requestPlugin(context, action);
        case 'ASK_USER':
        default:
            return executor.askUser(context, action);
    }
}
//# sourceMappingURL=director-action-engine.js.map