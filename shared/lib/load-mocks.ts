import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  buildOutlineFromStructure,
  buildTimelineFromStructure,
} from '../lib/pipeline-builder.js'
import { buildRenderPlanFromStructure } from '../lib/render-plan-builder.js'
import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js'
import type {
  PipelineBundle,
  UserMaterialDto,
  VideoIngest,
} from '../types/pipeline.js'

const MOCKS_DIR =
  [
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
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ??
  path.resolve(process.cwd(), '../shared/mocks')

function readJson<T>(filename: string): T {
  const raw = readFileSync(path.join(MOCKS_DIR, filename), 'utf-8')
  return JSON.parse(raw) as T
}

export function loadMockIngest(): VideoIngest {
  return readJson<VideoIngest>('01-video-ingest.json')
}

export function loadMockStructure(): MigrationProtocolV12 {
  return readJson<MigrationProtocolV12>('02-analysis-result.v1.2.json')
}

export function loadMockMaterials(): UserMaterialDto[] {
  const data = readJson<{ materials: UserMaterialDto[] }>(
    '03-user-materials.json',
  )
  return data.materials
}

/** 组装完整 Pipeline Mock 包 */
export function buildMockPipelineBundle(
  taskId: string,
  taskStatus: PipelineBundle['task_status'] = 'WAITING_USER_EDIT',
  options?: { structure?: MigrationProtocolV12 },
): PipelineBundle {
  const ingest = loadMockIngest()
  const structure = options?.structure ?? loadMockStructure()
  const materials = loadMockMaterials()
  const timeline = buildTimelineFromStructure(structure)
  const outline = buildOutlineFromStructure(structure)
  const render_plan = buildRenderPlanFromStructure({
    taskId,
    structure,
    materials,
  })

  return {
    task_id: taskId,
    task_status: taskStatus,
    ingest,
    structure,
    timeline,
    materials,
    outline,
    render_plan,
  }
}
