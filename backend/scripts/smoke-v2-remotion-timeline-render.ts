import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineSpecV1,
} from '../../shared/types/remotion-timeline-spec.v1.js'
import { renderV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-renderer.js'

const taskId = `v2_timeline_render_${Date.now()}`
const outputDir = mkdtempSync(path.join(os.tmpdir(), 'v2-remotion-presets-'))
const cleanup = () => rmSync(outputDir, { recursive: true, force: true })
process.once('exit', cleanup)

const sceneDurationSec = 0.5
const spec: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1',
  task_id: taskId,
  canvas: {
    width: 360,
    height: 640,
    fps: 12,
    duration_sec: sceneDurationSec * (REMOTION_TIMELINE_TRANSITION_TYPES.length + 1),
  },
  assets: [],
  scenes: Array.from({ length: REMOTION_TIMELINE_TRANSITION_TYPES.length + 1 }, (_, index) => ({
    id: `scene_${index + 1}`,
    type: 'remotion_card',
    start_sec: index * sceneDurationSec,
    duration_sec: sceneDurationSec,
    title: `Preset ${index + 1}`,
    background: index % 2 === 0 ? '#172554' : '#7f1d1d',
  })),
  transitions: REMOTION_TIMELINE_TRANSITION_TYPES.map((type, index) => ({
    id: `transition_${index + 1}`,
    from_scene_id: `scene_${index + 1}`,
    to_scene_id: `scene_${index + 2}`,
    type,
    duration_sec: type === 'cut' ? 0 : 0.2,
  })),
  overlays: [],
  material_jobs: [],
  audio: [],
  render_policy: { renderer: 'remotion_timeline' },
}

const validation = validateRemotionTimelineSpec(spec)
assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2))

const result = await renderV2RemotionTimeline({
  spec,
  outputDir,
  outputName: `${taskId}.mp4`,
})

assert.equal(existsSync(result.outputPath), true)
assert.ok(result.fileSizeBytes > 10_000, `Unexpectedly small render: ${result.fileSizeBytes}`)
if (!process.env.REMOTION_BROWSER_EXECUTABLE) {
  assert.equal(
    result.command.includes('--browser-executable'),
    false,
    'the default render path must let Remotion choose its compatible browser',
  )
} else {
  const browserFlag = result.command.indexOf('--browser-executable')
  assert.equal(result.command[browserFlag + 1], process.env.REMOTION_BROWSER_EXECUTABLE)
}

console.info('[smoke-v2-remotion-timeline-render] OK')
console.info(JSON.stringify({
  taskId,
  outputPath: result.outputPath,
  propsPath: result.propsPath,
  fileSizeBytes: result.fileSizeBytes,
}, null, 2))
cleanup()
