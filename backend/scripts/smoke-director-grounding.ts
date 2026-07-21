import assert from 'node:assert/strict'

import { buildOutlineFromStructure, buildTimelineFromStructure } from '../../shared/lib/pipeline-builder.js'
import { creativeRoleLabel } from '../../shared/lib/director-labels.js'
import { templateToMigrationProtocolV12 } from '../../shared/lib/template-to-migration.adapter.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import type { UserMaterialDto } from '../../shared/types/pipeline.js'
import { directorGroundingToSampleUnderstanding } from '../src/modules/sample-understanding/director-grounding/director-grounding-to-template.js'
import { parseDirectorGroundingResult } from '../src/modules/sample-understanding/director-grounding/parse-director-grounding.js'
import { parseSampleUnderstandingResult } from '../src/modules/sample-understanding/parse-sample-understanding.js'

const taskId = 'smoke_director_grounding'
const materials: UserMaterialDto[] = [
  {
    id: 'mat_video_001',
    material_type: 'VIDEO',
    oss_url: 'http://localhost:3001/uploads/lake.mp4',
    label: 'lake material',
    ai_tags: ['landscape', 'lake'],
    status: 'READY',
  },
  {
    id: 'mat_image_001',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/mountain.jpg',
    label: 'mountain material',
    ai_tags: ['landscape', 'mountain'],
    status: 'READY',
  },
]

const coverageMaterials: UserMaterialDto[] = [
  ...materials,
  {
    id: 'mat_image_002',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/forest.jpg',
    label: 'forest material',
    ai_tags: ['landscape', 'forest'],
    status: 'READY',
  },
  {
    id: 'mat_image_003',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/river.jpg',
    label: 'river material',
    ai_tags: ['landscape', 'river'],
    status: 'READY',
  },
  {
    id: 'mat_image_004',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/cloud.jpg',
    label: 'cloud material',
    ai_tags: ['landscape', 'cloud'],
    status: 'READY',
  },
]

