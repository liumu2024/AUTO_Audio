function nowIso() {
    return new Date().toISOString();
}
function id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function phaseForAction(type) {
    if (type === 'ANALYZE_SAMPLE')
        return 'sample_analyzing';
    if (type === 'GENERATE_TIMELINE')
        return 'plan_drafting';
    if (type === 'REVISE_TIMELINE' || type === 'REQUEST_PLUGIN')
        return 'plan_editing';
    if (type === 'RENDER_VIDEO')
        return 'rendering';
    return 'idle';
}
function completedPhaseForAction(type) {
    if (type === 'ANALYZE_SAMPLE')
        return 'sample_ready';
    if (type === 'GENERATE_TIMELINE' || type === 'REVISE_TIMELINE' || type === 'REQUEST_PLUGIN') {
        return 'plan_editing';
    }
    if (type === 'RENDER_VIDEO')
        return 'render_done';
    return 'idle';
}
function trimLedger(ledger) {
    return ledger.slice(-20);
}
function maybePlanSteps(steps) {
    return steps.length ? steps : undefined;
}
function createPlanStepRuns(action) {
    return (action.payload?.executionPlan?.steps ?? []).map((step) => ({
        ...step,
        status: 'planned',
    }));
}
function markFirstPlannedStepRunning(steps, startedAt) {
    if (!steps?.length)
        return steps;
    let didMark = false;
    return steps.map((step) => {
        if (didMark || step.status !== 'planned')
            return step;
        didMark = true;
        return {
            ...step,
            status: 'running',
            startedAt: step.startedAt ?? startedAt,
        };
    });
}
function markAllStepsCompleted(steps, completedAt) {
    if (!steps?.length)
        return steps;
    return steps.map((step) => ({
        ...step,
        status: 'completed',
        startedAt: step.startedAt ?? completedAt,
        completedAt,
    }));
}
function findStepIndexByTool(steps, tools) {
    return steps.findIndex((step) => tools.includes(step.tool));
}
function failedStepIndexForError(steps, code, actionType) {
    const preferredTools = {
        MISSING_SAMPLE: ['sample_understanding.analyze'],
        MISSING_MATERIAL: ['material.analyze_basic'],
        MISSING_TIMELINE: ['timeline.validate', 'timeline.plan'],
        TIMELINE_NOT_SAVED: ['timeline.validate'],
        TIMELINE_SCHEMA_INVALID: ['timeline.validate', 'timeline.plan', 'timeline.revise'],
        UNSUPPORTED_COMPONENT: ['timeline.effect_map', 'timeline.validate'],
        RESOURCE_NOT_FOUND: ['timeline.validate', 'material.analyze_basic', 'video.render'],
        RENDER_FAILED: ['video.render'],
    };
    const byCode = preferredTools[code];
    if (byCode) {
        const index = findStepIndexByTool(steps, byCode);
        if (index >= 0)
            return index;
    }
    if (actionType === 'ANALYZE_SAMPLE') {
        const index = findStepIndexByTool(steps, ['sample_understanding.analyze']);
        if (index >= 0)
            return index;
    }
    if (actionType === 'GENERATE_TIMELINE') {
        const index = findStepIndexByTool(steps, ['timeline.plan']);
        if (index >= 0)
            return index;
    }
    if (actionType === 'REVISE_TIMELINE') {
        const index = findStepIndexByTool(steps, ['timeline.revise']);
        if (index >= 0)
            return index;
    }
    if (actionType === 'RENDER_VIDEO') {
        const index = findStepIndexByTool(steps, ['video.render']);
        if (index >= 0)
            return index;
    }
    return Math.max(0, steps.findIndex((step) => step.status === 'running'));
}
function markStepsFailed(steps, error, actionType, completedAt) {
    if (!steps?.length)
        return steps;
    const failedIndex = failedStepIndexForError(steps, error.code, actionType);
    return steps.map((step, index) => {
        if (index < failedIndex) {
            return {
                ...step,
                status: 'completed',
                startedAt: step.startedAt ?? completedAt,
                completedAt: step.completedAt ?? completedAt,
            };
        }
        if (index === failedIndex) {
            return {
                ...step,
                status: 'failed',
                startedAt: step.startedAt ?? completedAt,
                completedAt,
                error: {
                    ...error,
                    stepId: step.id,
                    tool: step.tool,
                },
            };
        }
        return {
            ...step,
            status: 'skipped',
            completedAt,
        };
    });
}
export function createInitialDirectorSessionState() {
    return {
        phase: 'idle',
        sampleStatus: 'missing',
        materialStatus: 'missing',
        actionLedger: [],
    };
}
export function classifyDirectorFailure(message, actionType) {
    const lower = message.toLowerCase();
    const upper = message.toUpperCase();
    const knownCodes = [
        'ARK_FILE_QUOTA_EXCEEDED',
        'API_KEY_INVALID',
        'MISSING_SAMPLE',
        'MISSING_MATERIAL',
        'MISSING_TIMELINE',
        'TIMELINE_NOT_SAVED',
        'TIMELINE_SCHEMA_INVALID',
        'UNSUPPORTED_COMPONENT',
        'RESOURCE_NOT_FOUND',
        'RENDER_FAILED',
        'UNKNOWN',
    ];
    const codeFromMessage = knownCodes.find((code) => upper.includes(code));
    if (codeFromMessage)
        return codeFromMessage;
    if (message.includes('FileQuotaExceeded') || lower.includes('file storage quota')) {
        return 'ARK_FILE_QUOTA_EXCEEDED';
    }
    if (message.includes('AuthenticationError') || message.includes('API Key') || message.includes('Unauthorized')) {
        return 'API_KEY_INVALID';
    }
    if (/缺少样例|上传.*样例|sample.*missing|missing.*sample/i.test(message)) {
        return 'MISSING_SAMPLE';
    }
    if (/缺.*素材|reference material|materialStatus|missing.*material|no visual material/i.test(message)) {
        return 'MISSING_MATERIAL';
    }
    if (/activeTask|not synced|未同步|未保存|sync/i.test(message)) {
        return 'TIMELINE_NOT_SAVED';
    }
    if (/缺少.*时间线|没有.*方案|先.*生成.*方案/i.test(message)) {
        return 'MISSING_TIMELINE';
    }
    if (/schema|zod|invalid json|validation failed|校验失败|结构不合法/i.test(message)) {
        return 'TIMELINE_SCHEMA_INVALID';
    }
    if (/enoent|not found|404|资源.*不存在|文件.*不存在|asset.*missing/i.test(message)) {
        return 'RESOURCE_NOT_FOUND';
    }
    if (/component|plugin|preset|capability|组件|插件|能力缺失/i.test(message)) {
        return 'UNSUPPORTED_COMPONENT';
    }
    if (/remotion|render failed|generation failed|generator|渲染失败|生成失败/i.test(message)) {
        return 'RENDER_FAILED';
    }
    return actionType === 'RENDER_VIDEO' ? 'RENDER_FAILED' : 'UNKNOWN';
}
export function directorToolErrorFromMessage(message, actionType) {
    const code = classifyDirectorFailure(message, actionType);
    return {
        code,
        message,
        recoverable: code !== 'UNKNOWN',
    };
}
export function recoverableErrorFromMessage(message, actionType) {
    const code = classifyDirectorFailure(message, actionType);
    const suggestionsByCode = {
        ARK_FILE_QUOTA_EXCEEDED: [
            {
                label: '清理 Ark 历史文件后重试',
                action: { type: 'ANALYZE_SAMPLE', message: '清理 Ark 文件额度后重新解析样例。' },
            },
        ],
        API_KEY_INVALID: [
            {
                label: '更新 API Key 后重试',
                action: { type: actionType ?? 'ASK_USER', message: '请更新后端 API Key 后重试。' },
            },
        ],
        MISSING_SAMPLE: [
            {
                label: '先上传样例视频',
                action: { type: 'ANALYZE_SAMPLE', message: '请先上传参考样例，再进行样例理解。' },
            },
        ],
        MISSING_MATERIAL: [
            {
                label: '补充成片素材',
                action: { type: 'ASK_USER', message: '请上传用于成片的图片或视频素材，样例只作为风格参考。' },
            },
        ],
        MISSING_TIMELINE: [
            {
                label: '先生成方案',
                action: { type: 'GENERATE_TIMELINE', message: '先生成可编辑时间线方案。' },
            },
        ],
        TIMELINE_NOT_SAVED: [
            {
                label: '先同步当前方案',
                action: { type: 'REVISE_TIMELINE', message: '请先保存或同步当前时间线方案后再渲染。' },
            },
        ],
        TIMELINE_SCHEMA_INVALID: [
            {
                label: '修复方案结构',
                action: { type: 'GENERATE_TIMELINE', message: '重新生成或局部修复时间线结构。' },
            },
        ],
        UNSUPPORTED_COMPONENT: [
            {
                label: '降级为基础效果',
                action: {
                    type: 'REQUEST_PLUGIN',
                    message: '记录缺失组件能力，并使用基础 Remotion 效果兜底。',
                },
            },
        ],
        RESOURCE_NOT_FOUND: [
            {
                label: '替换缺失素材',
                action: { type: 'ASK_USER', message: '请重新上传或替换缺失的素材资源。' },
            },
        ],
        RENDER_FAILED: [
            {
                label: '降级效果后重试',
                action: { type: 'RENDER_VIDEO', message: '关闭复杂效果后重新提交渲染。' },
            },
        ],
        UNKNOWN: [
            {
                label: '查看技术详情',
                action: { type: 'ASK_USER', message: '请查看技术详情后选择下一步。' },
            },
        ],
    };
    return {
        code,
        message,
        suggestions: suggestionsByCode[code],
    };
}
export function syncDirectorSessionSnapshot(previous, input) {
    const base = previous ?? createInitialDirectorSessionState();
    const timeline = input.timeline;
    const currentRevision = timeline?.currentRevision;
    const hasTimeline = Boolean(timeline && timeline.status !== 'missing');
    const sampleStatus = input.isSampleParsed
        ? 'parsed'
        : input.sampleUrl?.trim()
            ? 'uploaded'
            : 'missing';
    const materialStatus = input.hasVisualMaterial
        ? 'ready'
        : input.materialCount > 0
            ? 'partial'
            : 'missing';
    let phase = base.phase;
    if (phase === 'idle' || phase === 'sample_ready' || phase === 'plan_editing' || phase === 'render_done') {
        if (timeline?.status === 'draft' ||
            timeline?.status === 'dirty' ||
            timeline?.status === 'failed' ||
            timeline?.status === 'saving' ||
            timeline?.status === 'rendering') {
            phase = 'plan_editing';
        }
        else if (hasTimeline) {
            phase = timeline?.renderedRevision === currentRevision ? 'render_done' : 'plan_editing';
        }
        else if (sampleStatus === 'parsed') {
            phase = 'sample_ready';
        }
        else {
            phase = 'idle';
        }
    }
    return {
        ...base,
        taskId: input.taskId ?? undefined,
        phase,
        sampleStatus,
        materialStatus,
        timeline,
    };
}
export function recordDirectorActionPlanned(input) {
    const record = {
        id: id('act'),
        type: input.action.type,
        prompt: input.prompt,
        phaseBefore: input.state.phase,
        phaseAfter: phaseForAction(input.action.type),
        status: 'planned',
        revisionBefore: input.state.timeline?.currentRevision,
        message: input.action.message,
        planSteps: maybePlanSteps(createPlanStepRuns(input.action)),
        createdAt: nowIso(),
    };
    return {
        ...input.state,
        phase: record.phaseAfter,
        lastAction: record,
        lastError: undefined,
        actionLedger: trimLedger([...input.state.actionLedger, record]),
    };
}
export function recordDirectorActionRunning(input) {
    const lastAction = input.state.lastAction;
    if (!lastAction)
        return input.state;
    const startedAt = nowIso();
    const record = {
        ...lastAction,
        status: 'running',
        planSteps: markFirstPlannedStepRunning(lastAction.planSteps, startedAt),
    };
    return {
        ...input.state,
        lastAction: record,
        actionLedger: trimLedger(input.state.actionLedger.map((item) => (item.id === record.id ? record : item))),
    };
}
export function recordDirectorActionCompleted(input) {
    const lastAction = input.state.lastAction;
    const phaseAfter = completedPhaseForAction(input.outcome.action);
    const completedAt = nowIso();
    const record = lastAction
        ? {
            ...lastAction,
            status: 'completed',
            phaseAfter,
            revisionAfter: input.timeline?.currentRevision ??
                input.state.timeline?.currentRevision,
            message: input.outcome.message,
            planSteps: markAllStepsCompleted(lastAction.planSteps, completedAt),
            completedAt,
        }
        : undefined;
    const currentTimeline = input.timeline ?? input.state.timeline;
    const completedTimeline = currentTimeline
        ? {
            ...currentTimeline,
            status: input.outcome.action === 'RENDER_VIDEO'
                ? 'rendered'
                : currentTimeline.status,
            renderedRevision: input.outcome.action === 'RENDER_VIDEO'
                ? currentTimeline.currentRevision
                : currentTimeline.renderedRevision,
        }
        : undefined;
    return {
        ...input.state,
        phase: phaseAfter,
        timeline: completedTimeline,
        lastAction: record ?? input.state.lastAction,
        lastError: undefined,
        actionLedger: record
            ? trimLedger(input.state.actionLedger.map((item) => (item.id === record.id ? record : item)))
            : input.state.actionLedger,
    };
}
export function recordDirectorActionFailed(input) {
    const error = recoverableErrorFromMessage(input.error, input.actionType);
    const toolError = directorToolErrorFromMessage(input.error, input.actionType);
    const lastAction = input.state.lastAction;
    const completedAt = nowIso();
    const record = lastAction
        ? {
            ...lastAction,
            status: 'failed',
            phaseAfter: 'failed',
            error: input.error,
            planSteps: markStepsFailed(lastAction.planSteps, toolError, input.actionType, completedAt),
            completedAt,
        }
        : undefined;
    const failedTimeline = input.state.timeline
        ? {
            ...input.state.timeline,
            status: input.actionType === 'RENDER_VIDEO' ? 'failed' : input.state.timeline.status,
        }
        : undefined;
    return {
        ...input.state,
        phase: 'failed',
        timeline: failedTimeline,
        lastError: error,
        lastAction: record ?? input.state.lastAction,
        actionLedger: record
            ? trimLedger(input.state.actionLedger.map((item) => (item.id === record.id ? record : item)))
            : input.state.actionLedger,
    };
}
export function summarizeDirectorSessionState(state) {
    if (!state)
        return 'No director session state yet.';
    const timeline = state.timeline;
    const revision = timeline?.currentRevision
        ? `revision ${timeline.currentRevision}`
        : 'no revision';
    const rendered = timeline?.renderedRevision
        ? `rendered revision ${timeline.renderedRevision}`
        : 'not rendered';
    const diff = timeline?.lastChangeSummary
        ? `Last change: ${timeline.lastChangeSummary}`
        : 'No recent change.';
    const error = state.lastError ? `Last error: ${state.lastError.code}` : 'No active error.';
    const activeStep = state.lastAction?.planSteps?.find((step) => step.status === 'running' || step.status === 'failed');
    const step = activeStep
        ? `Last plan step: ${activeStep.id} (${activeStep.tool}) ${activeStep.status}`
        : 'No active plan step.';
    return [
        `Phase: ${state.phase}`,
        `Sample: ${state.sampleStatus}`,
        `Materials: ${state.materialStatus}`,
        `Timeline: ${timeline?.status ?? 'missing'}, ${revision}, ${rendered}`,
        step,
        diff,
        error,
    ].join('\n');
}
//# sourceMappingURL=director-state-machine.js.map