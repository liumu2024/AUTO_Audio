import { mergeDirectorSlots } from './director-understanding.js';
function mapNextActionToDirectorActionType(result) {
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
export function directorActionFromIntentResult(input) {
    const { result } = input;
    const slots = mergeDirectorSlots(input.context.slots, result.slotsPatch);
    const taskGoal = result.intent === 'analyze_sample'
        || result.intent === 'analyze_materials'
        || result.intent === 'generate_timeline'
        || result.intent === 'revise_timeline'
        || result.intent === 'render'
        ? result.intent
        : undefined;
    const intent = {
        ...input.context.userIntent,
        ...(taskGoal ? { goal: taskGoal } : {}),
        aspectRatio: result.slotsPatch.aspectRatio ?? input.context.userIntent.aspectRatio,
        durationSec: result.slotsPatch.durationSec ?? input.context.userIntent.durationSec,
        styleIntensity: result.slotsPatch.styleIntensity ?? input.context.userIntent.styleIntensity,
    };
    const type = mapNextActionToDirectorActionType(result);
    const payload = {
        missingSlots: result.missingSlots,
        requiresConfirmation: result.requiresConfirmation,
        ...(result.executionEffect && result.executionEffect !== 'none'
            ? { executionEffect: result.executionEffect, authorizationEvidence: result.authorizationEvidence }
            : {}),
    };
    return {
        type,
        message: result.assistantMessage,
        intent,
        slots,
        result,
        payload,
    };
}
//# sourceMappingURL=director-action-engine.js.map