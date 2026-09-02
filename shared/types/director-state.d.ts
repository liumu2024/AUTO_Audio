/**
 * The product-facing state for whichever timeline is currently editable.
 * V2 uses this shape instead of borrowing fields from a legacy protocol.
 */
export type DirectorTimelineStatus = 'missing' | 'draft' | 'dirty' | 'saving' | 'saved' | 'rendering' | 'rendered' | 'failed';
export interface DirectorTimelineSnapshot {
    kind: 'v2_timeline';
    status: DirectorTimelineStatus;
    draftId?: string;
    currentRevision?: number;
    savedRevision?: number;
    renderedRevision?: number;
    lastRunId?: string;
    selectedClipId?: string;
    selectedSceneId?: string;
    lastChangeSummary?: string;
}
//# sourceMappingURL=director-state.d.ts.map