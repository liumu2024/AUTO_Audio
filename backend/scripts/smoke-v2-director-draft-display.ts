import assert from 'node:assert/strict'

import {
  activateV2DraftWorkspace,
  buildV2PlanPresentation,
  buildV2PlanSceneCards,
  resolveV2PlanSceneIdFromClip,
  resolveV2CanvasSurface,
  startNewV2DraftWorkspace,
} from '../../fonted/src/services/director/v2DirectorDraftWorkspace.js'
import { useDirectorChatStore } from '../../fonted/src/stores/directorChatStore.js'
import { useDirectorContextStore } from '../../fonted/src/stores/directorContextStore.js'
import { useEditorStore } from '../../fonted/src/stores/editorStore.js'
import { usePlaybackStore } from '../../fonted/src/stores/playbackStore.js'
import { useTaskStore } from '../../fonted/src/stores/taskStore.js'
import { useV2TimelineStore } from '../../fonted/src/stores/v2TimelineStore.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import { useCreationStore } from '../../fonted/src/stores/creationStore.js'
import { v2TransitionDisplayText } from '../../fonted/src/lib/v2-timeline-ui.js'
import { buildV2TimelineProject } from '../../fonted/src/lib/v2-timeline-ui.js'

const spec: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1',
  task_id: 'draft_display_smoke',
  canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 6 },
  assets: [],
  scenes: [
    {
      id: 'scene_1',
      type: 'remotion_card',
      start_sec: 0,
      duration_sec: 3,
      title: '安全提醒',
      creative_intent: {
        title: '进入主题',
        description: '快速建立地铁安全提醒主题。',
      },
    },
    {
      id: 'scene_2',
      type: 'remotion_card',
      start_sec: 3,
      duration_sec: 3,
      title: '平安抵达',
    },
  ],
  transitions: [
    {
      id: 'transition_1',
      from_scene_id: 'scene_1',
      to_scene_id: 'scene_2',
      type: 'fade',
      duration_sec: 0.3,
    },
  ],
  caption_tracks: [
    {
      id: 'captions_main',
      x_pct: 50,
      y_pct: 82,
      max_lines: 2,
      enter_animation: 'fade',
      exit_animation: 'fade',
      overlap_policy: 'forbid',
    },
  ],
  overlays: [
    {
      id: 'caption_1',
      type: 'caption',
      scene_id: 'scene_1',
      track_id: 'captions_main',
      text: 'Wait behind the safety line',
      start_sec: 0.4,
      end_sec: 1.6,
      x_pct: 50,
      y_pct: 82,
    },
    {
      id: 'caption_2',
      type: 'caption',
      scene_id: 'scene_1',
      track_id: 'captions_main',
      text: 'Let passengers exit first',
      start_sec: 1.7,
      end_sec: 2.8,
      x_pct: 50,
      y_pct: 82,
      enter_animation: 'slide_up_fade',
    },
    {
      id: 'caption_3',
      type: 'caption',
      scene_id: 'scene_2',
      text: 'No implicit line limit',
      start_sec: 3.3,
      end_sec: 5.6,
      x_pct: 50,
      y_pct: 82,
    },
  ],
  audio: [],
  material_jobs: [],
  render_policy: {
    renderer: 'remotion_timeline',
  },
}

useV2TimelineStore.getState().clear()
useEditorStore.getState().setTimelineMode('sample')
useCreationStore.getState().setAspectRatio('16:9')
useCreationStore.getState().setDurationSec(30)

activateV2DraftWorkspace({
  draftId: 'v2_draft_display_smoke',
  revision: 1,
  spec,
  traceDir: 'trace/draft-display',
})

assert.equal(useV2TimelineStore.getState().spec?.task_id, 'draft_display_smoke')
assert.equal(useEditorStore.getState().timelineMode, 'generation')
assert.equal(useEditorStore.getState().generationEditEnabled, true)
assert.equal(usePlaybackStore.getState().duration, 6)
assert.equal(useTaskStore.getState().activeTaskId, 'v2_draft_display_smoke')
assert.equal(useCreationStore.getState().aspectRatio, '9:16')
assert.equal(useCreationStore.getState().durationSec, 6)

assert.equal(resolveV2CanvasSurface({
  timelineMode: useEditorStore.getState().timelineMode,
  hasSample: false,
  hasSpec: true,
  hasRenderedOutput: false,
}), 'timeline_plan')

const cards = buildV2PlanSceneCards(spec)
assert.equal(cards.length, 2)
assert.equal(cards[0]?.title, '进入主题')
assert.equal(cards[0]?.description, '快速建立地铁安全提醒主题。')
assert.equal(cards[1]?.title, '平安抵达')

