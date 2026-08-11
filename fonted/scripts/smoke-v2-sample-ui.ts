import assert from 'node:assert/strict'

import {
  buildV2SampleProgressSegments,
  buildV2SampleTimelineProject,
  v2SampleShotIdFromClipId,
} from '../src/lib/v2-sample-ui.ts'
import type { V2SampleUnderstandingResult } from '../../shared/types/v2-sample-understanding.ts'

const understanding: V2SampleUnderstandingResult = {
  schema_version: 'v2_sample_understanding.v2',
  task_id: 'sample_ui_smoke',
  source: 'heuristic',
  sample: { duration_sec: 6 },
  summary: '样例表达方法摘要',
  content_observations: [{ statement: '晨雾山谷逐渐显现', evidence_ranges: [{ start_sec: 0, end_sec: 3 }] }],
  method_observations: [{ id: 'method_1', expression: '缓慢推近', purpose: '建立环境', timing_rationale: '开场逐步揭示', evidence_ranges: [{ start_sec: 0, end_sec: 3 }] }],
  transferable_knowledge: [{ statement: '以渐进揭示建立环境', applicability: '环境开场', evidence_method_ids: ['method_1'] }],
  shot_evidence: [{ id: 'shot_1', start_sec: 0, end_sec: 3, boundary: 'soft_transition', confidence: 0.9, description: '晨雾山谷' }],
  questions: [],
  warnings: [],
}

const project = buildV2SampleTimelineProject(understanding)
assert.equal(project.duration_sec, 6)
assert.equal(project.clips.some((clip) => clip.id === 'v2-sample-shot-shot_1'), true)
assert.equal(project.clips[0]?.visual_generation_prompt?.includes('建立环境'), true)
assert.equal(v2SampleShotIdFromClipId('v2-sample-shot-shot_1'), 'shot_1')
assert.deepEqual(buildV2SampleProgressSegments(understanding), [{ id: 'shot_1', label: '晨雾山谷', startSec: 0, endSec: 3 }])

console.info('[smoke-v2-sample-ui] OK')
