import { directorIntentToUserIntent, mergeDirectorSlots, routeDirectorConversation, } from './director-understanding.js';
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
        GENERATE_VIDEO: 'GENERATE_RENDER_PLAN',
        RENDER: 'RENDER_VIDEO',
        REVISE_PLAN: 'REVISE_RENDER_PLAN',
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
        GENERATE_RENDER_PLAN: [
            planStep('analyze_materials', 'material.analyze_basic', 'Refresh material facts before planning scenes.'),
            planStep('build_render_plan', 'render_plan.build', 'Build a structured RenderPlan from sample understanding, user intent, and materials.'),
            planStep('apply_effect_composition', 'effect_composition.apply', 'Map style and effect intent onto supported Remotion capabilities.'),
            planStep('validate_render_plan', 'render_plan.validate', 'Check schema, resources, and supported components before saving.'),
        ],
        REVISE_RENDER_PLAN: [
            planStep('revise_render_plan', 'render_plan.revise', 'Apply the requested change to the current editable RenderPlan.'),
            planStep('validate_render_plan', 'render_plan.validate', 'Check the revised RenderPlan before it can be rendered.'),
        ],
        RENDER_VIDEO: [
            planStep('validate_render_plan', 'render_plan.validate', 'Check the saved RenderPlan before submitting a render job.'),
            planStep('render_video', 'video.render', 'Render the saved RenderPlan with Remotion.', 1),
        ],
        ASK_USER: [
            planStep('ask_user', 'user.ask', 'Ask for missing information or acknowledge the user without starting backend work.'),
        ],
        REQUEST_PLUGIN: [
            planStep('request_plugin', 'user.ask', 'Record the missing capability and ask how to proceed.'),
        ],
    };
    return {
        version: 'director_plan_v1',
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
export function resolveDirectorAction(input) {
    const result = routeDirectorConversation({
        prompt: input.prompt,
        slots: input.context.slots,
        runtime: input.runtime,
    });
    return directorActionFromIntentResult({ ...input, result });
}
export async function executeDirectorAction(input) {
    const { action, executor, context } = input;
    switch (action.type) {
        case 'ANALYZE_SAMPLE':
            return executor.analyzeSample(context);
        case 'ANALYZE_MATERIALS':
            return executor.analyzeMaterials(context);
        case 'GENERATE_RENDER_PLAN':
            return executor.generateRenderPlan(context);
        case 'REVISE_RENDER_PLAN':
            return executor.reviseRenderPlan(context);
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