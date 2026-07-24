const CREATION_MODE_LABEL = {
    sample_replicate: '样例复刻方案',
    material_brief: '素材成片方案',
    text_to_video: '文生视频方案',
};
export function mapV2TimelineDraftHistoryCard(draft) {
    const runStatus = draft.latestRun?.status;
    return {
        id: draft.draftId,
        title: CREATION_MODE_LABEL[draft.creationMode],
        status: runStatus === 'completed'
            ? 'completed'
            : runStatus === 'running'
                ? 'running'
                : runStatus === 'failed'
                    ? 'failed'
                    : 'draft',
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        previewUrl: runStatus === 'completed' ? draft.latestRun?.outputUrl : undefined,
    };
}
//# sourceMappingURL=v2-timeline-draft-history.js.map