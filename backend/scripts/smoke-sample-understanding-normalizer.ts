import assert from 'node:assert/strict'

import { parseSampleUnderstandingResult } from '../src/modules/sample-understanding/parse-sample-understanding.js'

const candidate = {
  schema_version: 'sample_understanding.v1',
  task_id: 'wrong_task_id',
  source: {
    sample_video: {
      id: 'sample_video',
      name: 'sample.mp4',
    },
    reference_materials: [],
  },
  intent: {
    raw_text: '做一个风景混剪',
    goal: 'landscape_montage',
    style_keywords: ['cinematic', 'beat_sync'],
    must_keep: [],
    must_change: [],
    generation_directive: '跟随样例节奏生成风景混剪',
  },
  sample_analysis: {
    hook_formula: '节奏开场',
    narrative_arc: '开场-铺陈-高潮-收尾',
    conversion_logic: '沉浸式风景展示',
    audience_trigger: '音乐卡点和风景美感',
    reusable_pattern: '节奏驱动画面切换',
  },
  template: {
    schema_version: '1.0',
    id: 'tpl_001',
    title: '风景混剪模板',
    duration: 4,
    style_features: {
      visual_style: '电影感风景',
      pace: '跟随音乐强拍切换',
      transition: '硬切和柔和溶转',
      bgm: '氛围音乐',
      subtitle_style: '弱字幕',
    },
    structure: [
      {
        id: 1,
        name: 'opening',
        start: 0,
        end: 2,
        purpose: '开场建立风景氛围',
        intent_summary: '宽景引入',
        emotion: 'calm',
        camera: 'wide',
        motion: 'slow push in',
        slot: '主画面',
      },
      {
        id: 2,
        name: 'accent',
        start: 2,
        end: 4,
        purpose: '强拍切换到色彩高潮',
        intent_summary: '色彩强化',
        emotion: 'surging',
        camera: 'detail',
        motion: 'zoom in',
        slot: '高潮画面',
      },
    ],
    slots: [
      {
        id: 'slot_001',
        name: '主画面',
        type: 'visual',
        tags: ['landscape'],
      },
      {
        id: 'slot_002',
        name: '高潮画面',
        type: 'image',
        required: true,
        tags: ['color_peak'],
      },
    ],
    transitions: [],
    viral_points: ['强拍切换'],
  },
}

const parsed = parseSampleUnderstandingResult(candidate, {
  taskId: 'normalizer_smoke',
})

assert.equal(parsed.task_id, 'normalizer_smoke')
assert.equal(typeof parsed.template.style, 'string')
assert.ok(parsed.template.style.length > 0)
assert.equal(parsed.template.structure[0]?.id, '1')
assert.equal(parsed.template.structure[0]?.slot, 'slot_001')
assert.equal(parsed.template.slots[0]?.type, 'video')
assert.equal(parsed.template.viral_points[0]?.reason, '强拍切换')

console.info('[smoke-sample-understanding-normalizer] OK')
console.info(
  JSON.stringify(
    {
      style: parsed.template.style,
      firstSegment: parsed.template.structure[0],
      firstSlot: parsed.template.slots[0],
      viralPoint: parsed.template.viral_points[0],
    },
    null,
    2,
  ),
)