const grounding = parseDirectorGroundingResult(
  {
    schema_version: 'director_grounding.v1',
    task_id: taskId,
    content_domain: 'landscape_montage',
    source: {
      sample_video: {
        id: 'sample_001',
        name: 'sample.mp4',
        role: 'structure_source',
      },
      reference_materials: [],
    },
    intent: {
      raw_text: '做成风景混剪',
      goal: 'generate_variant',
      style_keywords: ['landscape', 'beat_cut'],
      must_keep: ['beat cut'],
      must_change: [],
      generation_directive: 'Use user materials to replicate the sample rhythm.',
    },
    audio_visual_evidence: {
      duration_sec: 8,
      fps: 30,
      key_observations: ['hard cuts on strong beats'],
      beat_summary: 'strong beat every second',
    },
    visual_phenomena: [
      {
        id: 'phen_001',
        start_sec: 0,
        end_sec: 8,
        type: 'beat_synced_landscape_cut',
        mechanism: 'audio_driver',
        description: 'Landscape clips change on strong beats.',
        evidence: 'Cuts occur at 1s intervals.',
        confidence: 0.9,
      },
    ],
    temporal_events: [
      {
        id: 'seg_001',
        start_sec: 0,
        end_sec: 2,
        creative_role: 'opening',
        description: 'Open with a wide landscape shot.',
        visual_prompt: 'Wide lake and mountain landscape, cinematic push-in.',
        overlay_text: '',
        emotion_vibe: 'fresh',
        camera: 'wide',
        motion: 'push in',
        evidence_refs: ['phen_001'],
        confidence: 0.88,
        visual_motion: {
          preset: 'push_in',
          intensity: 0.3,
          easing: 'ease-out',
          driver: 'useCurrentFrame',
        },
        slot_tags: ['landscape', 'lake'],
        accepted_material_types: ['video', 'image'],
      },
      {
        id: 'seg_002',
        start_sec: 2,
        end_sec: 4,
        creative_role: 'build',
        description: 'Build rhythm with alternating scenic shots.',
        visual_prompt: 'Alternating lake and forest views on beat cuts.',
        overlay_text: '',
        emotion_vibe: 'flowing',
        camera: 'medium wide',
        motion: 'pan',
        evidence_refs: ['phen_001'],
        confidence: 0.86,
        visual_motion: {
          preset: 'pan',
          intensity: 0.28,
          easing: 'ease-out',
          driver: 'useCurrentFrame',
        },
        slot_tags: ['landscape'],
        accepted_material_types: ['video', 'image'],
      },
      {
        id: 'seg_003',
        start_sec: 4,
        end_sec: 6,
        creative_role: 'climax',
        description: 'Peak with stronger mountain view and flash pulse.',
        visual_prompt: 'Snow mountain or highland view with brief flash pulse.',
        overlay_text: '',
        emotion_vibe: 'uplifting',
        camera: 'wide aerial',
        motion: 'zoom pulse',
        evidence_refs: ['phen_001'],
        confidence: 0.9,
        visual_motion: {
          preset: 'zoom_in',
          intensity: 0.35,
          easing: 'ease-out',
          driver: 'useCurrentFrame',
        },
        slot_tags: ['landscape', 'mountain'],
        accepted_material_types: ['video', 'image'],
      },
      {
        id: 'seg_004',
        start_sec: 6,
        end_sec: 8,
        creative_role: 'afterglow',
        description: 'Soft closing frame with lingering landscape.',
        visual_prompt: 'Calm lake reflection, slow fade feeling.',
        overlay_text: '',
        emotion_vibe: 'calm',
        camera: 'wide static',
        motion: 'static',
        evidence_refs: ['phen_001'],
        confidence: 0.84,
        visual_motion: {
          preset: 'static',
          intensity: 0.2,
          driver: 'useCurrentFrame',
        },
        slot_tags: ['closing', 'landscape'],
        accepted_material_types: ['video', 'image'],
      },
    ],
    style_summary: {
      style_family: 'landscape_beat_montage',
      editing_pattern: 'Hard cut between scenic materials on strong beats.',
      audio_sync_logic: 'Use strong beats for cuts and energy peaks for flash.',
      visual_style: 'clean cinematic travel footage',
      pace: 'fast',
    },
    remotion_capability_plan: {
      matched_plugins: [
        {
          preset: 'primitive_beat_pulse',
          plugin_id: 'beat_cut_driver',
          reason: 'Beat pulse and flash accents.',
          segment_ids: ['seg_001', 'seg_002', 'seg_003', 'seg_004'],
        },
        {
          preset: 'primitive_texture_grade',
          plugin_id: 'cinematic_texture_grade',
          reason: 'Global cinematic texture.',
          segment_ids: ['seg_001', 'seg_002', 'seg_003', 'seg_004'],
        },
      ],
      capability_layers: [
        {
          segment_id: 'seg_003',
          layers: [
            {
              plugin_id: 'beat_cut_driver',
              layer: 'audio_driver',
              preset: 'primitive_beat_pulse',
              reason: 'Energy peak pulse on climax.',
              confidence: 0.9,
            },
          ],
        },
      ],
      missing_capabilities: [
        {
          id: 'aerial_scene_flow_transition',
          description: 'Motion-direction matched aerial transition.',
          suggested_contract: {
            preset: 'aerial_scene_flow_transition',
          },
        },
      ],
      plugin_authoring_skill: {
        enabled: true,
        purpose: 'Generate missing Remotion plugin after approval.',
        candidate_plugin_ids: ['aerial_scene_flow_transition'],
      },
    },
    render_recipe: {
      style_family: 'landscape_beat_montage',
      global_effects: ['primitive_texture_grade'],
      scene_effects: [
        {
          segment_id: 'seg_003',
          plugin_id: 'beat_cut_driver',
          layer: 'audio_driver',
          preset: 'primitive_beat_pulse',
          phenomenon: 'flash pulse on energy peak',
          evidence_refs: ['phen_001'],
          confidence: 0.9,
          params: {
            beat_times: [0],
            strong_beats: [0],
          },
        },
      ],
      audio_driver: {
        beat_times: [1, 2, 3, 4, 5, 6, 7, 8],
        strong_beats: [1, 2, 3, 4, 5, 6, 7, 8],
        energy_peaks: [{ time: 4, intensity: 0.9, duration_sec: 0.18 }],
      },
    },
    critique: {
      likely_failure_points: ['over-strong flash'],
      repair_notes: ['keep pulse subtle'],
      final_decision: 'usable',
    },
  },
  taskId,
)