const presentation = buildV2PlanPresentation(spec)
assert.equal(presentation.scenes[0]?.visibleTexts.length, 2)
assert.equal(presentation.scenes[0]?.visibleTexts[0]?.text, 'Wait behind the safety line')
assert.equal(presentation.scenes[0]?.visibleTexts[0]?.maxLines, 2)
assert.equal(presentation.scenes[0]?.visibleTexts[0]?.maxLinesSource, 'track_default')
assert.equal(presentation.scenes[0]?.visibleTexts[0]?.enterAnimation, 'fade')
assert.equal(presentation.scenes[0]?.visibleTexts[1]?.enterAnimation, 'slide_up_fade')
assert.equal(presentation.scenes[0]?.transitionAfter?.type, 'fade')
assert.equal(presentation.scenes[0]?.deliveryState, 'programmatic')
assert.equal(presentation.scenes[0]?.sourceLabel, '程序化画面')
const timelineProject = buildV2TimelineProject(spec)
assert.doesNotMatch(
  timelineProject.clips.map((clip) => clip.label).join('；'),
  /scene_\d+|caption_\d+|remotion_card|caption:/i,
  'timeline labels must use user-facing names instead of IDs and enum values',
)
const pendingGenerationPresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'generated_scene_1', type: 'video', source: 'generated_asset', src: 'generated://pending' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'ai_video' as const, asset_id: 'generated_scene_1' }
    : scene),
  material_jobs: [{
    id: 'generate_scene_1',
    scene_id: 'scene_1',
    type: 'generate_video',
    status: 'planned',
    prompt: '生成真实动态镜头',
    output_asset_id: 'generated_scene_1',
  }],
})
assert.equal(pendingGenerationPresentation.scenes[0]?.deliveryState, 'pending_generation')
const missingGeneratedOutputPresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'fallback_scene_1', type: 'image', source: 'fallback_asset', src: '/fallback/scene-1.png' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'image_motion' as const, asset_id: 'fallback_scene_1' }
    : scene),
  material_jobs: [{
    id: 'generate_scene_1',
    scene_id: 'scene_1',
    type: 'generate_video',
    status: 'fulfilled',
    prompt: '生成真实动态镜头',
    output_asset_id: 'missing_generated_scene_1',
  }],
})
assert.equal(missingGeneratedOutputPresentation.scenes[0]?.deliveryState, 'blocked')
assert.equal(missingGeneratedOutputPresentation.scenes[0]?.sourceLabel, '交付失败（缺少产物）')
const fulfilledGeneratedReusePresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'generated_scene_1', type: 'video', source: 'generated_asset', src: '/generated/scene-1.mp4' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'ai_video' as const, asset_id: 'generated_scene_1' }
    : scene),
  material_jobs: [{
    id: 'reuse_generated_scene_1', scene_id: 'scene_1', type: 'reuse_asset', status: 'fulfilled',
    output_asset_id: 'generated_scene_1',
  }],
})
assert.equal(
  fulfilledGeneratedReusePresentation.scenes[0]?.deliveryState,
  'generated',
  'fulfilled reuse must reflect the output asset provenance',
)
assert.equal(
  fulfilledGeneratedReusePresentation.scenes[0]?.sourceLabel,
  'AI 生成素材 · 未命名素材',
)
const fulfilledFallbackGenerationPresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'fallback_scene_1', type: 'image', source: 'fallback_asset', src: '/fallback/scene-1.png' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'image_motion' as const, asset_id: 'fallback_scene_1' }
    : scene),
  material_jobs: [{
    id: 'generate_scene_1', scene_id: 'scene_1', type: 'generate_video', status: 'fulfilled',
    output_asset_id: 'fallback_scene_1',
  }],
})
assert.equal(
  fulfilledFallbackGenerationPresentation.scenes[0]?.deliveryState,
  'ready_asset',
  'a fulfilled generation job using a fallback asset must not claim AI generation success',
)
assert.equal(
  fulfilledFallbackGenerationPresentation.scenes[0]?.sourceLabel,
  '兜底素材 · 未命名素材',
)
const stockPresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'stock_scene_1', type: 'video', source: 'stock_asset', src: '/stock/scene-1.mp4', label: 'Stock clip' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? {
        ...scene, type: 'user_video' as const, asset_id: 'stock_scene_1',
        creative_intent: { ...scene.creative_intent!, material_label: 'AI masterpiece' },
      }
    : scene),
})
assert.equal(stockPresentation.scenes[0]?.deliveryState, 'ready_asset')
assert.equal(stockPresentation.scenes[0]?.assetLabel, 'Stock clip')
assert.equal(stockPresentation.scenes[0]?.sourceLabel, '库存素材 · Stock clip')
const plannedReusePresentation = buildV2PlanPresentation({
  ...spec,
  assets: [{ id: 'stock_scene_1', type: 'video', source: 'stock_asset', src: '/stock/scene-1.mp4', label: 'Stock clip' }],
  scenes: spec.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'user_video' as const, asset_id: 'stock_scene_1' }
    : scene),
  material_jobs: [{
    id: 'reuse_stock_scene_1', scene_id: 'scene_1', type: 'reuse_asset', status: 'planned',
    input_asset_id: 'stock_scene_1', output_asset_id: 'stock_scene_1',
  }],
})
assert.equal(plannedReusePresentation.scenes[0]?.deliveryState, 'pending_reuse')
assert.equal(plannedReusePresentation.scenes[0]?.sourceLabel, '素材复用（待完成）')
assert.equal(v2TransitionDisplayText({
  id: 'transition_slide',
  from_scene_id: 'scene_1',
  to_scene_id: 'scene_2',
  type: 'slide',
  duration_sec: 0.3,
  direction: 'from-left',
}), '滑动 · 0.3秒 · 从左侧')
const customPresentation = buildV2PlanPresentation({
  ...spec,
  transitions: spec.transitions.map((transition) => ({
    ...transition,
    direction: 'from-left',
    custom_render: { component_id: 'cmp_custom_transition', display_name: '圆形渐变' },
  })),
})
assert.equal(
  customPresentation.scenes[0]?.transitionAfter?.custom_render?.component_id,
  'cmp_custom_transition',
)
assert.equal(
  v2TransitionDisplayText(customPresentation.scenes[0]!.transitionAfter!),
  '圆形渐变 · 0.3秒',
)
assert.equal(presentation.scenes[1]?.visibleTexts.length, 1)
assert.equal(presentation.scenes[1]?.visibleTexts[0]?.maxLines, undefined)
assert.equal(presentation.scenes[1]?.visibleTexts[0]?.maxLinesSource, undefined)
assert.equal(resolveV2PlanSceneIdFromClip(spec, 'v2-overlay-caption_1'), 'scene_1')
assert.equal(resolveV2PlanSceneIdFromClip(spec, 'v2-transition-transition_1'), 'scene_1')

