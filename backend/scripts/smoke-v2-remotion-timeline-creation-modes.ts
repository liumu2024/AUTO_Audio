import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { buildDeterministicRemotionTimelineSpec } from '../src/pipeline-v2/remotion-timeline-planner.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

const sampleReplicate = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_sample_replicate_${Date.now()}`,
  creationMode: 'sample_replicate',
  prompt: '复用参考视频的节奏，但使用用户主素材。',
  referenceVideoPath: sampleVideo,
  mainVideoPath: sampleVideo,
})
assert.equal(validateRemotionTimelineSpec(sampleReplicate).ok, true)
assert.ok(sampleReplicate.notes.includes('Creation mode: sample_replicate.'))
assert.ok(sampleReplicate.scenes.some((scene) => scene.type === 'user_video'))

const materialBrief = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_material_brief_${Date.now()}`,
  creationMode: 'material_brief',
  prompt: '即使画面描述很丰富，也只编排已提供的全部素材制作产品介绍。',
  materials: [
    { id: 'video_1', type: 'video', src: sampleVideo },
    { id: 'image_1', type: 'image', src: sampleImage },
  ],
})
assert.equal(validateRemotionTimelineSpec(materialBrief).ok, true)
assert.ok(materialBrief.notes.includes('Creation mode: material_brief.'))
assert.ok(materialBrief.material_jobs.length > 0)
assert.equal(materialBrief.material_jobs.length, materialBrief.scenes.length)
assert.equal(materialBrief.material_jobs.every((job) => job.type === 'reuse_asset'), true)
assert.equal(materialBrief.material_jobs.some((job) => job.type === 'generate_video'), false)
assert.equal(
  materialBrief.scenes.every((scene) => scene.type === 'user_video' || scene.type === 'image_motion'),
  true,
)
assert.equal(materialBrief.assets.every((asset) => asset.source === 'user_asset'), true)
assert.equal(
  materialBrief.scenes.every((scene) =>
    scene.asset_id ? materialBrief.assets.some((asset) => asset.id === scene.asset_id) : false,
  ),
  true,
)

const textToVideo = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_text_to_video_${Date.now()}`,
  creationMode: 'text_to_video',
  prompt: [
    '片段 1: "清晨薄雾中的山谷。" (第 0 - 60 帧)',
    '片段 2: "金色阳光照亮树林。" (第 61 - 120 帧)',
  ].join('\n'),
  canvas: { fps: 30 },
})
assert.equal(validateRemotionTimelineSpec(textToVideo).ok, true)
assert.ok(textToVideo.notes.includes('Creation mode: text_to_video.'))
assert.equal(textToVideo.assets.length, 0)
assert.equal(textToVideo.scenes.length, 2)
assert.equal(textToVideo.material_jobs.length, 2)
assert.equal(textToVideo.material_jobs.length, textToVideo.scenes.length)
assert.equal(textToVideo.material_jobs.every((job) => job.type === 'generate_video'), true)
assert.equal(textToVideo.material_jobs.every((job) => job.status === 'planned'), true)
assert.equal(textToVideo.material_jobs.every((job) => job.fallback_kind === 'blank_card'), true)
assert.equal(textToVideo.scenes.every((scene) => scene.type === 'remotion_card'), true)

console.info('[smoke-v2-remotion-timeline-creation-modes] OK')
