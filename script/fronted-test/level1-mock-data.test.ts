/**
 * 第一关：v1.2 Truth Source 数据结构校验
 * 运行: npm run test:level1
 */
import { mockProjectData } from '../../fonted/src/data/mockMigrationProject.ts'
import { mockTimelineProject } from '../../fonted/src/data/mockTimeline.ts'
import { assert, assertEqual, pass, section } from './shared/assertions.ts'

section('Level 1 — mockProjectData v1.2 Schema')

assertEqual(mockProjectData.version, '1.2', 'version')
assertEqual(mockProjectData.metadata.video_id, 'demo_001', 'metadata.video_id')
assertEqual(mockProjectData.metadata.duration_sec, 15, 'metadata.duration_sec')
assert(mockProjectData.semantic_anchors.length === 2, '应有 2 个 semantic_anchors')

const hook = mockProjectData.semantic_anchors[0]
const gap = mockProjectData.semantic_anchors[1]

assertEqual(hook.anchor_id, 'anchor_1', 'anchor_1.id')
assertEqual(hook.start_sec, 0, 'anchor_1.start')
assertEqual(hook.end_sec, 5, 'anchor_1.end')
assertEqual(hook.logic_intent.marketing_role, 'hook', 'anchor_1.marketing_role')
assertEqual(hook.match.status, 'matched', 'anchor_1 应为 matched')
assertEqual(hook.match.asset_name, '商品高管口播.mp4', 'anchor_1.asset_name')
assertEqual(
  hook.replication_instructions.overlay_rewrite_instruction,
  '限时秒杀，仅限今天',
  'anchor_1.overlay',
)

assertEqual(gap.anchor_id, 'anchor_2', 'anchor_2.id')
assertEqual(gap.start_sec, 5, 'anchor_2.start')
assertEqual(gap.match.status, 'gap', 'anchor_2 应为 gap')
assertEqual(gap.match.asset_name, null, 'anchor_2.asset_name 应为 null')
assert(
  gap.replication_instructions.visual_generation_prompt.includes('喝咖啡'),
  'anchor_2 应有 AIGC prompt',
)

section('Level 1 — 时间线 Truth Source 对齐')

const hookClip = mockTimelineProject.clips.find((c) => c.anchor_id === 'anchor_1')
const gapClip = mockTimelineProject.clips.find(
  (c) => c.anchor_id === 'anchor_2' && c.track_id === 'video',
)

assert(!!hookClip, '时间线应存在 anchor_1 视频片段')
assert(!!gapClip, '时间线应存在 anchor_2 缺口片段')
assertEqual(mockTimelineProject.duration_sec, 15, 'timeline duration')
assertEqual(
  hookClip!.content_rewrite_instruction,
  '限时秒杀，仅限今天',
  'timeline overlay 与 anchor 一致',
)

pass('Level 1 mock 数据源校验通过')
