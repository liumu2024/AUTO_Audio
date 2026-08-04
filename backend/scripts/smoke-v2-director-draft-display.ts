import assert from 'node:assert/strict'

import {
  activateV2DraftWorkspace,
  buildV2PlanPresentation,
  buildV2PlanSceneCards,
  resolveV2PlanSceneIdFromClip,
  resolveV2CanvasSurface,
} from '../../fonted/src/services/director/v2DirectorDraftWorkspace.js'
import { useEditorStore } from '../../fonted/src/stores/editorStore.js'
import { usePlaybackStore } from '../../fonted/src/stores/playbackStore.js'
import { useTaskStore } from '../../fonted/src/stores/taskStore.js'
import { useV2TimelineStore } from '../../fonted/src/stores/v2TimelineStore.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import { useCreationStore } from '../../fonted/src/stores/creationStore.js'

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
    allow_custom_component: false,
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
assert.equal(presentation.scenes[1]?.visibleTexts.length, 1)
assert.equal(presentation.scenes[1]?.visibleTexts[0]?.maxLines, undefined)
assert.equal(presentation.scenes[1]?.visibleTexts[0]?.maxLinesSource, undefined)
assert.equal(resolveV2PlanSceneIdFromClip(spec, 'v2-overlay-caption_1'), 'scene_1')
assert.equal(resolveV2PlanSceneIdFromClip(spec, 'v2-transition-transition_1'), 'scene_1')

console.log('V2 Director draft display smoke passed.')
