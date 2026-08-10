import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { generateEvaluationMediaFixtures } from '../src/evaluation-v2/evaluation-media-fixtures.js'
import { createStaticMaterialGenerationAdapter } from '../src/pipeline-v2/material-generation-adapter.js'
import { runV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-service.js'

const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'v2-agent-evaluation-media-'))
const renderDirs: string[] = []
const taskIds: string[] = []
const cleanup = () => {
  rmSync(fixtureDir, { recursive: true, force: true })
  for (const dir of renderDirs) rmSync(dir, { recursive: true, force: true })
  const traceRoot = path.resolve('tmp', 'v2-traces', 'tasks')
  if (existsSync(traceRoot)) {
    for (const entry of readdirSync(traceRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && taskIds.some((taskId) => entry.name.startsWith(`${taskId}__run_`))) {
        rmSync(path.join(traceRoot, entry.name), { recursive: true, force: true })
      }
    }
  }
}
process.once('exit', cleanup)
const media = await generateEvaluationMediaFixtures(fixtureDir)
const stamp = Date.now()

function metadata(file: string) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type,width,height,r_frame_rate', '-of', 'json', file,
  ], { encoding: 'utf8' })) as {
    streams: Array<{ codec_type: string; width?: number; height?: number; r_frame_rate?: string }>
    format: { duration: string }
  }
}

const scenarios = [
  { id: 'landscape_audio', video: media.landscape, width: 320, height: 180, fps: 12, expectAudio: true },
  { id: 'vertical_silent', video: media.vertical, width: 180, height: 320, fps: 15, expectAudio: false },
  { id: 'square_24fps', video: media.square, width: 240, height: 240, fps: 24, expectAudio: false },
  { id: 'caption_overlay', video: media.landscape, audio: media.tone, width: 320, height: 180, fps: 12, expectAudio: true },
  { id: 'material_switch', video: media.vertical, audio: media.silence, width: 180, height: 320, fps: 15, expectAudio: true },
] as const

const results = []
for (const scenario of scenarios) {
  const taskId = `v2_eval_render_${scenario.id}_${stamp}`
  taskIds.push(taskId)
  renderDirs.push(path.resolve('v2-renders', taskId))
  const spec = createRemotionTimelineFixture({
    taskId,
    mainVideoSrc: scenario.video,
    imageSrc: media.image,
    durationSec: 1.5,
    width: scenario.width,
    height: scenario.height,
    fps: scenario.fps,
  })
  spec.scenes[0] = { ...spec.scenes[0]!, type: 'ai_video', asset_id: `generated_${scenario.id}` }
  spec.material_jobs = [{
    id: `job_${scenario.id}`,
    scene_id: spec.scenes[0]!.id,
    type: 'generate_video',
    status: 'planned',
    prompt: '评测专用测试卡素材',
    output_asset_id: `generated_${scenario.id}`,
    provider: 'none',
    fallback_kind: 'none',
  }]
  spec.overlays = [{
    id: `caption_${scenario.id}`,
    type: 'caption',
    scene_id: spec.scenes[0]!.id,
    start_sec: spec.scenes[0]!.start_sec + 0.02,
    end_sec: spec.scenes[0]!.start_sec + spec.scenes[0]!.duration_sec - 0.02,
    x_pct: 50,
    y_pct: 82,
    width_pct: 80,
    text: `评测-${scenario.id}`,
  }]
  if ('audio' in scenario) {
    const audioId = `audio_${scenario.id}`
    spec.assets.push({ id: audioId, type: 'audio', src: scenario.audio, source: 'local_fixture' })
    spec.audio = [{ id: `clip_${scenario.id}`, asset_id: audioId, start_sec: 0, end_sec: 1.5 }]
  }
  const result = await runV2RemotionTimeline({
    taskId,
    prompt: `生成评测草稿，字幕包含“评测-${scenario.id}”。`,
    creationMode: 'text_to_video',
    plannerMode: 'deterministic',
    allowPlannerFallback: true,
    durationSec: 1.5,
    canvas: { width: scenario.width, height: scenario.height, fps: scenario.fps },
    timelineSpecOverride: spec,
  }, {
    materialAdapter: createStaticMaterialGenerationAdapter({
      videoAssetPath: scenario.video,
      imageAssetPath: media.image,
    }),
  })
  assert.equal(result.ok, true, JSON.stringify(result.evaluation, null, 2))
  assert.equal(existsSync(result.outputPath), true)
  assert.equal(result.materialResolution.fulfilled_jobs.length, 1)
  assert.equal(result.spec.overlays.some((overlay) => overlay.text === `评测-${scenario.id}`), true)
  const probe = metadata(result.outputPath)
  const videoStream = probe.streams.find((stream) => stream.codec_type === 'video')
  assert.equal(videoStream?.width, scenario.width)
  assert.equal(videoStream?.height, scenario.height)
  assert.equal(Number(probe.format.duration) >= 1.4, true)
  if (scenario.expectAudio) assert.equal(probe.streams.some((stream) => stream.codec_type === 'audio'), true)
  results.push({ id: scenario.id, ok: true, outputPath: result.outputPath, traceDir: result.traceDir })
}

let corruptFailure = ''
try {
  const taskId = `v2_eval_render_corrupt_${stamp}`
  taskIds.push(taskId)
  renderDirs.push(path.resolve('v2-renders', taskId))
  const spec = createRemotionTimelineFixture({
    taskId,
    mainVideoSrc: media.corrupt,
    imageSrc: media.image,
    durationSec: 1.5,
    width: 320,
    height: 180,
    fps: 12,
  })
  spec.overlays = []
  await runV2RemotionTimeline({
    taskId,
    prompt: '损坏素材失败路径评测。',
    creationMode: 'material_brief',
    plannerMode: 'deterministic',
    allowPlannerFallback: true,
    durationSec: 1.5,
    canvas: { width: 320, height: 180, fps: 12 },
    timelineSpecOverride: spec,
  })
} catch (error) {
  corruptFailure = error instanceof Error ? error.message : String(error)
}
assert.equal(Boolean(corruptFailure), true)
results.push({ id: 'corrupt_asset_failure', ok: true, expectedFailure: corruptFailure })

const deliveryResults = results.filter((item) => !('expectedFailure' in item))

console.log(JSON.stringify({
  scenarios: results,
  renderDeliverySuccessRate: deliveryResults.filter(
    (item) => item.ok && 'outputPath' in item && Boolean(item.outputPath),
  ).length / deliveryResults.length,
  mediaGenerationCalled: false,
  remotionRenderCalled: true,
}, null, 2))
cleanup()
