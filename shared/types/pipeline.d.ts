import type { MigrationProtocolV12 } from './migration-protocol.v1.2.js';
import type { AssetAnalysisV1 } from './asset-analysis.v1.js';
import type { DirectorContext } from './director-context.js';
import type { RenderPlanV1 } from './render-plan.v1.js';
import type { TimelineProject } from './timeline-protocol.js';
/** 阶段 1：视频接入 / 传输 */
export interface VideoIngest {
    video_id: string;
    /** 样例原片 OSS / CDN URL */
    sample_video_url: string;
    duration_sec: number;
    format: string;
    width: number;
    height: number;
    thumbnail_url?: string;
}
/** 用户素材库条目（对应 Prisma UserMaterial） */
export interface UserMaterialDto {
    id: string;
    material_type: 'VIDEO' | 'IMAGE' | 'AUDIO';
    oss_url: string;
    label: string;
    ai_tags?: string[];
    asset_analysis?: AssetAnalysisV1;
    status: 'READY' | 'PROCESSING' | 'FAILED';
}
/** 样例拆解大纲条目（由 semantic_anchors 推导） */
export interface OutlineSegment {
    id: string;
    anchor_id: string;
    title: string;
    marketing_role: string;
    creative_role?: string;
    start_sec: number;
    end_sec: number;
}
/** 阶段 4：成片生成输出 */
export interface GenerationResult {
    final_video_url: string;
    duration_sec: number;
    generated_at: string;
    codec?: string;
}
export declare const TASK_STATUS: {
    readonly QUEUED: "QUEUED";
    readonly ANALYZING: "ANALYZING";
    readonly WAITING_USER_EDIT: "WAITING_USER_EDIT";
    readonly GENERATING: "GENERATING";
    readonly CANCELLING: "CANCELLING";
    readonly CANCELLED: "CANCELLED";
    readonly COMPLETED: "COMPLETED";
    readonly FAILED: "FAILED";
};
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
/** 全链路数据包 — 前后端 Mock / API 统一载体 */
export interface PipelineBundle {
    task_id: string;
    task_status: TaskStatus | string;
    /** 接入 */
    ingest: VideoIngest;
    /** 理解输出 v1.2 */
    structure: MigrationProtocolV12;
    /** 时间线（由 structure 构建） */
    timeline: TimelineProject;
    /** 素材库 */
    materials: UserMaterialDto[];
    /** 大纲（由 structure 构建） */
    outline: OutlineSegment[];
    /** 渲染执行计划（Remotion / FFmpeg 消费） */
    render_plan?: RenderPlanV1;
    director_context?: DirectorContext;
    /** 生成结果（可选，渲染完成后） */
    generation?: GenerationResult;
}
export interface TaskProgressEvent {
    progress: number;
    stage: string;
    log?: string;
}
//# sourceMappingURL=pipeline.d.ts.map