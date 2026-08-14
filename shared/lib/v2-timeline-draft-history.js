const CREATION_MODE_LABEL = {
    sample_replicate: '样例参考创作',
    material_brief: '素材成片方案',
    text_to_video: '文生视频方案',
};
export function v2TimelineCreationModeLabel(creationMode) {
    return CREATION_MODE_LABEL[creationMode];
}
export function mapV2TimelineDraftHistoryCard(draft) {
    const runStatus = draft.latestRun?.status;
    const modeLabel = v2TimelineCreationModeLabel(draft.creationMode);
    return {
        id: draft.draftId,
        title: draft.title?.trim() || modeLabel,
        summary: draft.summary?.trim() || undefined,
        modeLabel,
        aspectRatio: draft.aspectRatio,
        durationSec: draft.durationSec,
        sceneCount: draft.sceneCount,
        visibleTextCount: draft.visibleTextCount,
        revision: draft.revision,
        status: runStatus === 'completed'
            ? 'completed'
            : runStatus === 'running'
                ? 'running'
                : runStatus === 'failed'
                    ? 'failed'
                    : runStatus === 'cancelled'
                        ? 'cancelled'
                        : 'draft',
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        previewUrl: runStatus === 'completed' ? draft.latestRun?.outputUrl : undefined,
    };
}
//# sourceMappingURL=v2-timeline-draft-history.js.map