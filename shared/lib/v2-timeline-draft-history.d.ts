export interface V2TimelineDraftHistoryCardInput {
    draftId: string;
    creationMode: 'sample_replicate' | 'material_brief' | 'text_to_video';
    createdAt: string;
    updatedAt: string;
    latestRun?: {
        status: 'running' | 'completed' | 'failed';
        outputUrl?: string;
    };
}
export interface V2TimelineDraftHistoryCard {
    id: string;
    title: string;
    status: 'draft' | 'running' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
    previewUrl?: string;
}
export declare function mapV2TimelineDraftHistoryCard(draft: V2TimelineDraftHistoryCardInput): V2TimelineDraftHistoryCard;
//# sourceMappingURL=v2-timeline-draft-history.d.ts.map