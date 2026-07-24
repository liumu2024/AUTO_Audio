import assert from 'node:assert/strict'

import {
  buildV2SampleProgressSegments,
  buildV2SampleTimelineProject,
  v2SampleSegmentIdFromClipId,
} from '../src/lib/v2-sample-ui.ts'
import type { V2SampleUnderstandingResult } from '../../shared/types/v2-sample-understanding.ts'

const understanding: V2SampleUnderstandingResult = {
  schema_version: 'v2_sample_understanding.v1',
  task_id: 'sample_ui_smoke',
  source: 'heuristic',
  sample: { duration_sec: 6 },
  summary_zh: '样例结构摘要',
  story_zh: '故事',
  atmosphere_zh: '氛围',
  editing_zh: '剪辑',
  rhythm_zh: '节奏',
  reusable_style_zh: '可复用',
  not_reusable_zh: '不可复用',
  questions_for_user_zh: [],
  warnings_zh: [],
  segments: [{
    id: 'segment_1', title_zh: '开场', start_sec: 0, end_sec: 3,
    visual_content_zh: '晨雾山谷', characters_objects_zh: '山谷', atmosphere_zh: '宁静',
    camera_zh: '推进', motion_zh: '缓慢推进', editing_zh: '长镜头', rhythm_zh: '舒缓',
    transition_after_zh: '淡入', text_cues_zh: '清晨', reusable_style_zh: '留白', material_hint_zh: '风景素材',
  }],
}

const project = buildV2SampleTimelineProject(understanding)
assert.equal(project.duration_sec, 6)
assert.equal(project.clips.some((clip) => clip.id === 'v2-sample-segment-segment_1'), true)
assert.equal(project.clips.some((clip) => clip.track_id === 'overlay'), true)
assert.equal(v2SampleSegmentIdFromClipId('v2-sample-segment-segment_1-text'), 'segment_1')
assert.deepEqual(buildV2SampleProgressSegments(understanding), [{ id: 'segment_1', label: '开场', startSec: 0, endSec: 3 }])

console.info('[smoke-v2-sample-ui] OK')
