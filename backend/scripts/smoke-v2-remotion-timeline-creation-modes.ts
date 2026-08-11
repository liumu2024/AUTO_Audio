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

const shotAwareSample = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_sample_shots_${Date.now()}`,
  creationMode: 'sample_replicate',
  prompt: '沿用样例的剪辑密度。',
  referenceVideoPath: sampleVideo,
  mainVideoPath: sampleVideo,
  sampleUnderstanding: {
    schema_version: 'v2_sample_understanding.v2',
    task_id: 'sample_shots',
    source: 'llm',
    sample: { duration_sec: 12 },
    summary: '六个可观察镜头呈现逐步加速的追逐',
    content_observations: [{ statement: '主体持续追逐', evidence_ranges: [{ start_sec: 0, end_sec: 12 }] }],
    method_observations: [{ id: 'method_pacing', expression: '逐步缩短镜头', purpose: '增强紧张感', timing_rationale: '冲突升级时加速', evidence_ranges: [{ start_sec: 0, end_sec: 12 }] }],
    transferable_knowledge: [{ statement: '冲突升级时逐步缩短镜头', applicability: '追逐或紧张叙事', evidence_method_ids: ['method_pacing'] }],
    shot_evidence: Array.from({ length: 6 }, (_, index) => ({
      id: `shot_${index + 1}`, start_sec: index * 2, end_sec: (index + 1) * 2,
      boundary: index === 5 ? 'end' as const : 'hard_cut' as const, confidence: 0.9,
    })),
    questions: [], warnings: [],
  },
})
assert.equal(shotAwareSample.scenes.length, 5, 'observed sample cuts must not mechanically determine the new plan shot count')
assert.deepEqual(shotAwareSample.creative_brief?.sample_methods, ['冲突升级时逐步缩短镜头'])

const uncertainSample = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_sample_uncertain_${Date.now()}`,
  creationMode: 'sample_replicate',
  prompt: 'reuse the reference pacing without inventing observed cut points',
  durationSec: 15,
  referenceVideoPath: sampleVideo,
  mainVideoPath: sampleVideo,
  sampleUnderstanding: {
    schema_version: 'v2_sample_understanding.v2', task_id: 'sample_uncertain', source: 'llm_fallback',
    sample: { duration_sec: 15 }, summary: 'fallback summary', content_observations: [],
    method_observations: [], transferable_knowledge: [], shot_evidence: [],
    questions: [], warnings: ['shot boundaries unavailable'],
  },
})
assert.equal(uncertainSample.scenes.length, 6, 'uncertain sample analysis must use neutral output pacing, not a fixed three-shot claim')

const sampleWithoutFinalMaterials = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_sample_missing_materials_${Date.now()}`,
  creationMode: 'sample_replicate',
  prompt: '参考样例节奏规划 5 个镜头；样例只作为结构参考，不作为成片素材。',
  durationSec: 15,
  referenceVideoPath: sampleVideo,
})
assert.equal(sampleWithoutFinalMaterials.scenes.length, 5)
assert.equal(
  sampleWithoutFinalMaterials.scenes.every((scene) => scene.type === 'remotion_card'),
  true,
  'planned generation remains an editable preview card until a real output asset is resolved',
)
assert.equal(sampleWithoutFinalMaterials.material_jobs.length, 5)
assert.equal(sampleWithoutFinalMaterials.material_jobs.every((job) => job.type === 'generate_video'), true)
assert.equal(sampleWithoutFinalMaterials.material_jobs.every((job) => job.fallback_kind === 'none'), true)

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
assert.equal(textToVideo.material_jobs.every((job) => job.fallback_kind === 'none'), true)
assert.equal(textToVideo.scenes.every((scene) => scene.type === 'remotion_card'), true)

console.info('[smoke-v2-remotion-timeline-creation-modes] OK')