useCreationStore.setState({
  sampleUrl: 'http://localhost:3001/uploads/sample.mp4',
  sampleName: 'sample.mp4',
  inputText: 'continue the old draft',
  attachments: [{
    id: 'att_old', name: 'old.png', type: 'image',
    url: 'http://localhost:3001/uploads/old.png', source: 'upload',
  }],
  pendingAttachmentIds: ['att_old'],
  showSampleInInputTray: true,
  isSampleParsed: true,
})
useDirectorContextStore.getState().setMaterials([{
  id: 'old', name: 'old.png', type: 'image', url: 'http://localhost:3001/uploads/old.png',
}])
useDirectorChatStore.getState().addUserMessage({ content: 'old conversation' })
useTaskStore.getState().startTask('old task', 'old_task')
usePlaybackStore.getState().setPlaying(true)
usePlaybackStore.getState().seek(4)

startNewV2DraftWorkspace()

assert.equal(useV2TimelineStore.getState().draftId, null)
assert.equal(useV2TimelineStore.getState().spec, null)
assert.equal(useCreationStore.getState().sampleUrl, '')
assert.equal(useCreationStore.getState().attachments.length, 0)
assert.equal(useCreationStore.getState().inputText, '')
assert.equal(useDirectorContextStore.getState().context.materials.length, 0)
assert.equal(useDirectorChatStore.getState().messages.length, 1)
assert.equal(useTaskStore.getState().activeTaskId, null)
assert.equal(useTaskStore.getState().isTaskRunning, false)
assert.equal(useTaskStore.getState().lastPrompt, null)
assert.equal(useEditorStore.getState().timelineMode, 'sample')
assert.equal(useEditorStore.getState().generationEditEnabled, false)
assert.equal(useEditorStore.getState().sidebarTab, 'config')
assert.equal(useEditorStore.getState().sidebarSubView, 'main')
assert.equal(usePlaybackStore.getState().isPlaying, false)
assert.equal(usePlaybackStore.getState().currentTime, 0)

console.log('V2 Director draft display smoke passed.')
