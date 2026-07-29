import assert from 'node:assert/strict'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import { listV2AgentSkillCards } from '../src/pipeline-v2/agent-skills/registry.js'
import { listV2AgentToolCards, validateV2AgentToolRequest } from '../src/pipeline-v2/agent-tools/registry.js'

assert.deepEqual(listV2AgentToolCards().map((tool) => tool.id), [
  'sample.analyze', 'material.inspect', 'timeline.plan', 'timeline.patch', 'timeline.render',
])
assert.ok(listV2AgentSkillCards().some((skill) => skill.id === 'subtitle-track-authoring'))
assert.equal(validateV2AgentToolRequest({ callId: 'subtitle_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'subtitle' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'subtitle_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'audio' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'unknown_001', toolId: 'audio.mix', skillId: 'subtitle-track-authoring', arguments: {}, requestedMode: 'execute' }).ok, false)

const base: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1', task_id: 'subtitle_track_smoke',
  canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 4 }, assets: [],
  scenes: [{ id: 'scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 4, title: 'test' }],
  transitions: [],
  caption_tracks: [{ id: 'caption_main', x_pct: 50, y_pct: 82, max_lines: 2, overlap_policy: 'allow_crossfade', enter_animation: 'fade', exit_animation: 'fade' }],
  overlays: [
    { id: 'caption_1', type: 'caption', scene_id: 'scene_1', track_id: 'caption_main', text: '第一句', start_sec: 0.5, end_sec: 1.8, x_pct: 50, y_pct: 82, max_lines: 2 },
    { id: 'caption_2', type: 'caption', scene_id: 'scene_1', track_id: 'caption_main', text: '第二句', start_sec: 1.65, end_sec: 3, x_pct: 50, y_pct: 82, max_lines: 2 },
  ],
  audio: [], material_jobs: [], render_policy: { renderer: 'remotion_timeline', allow_custom_component: false },
}
assert.equal(validateRemotionTimelineSpec(base).ok, true)
const invalid = structuredClone(base)
invalid.overlays[1].start_sec = 1
assert.equal(validateRemotionTimelineSpec(invalid).ok, false)

console.log('V2 agent tool/skill registry smoke passed.')
