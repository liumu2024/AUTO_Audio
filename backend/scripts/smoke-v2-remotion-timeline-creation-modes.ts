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
    schema_version: 'v2_sample_understanding.v1',
    task_id: 'sample_shots',
    source: 'llm',
    sample: { duration_sec: 12 },
    summary_zh: '六个短镜头组成两个内容章节',
    story_zh: '测试', atmosphere_zh: '测试', editing_zh: '快速硬切', rhythm_zh: '快节奏',
    reusable_style_zh: '复用节奏', not_reusable_zh: '不复用画面',
    segments: [{
      id: 'chapter_1', title_zh: '完整章节', start_sec: 0, end_sec: 12,
      visual_content_zh: '完整内容章节', characters_objects_zh: '主体', atmosphere_zh: '统一',
      camera_zh: '多景别', motion_zh: '连续动作', editing_zh: '六个镜头', rhythm_zh: '快速',
      reusable_style_zh: '复用节奏', material_hint_zh: '替换素材',
    }],
    shot_evidence: Array.from({ length: 6 }, (_, index) => ({
      id: `shot_${index + 1}`, start_sec: index * 2, end_sec: (index + 1) * 2,
      boundary: index === 5 ? 'end' as const : 'hard_cut' as const, confidence: 0.9,
    })),
    questions_for_user_zh: [], warnings_zh: [],
  },
})
assert.equal(shotAwareSample.scenes.length, 6, 'semantic chapters must not cap the sample shot count')

const uncertainSample = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_sample_uncertain_${Date.now()}`,
  creationMode: 'sample_replicate',
  prompt: 'reuse the reference pacing without inventing observed cut points',
  durationSec: 15,
  referenceVideoPath: sampleVideo,
  mainVideoPath: sampleVideo,
  sampleUnderstanding: {
    schema_version: 'v2_sample_understanding.v1', task_id: 'sample_uncertain', source: 'llm_fallback',
    sample: { duration_sec: 15 }, summary_zh: 'fallback summary', story_zh: '', atmosphere_zh: '',
    editing_zh: '', rhythm_zh: '', reusable_style_zh: '', not_reusable_zh: '', segments: [], shot_evidence: [],
    questions_for_user_zh: [], warnings_zh: ['shot boundaries unavailable'],
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
assert.equal(sampleWithoutFinalMaterials.scenes.every((scene) => scene.type === 'ai_video'), true)
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
assert.equal(textToVideo.scenes.every((scene) => scene.type === 'ai_video'), true)

console.info('[smoke-v2-remotion-timeline-creation-modes] OK')
