import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { OutlineSegment } from '../types/pipeline.js';
import type { TimelineProject } from '../types/timeline-protocol.js';
/** 从 v1.2 structure 推导时间线工程。字幕保留在 RenderPlan overlays，不再生成独立轨道。 */
export declare function buildTimelineFromStructure(structure: MigrationProtocolV12): TimelineProject;
/** 从 v1.2 structure 推导左侧大纲。 */
export declare function buildOutlineFromStructure(structure: MigrationProtocolV12): OutlineSegment[];
export declare function formatOutlineDuration(start: number, end: number): string;
//# sourceMappingURL=pipeline-builder.d.ts.map