const legacyGrounding = parseDirectorGroundingResult(
  {
    schema_version: 'director_grounding.v1',
    task_id: 'legacy_task',
    source: {
      sample_video: { id: 'sample_legacy', role: 'structure_source' },
      reference_materials: [],
    },
    intent: {
      raw_text: 'legacy',
      goal: 'replicate_structure',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: 'legacy',
    },
    audio_visual_evidence: { duration_sec: 2 },
    visual_phenomena: [],
    temporal_events: [
      {
        id: 'seg_001',
        start_sec: 0,
        end_sec: 2,
        marketing_role: 'cinematic_open',
        description: 'legacy segment',
        visual_prompt: 'legacy',
        motion: 'dolly in',
        visual_motion: {
          preset: 'ken burns',
          intensity: 1.4,
          easing: 'ease-out',
          driver: 'css_animation',
        },
        accepted_material_types: ['clip', 'photo', 'unknown_type'],
      },
    ],
    style_summary: {
      style_family: 'legacy',
      editing_pattern: 'legacy',
      audio_sync_logic: 'legacy',
    },
    remotion_capability_plan: {
      matched_plugins: [],
      missing_capabilities: [],
    },
    render_recipe: {
      scene_effects: [
        {
          segment_id: 'seg_001',
          preset: 'cinematic_grade_pack',
        },
      ],
    },
    effect_intents: [
      {
        intent_id: 'legacy_grade',
        segment_id: 'seg_001',
        evidence_refs: [],
        sync: {
          driver: 'none',
        },
      },
    ],
  },
  'legacy_task',
)

assert.equal(legacyGrounding.temporal_events[0]?.creative_role, 'cinematic_open')
assert.equal(legacyGrounding.temporal_events[0]?.visual_motion.preset, 'zoom_in')
assert.equal(legacyGrounding.temporal_events[0]?.visual_motion.intensity, 1)
assert.equal(legacyGrounding.temporal_events[0]?.visual_motion.driver, 'useCurrentFrame')
assert.deepEqual(legacyGrounding.temporal_events[0]?.accepted_material_types, ['video', 'image'])
assert.equal(legacyGrounding.effect_intents[0]?.sync?.driver, 'manual')
assert.equal(legacyGrounding.critique.final_decision, 'usable')

const sample = parseSampleUnderstandingResult(
  directorGroundingToSampleUnderstanding({
    grounding,
    taskId,
    videoUrl: 'http://localhost:3001/uploads/sample.mp4',
    materials,
  }),
  { taskId },
)
const migration = templateToMigrationProtocolV12(sample.template, {
  taskId,
  videoUrl: 'http://localhost:3001/uploads/sample.mp4',
  materials,
})
const outline = buildOutlineFromStructure(migration)
const timeline = buildTimelineFromStructure(migration)
const renderPlan = buildRenderPlanFromStructure({
  taskId,
  structure: migration,
  materials,
  sampleReference: {
    id: 'sample_001',
    url: 'http://localhost:3001/uploads/sample.mp4',
    duration_sec: 8,
  },
})

assert.equal(sample.schema_version, 'sample_understanding.v1')
assert.equal(sample.template.content_domain, 'landscape_montage')
assert.equal(sample.template.structure.length, 4)
assert.equal(sample.template.structure[0]?.creative_role, 'opening')
assert.equal(sample.template.structure[0]?.evidence_refs?.[0], 'phen_001')
assert.equal(migration.version, '1.2')
assert.equal(migration.metadata.content_domain, 'landscape_montage')
assert.equal(migration.semantic_anchors[0]?.logic_intent.creative_role, 'opening')
assert.equal(migration.semantic_anchors[0]?.logic_intent.marketing_role, 'opening')
assert.equal(outline[0]?.title, '开篇')
assert.equal(outline[1]?.title, '铺陈')
assert.equal(outline[2]?.title, '高潮')
assert.equal(outline[3]?.title, '余韵')
assert.notEqual(outline[0]?.title, '开场吸引')
assert.equal(timeline.clips.length >= 4, true)
assert.equal(renderPlan.strategy, 'montage')
assert.equal(renderPlan.scenes[0]?.visual.asset_id, 'mat_video_001')
assert.equal(renderPlan.assets.some((asset) => asset.id === 'sample_reference_audio'), false)
assert.equal(renderPlan.scenes[0]?.audio[0]?.asset_id, undefined)
assert.equal(
  sample.template.render_recipe?.scene_effects?.some(
    (effect) => effect.preset === 'primitive_beat_pulse',
  ),
  true,
)
assert.equal(
  sample.template.render_recipe?.global_effects?.[0],
  'primitive_texture_grade',
)
assert.equal(
  renderPlan.scenes[2]?.effect_layers?.some((layer) => layer.preset === 'primitive_beat_pulse'),
  false,
)

