import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildOutlineFromStructure, buildTimelineFromStructure, } from '../lib/pipeline-builder.js';
import { buildRenderPlanFromStructure } from '../lib/render-plan-builder.js';
const MOCKS_DIR = [
    typeof __filename === 'string'
        ? path.resolve(path.dirname(__filename), '../mocks')
        : undefined,
    process.env.INIT_CWD
        ? path.resolve(process.env.INIT_CWD, '../shared/mocks')
        : undefined,
    process.argv[1]
        ? path.resolve(path.dirname(process.argv[1]), '../../shared/mocks')
        : undefined,
    path.resolve(process.cwd(), '../shared/mocks'),
    path.resolve(process.cwd(), 'shared/mocks'),
    path.resolve(process.cwd(), 'mocks'),
].find((candidate) => Boolean(candidate && existsSync(candidate))) ??
    path.resolve(process.cwd(), '../shared/mocks');
function readJson(filename) {
    const raw = readFileSync(path.join(MOCKS_DIR, filename), 'utf-8');
    return JSON.parse(raw);
}
export function loadMockIngest() {
    return readJson('01-video-ingest.json');
}
export function loadMockStructure() {
    return readJson('02-analysis-result.v1.2.json');
}
export function loadMockMaterials() {
    const data = readJson('03-user-materials.json');
    return data.materials;
}
/** 组装完整 Pipeline Mock 包 */
export function buildMockPipelineBundle(taskId, taskStatus = 'WAITING_USER_EDIT', options) {
    const ingest = loadMockIngest();
    const structure = options?.structure ?? loadMockStructure();
    const materials = loadMockMaterials();
    const timeline = buildTimelineFromStructure(structure);
    const outline = buildOutlineFromStructure(structure);
    const render_plan = buildRenderPlanFromStructure({
        taskId,
        structure,
        materials,
    });
    return {
        task_id: taskId,
        task_status: taskStatus,
        ingest,
        structure,
        timeline,
        materials,
        outline,
        render_plan,
    };
}
//# sourceMappingURL=load-mocks.js.map