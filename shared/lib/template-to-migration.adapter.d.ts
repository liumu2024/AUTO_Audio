import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { UserMaterialDto } from '../types/pipeline.js';
import type { TemplateSchemaV1 } from '../types/template-schema.v1.js';
/**
 * TemplateSchemaV1 → MigrationProtocolV12（编辑器 / 时间线兼容层）
 *
 * 样例理解层产出导演脚本模板；主链路仍消费 v1.2 semantic_anchors。
 */
export declare function templateToMigrationProtocolV12(template: TemplateSchemaV1, input: {
    videoUrl: string;
    taskId: string;
    materials?: UserMaterialDto[];
}): MigrationProtocolV12;
//# sourceMappingURL=template-to-migration.adapter.d.ts.map