const shotAwareGrounding = {
  ...grounding,
  shot_events: [
    {
      id: 'shot_001',
      start_sec: 0,
      end_sec: 1,
      visual_summary: 'Opening lake detail.',
      visual_change_intensity: 0.35,
      linked_temporal_event_id: 'seg_001',
    },
    {
      id: 'shot_002',
      start_sec: 1,
      end_sec: 2,
      visual_summary: 'Second beat cut to mountain.',
      camera_motion: 'pan right',
      visual_change_intensity: 0.55,
      linked_temporal_event_id: 'seg_001',
    },
    {
      id: 'shot_003',
      start_sec: 2,
      end_sec: 3.5,
      visual_summary: 'Forest rhythm build.',
      visual_change_intensity: 0.5,
      linked_temporal_event_id: 'seg_002',
    },
    {
      id: 'shot_004',
      start_sec: 3.5,
      end_sec: 5.5,
      visual_summary: 'River and peak accent.',
      visual_change_intensity: 0.75,
      linked_temporal_event_id: 'seg_003',
    },
    {
      id: 'shot_005',
      start_sec: 5.5,
      end_sec: 8,
      visual_summary: 'Soft cloud afterglow.',
      visual_change_intensity: 0.3,
      linked_temporal_event_id: 'seg_004',
    },
  ],
  transition_observations: [
    {
      id: 'obs_tr_001',
      at_sec: 1,
      from_shot_id: 'shot_001',
      to_shot_id: 'shot_002',
      type: 'hard_cut',
      duration_sec: 0,
      visual_mechanism: 'beat cut',
    },
    {
      id: 'obs_tr_002',
      at_sec: 2,
      from_shot_id: 'shot_002',
      to_shot_id: 'shot_003',
      type: 'dissolve',
      duration_sec: 0.32,
      visual_mechanism: 'soft dissolve',
    },
    {
      id: 'obs_tr_003',
      at_sec: 3.5,
      from_shot_id: 'shot_003',
      to_shot_id: 'shot_004',
      type: 'flash',
      duration_sec: 0.12,
      visual_mechanism: 'white flash accent',
    },
    {
      id: 'obs_tr_004',
      at_sec: 5.5,
      from_shot_id: 'shot_004',
      to_shot_id: 'shot_005',
      type: 'slide',
      duration_sec: 0.28,
      visual_mechanism: 'directional slide',
    },
  ],
}
const shotAwareRenderPlan = buildRenderPlanFromStructure({
  taskId: `${taskId}_shot_aware`,
  structure: {
    ...migration,
    director_grounding: shotAwareGrounding,
  },
  materials: coverageMaterials,
  sampleReference: {
    id: 'sample_001',
    url: 'http://localhost:3001/uploads/sample.mp4',
    duration_sec: 8,
  },
})
const usedShotAssets = new Set(
  shotAwareRenderPlan.scenes
    .map((scene) => scene.visual.asset_id)
    .filter((assetId): assetId is string => Boolean(assetId)),
)
assert.equal(shotAwareRenderPlan.scenes.length, 5)
assert.equal(usedShotAssets.size, 5)
assert.equal(shotAwareRenderPlan.transitions?.length, 4)
assert.equal(shotAwareRenderPlan.transitions?.[1]?.presentation, 'fade')
assert.equal(shotAwareRenderPlan.transitions?.[2]?.overlay?.type, 'flash')
assert.equal(shotAwareRenderPlan.transitions?.[3]?.presentation, 'slide')
assert.equal(shotAwareRenderPlan.scenes[0]?.source_anchor_id, 'seg_001')
assert.equal(shotAwareRenderPlan.scenes[0]?.id, 'scene_shot_001')

console.info('[smoke-director-grounding] OK')
console.info(
  JSON.stringify(
    {
      contentDomain: sample.template.content_domain,
      templateSegments: sample.template.structure.map((seg) => ({
        id: seg.id,
        creative_role: seg.creative_role,
        label: creativeRoleLabel(seg.creative_role),
      })),
      outlineTitles: outline.map((item) => item.title),
      migrationAnchors: migration.semantic_anchors.length,
      timelineClips: timeline.clips.length,
      renderStrategy: renderPlan.strategy,
      firstSceneAsset: renderPlan.scenes[0]?.visual.asset_id,
      pluginAuthoringSkill: sample.template.style_features.plugin_authoring_skill,
    },
    null,
    2,
  ),
)
