export function createDefaultDirectorSlots(partial) {
    return {
        sampleVideoStatus: 'missing',
        materialStatus: 'missing',
        contentDomain: 'general',
        aspectRatio: '9:16',
        styleIntensity: 'medium',
        ...partial,
    };
}
export function mergeDirectorSlots(base, patch) {
    return {
        ...base,
        ...patch,
        pendingConfirmation: patch.pendingConfirmation ?? base.pendingConfirmation,
    };
}
export function deriveRuntimeSlotStatus(runtime) {
    const sampleVideoStatus = runtime.isSampleParsed
        ? 'parsed'
        : runtime.sampleUrl.trim()
            ? 'attached'
            : 'missing';
    const materialStatus = runtime.hasVisualMaterial
        ? runtime.materialCount > 0
            ? 'ready'
            : 'partial'
        : 'missing';
    return { sampleVideoStatus, materialStatus };
}
export function summarizeDirectorReference(understanding) {
    return {
        source: 'sample_video',
        summary: understanding.summary,
        methodHighlights: understanding.method_observations.slice(0, 6).map((item) => item.expression),
        transferableKnowledge: understanding.transferable_knowledge.slice(0, 6).map((item) => item.statement),
        shotCount: (understanding.shot_evidence ?? []).filter((shot) => shot.confidence >= 0.6).length,
        warnings: understanding.warnings,
    };
}
//# sourceMappingURL=director-understanding.js.map