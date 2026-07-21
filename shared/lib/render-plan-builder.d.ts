import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { UserMaterialDto } from '../types/pipeline.js';
import type { RenderPlanV1 } from '../types/render-plan.v1.js';
import type { RenderAspectRatio } from './render-canvas.js';
export interface RenderPlanSampleReference {
    id?: string;
    name?: string;
    url: string;
    duration_sec?: number;
    use_audio?: boolean;
}
export declare function buildRenderPlanFromStructure(input: {
    taskId: string;
    structure: MigrationProtocolV12;
    materials: UserMaterialDto[];
    aspectRatio?: RenderAspectRatio;
    sampleReference?: RenderPlanSampleReference;
}): RenderPlanV1;
//# sourceMappingURL=render-plan-builder.d.ts.map