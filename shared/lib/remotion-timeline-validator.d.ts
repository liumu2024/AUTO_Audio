import { type RemotionTimelineSpecV1 } from '../types/remotion-timeline-spec.v1.js';
export interface RemotionTimelineValidationIssue {
    path: string;
    message: string;
    severity: 'error' | 'warning';
}
export interface RemotionTimelineValidationReport {
    ok: boolean;
    issues: RemotionTimelineValidationIssue[];
    summary: {
        asset_count: number;
        scene_count: number;
        transition_count: number;
        overlay_count: number;
        material_job_count: number;
        duration_sec: number;
    };
}
export declare function validateRemotionTimelineSpec(value: unknown): RemotionTimelineValidationReport;
export declare function assertValidRemotionTimelineSpec(value: unknown): RemotionTimelineSpecV1;
//# sourceMappingURL=remotion-timeline-validator.d.ts.map