export interface V2TimelineDraftHistoryCardInput {
    draftId: string;
    creationMode: 'sample_replicate' | 'material_brief' | 'text_to_video';
    title?: string;
    summary?: string;
    aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3';
    durationSec?: number;
    sceneCount?: number;
    visibleTextCount?: number;
    revision?: number;
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
    summary?: string;
    modeLabel: string;
    aspectRatio?: V2TimelineDraftHistoryCardInput['aspectRatio'];
    durationSec?: number;
    sceneCount?: number;
    visibleTextCount?: number;
    revision?: number;
    status: 'draft' | 'running' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
    previewUrl?: string;
}
export declare function mapV2TimelineDraftHistoryCard(draft: V2TimelineDraftHistoryCardInput): V2TimelineDraftHistoryCard;
//# sourceMappingURL=v2-timeline-draft-history.d.ts.map