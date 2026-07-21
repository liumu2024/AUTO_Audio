import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { PipelineBundle, UserMaterialDto, VideoIngest } from '../types/pipeline.js';
export declare function loadMockIngest(): VideoIngest;
export declare function loadMockStructure(): MigrationProtocolV12;
export declare function loadMockMaterials(): UserMaterialDto[];
/** 组装完整 Pipeline Mock 包 */
export declare function buildMockPipelineBundle(taskId: string, taskStatus?: PipelineBundle['task_status'], options?: {
    structure?: MigrationProtocolV12;
}): PipelineBundle;
//# sourceMappingURL=load-mocks.d.ts.map