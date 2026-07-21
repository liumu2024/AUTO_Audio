import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  EFFECT_DEBUG_ARTIFACT_FILES,
} from '../../shared/types/effect-debug-artifacts.v1.js'
import { validateEffectRoadmap } from '../../shared/lib/effect-roadmap.validator.js'
import { EffectLossLedgerSchema } from '../src/modules/effect-debug-artifacts/loss-ledger.schema.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'
import {
  buildEffectDebugArtifacts,
  writeEffectDebugArtifacts,
} from '../src/modules/effect-debug-artifacts/index.js'

const taskId = 'smoke_effect_debug_artifacts'

const structure: MigrationProtocolV12 = {
  version: '1.2',
  metadata: {
    video_id: taskId,
    duration_sec: 4,
  },
  source_video: {
    url: 'http://localhost/sample.mp4',
    duration: 4,
  },
  generated_video: {
    url: '',
    duration: 4,
  },
  semantic_anchors: [
    {
      anchor_id: 'seg_001',
      start_sec: 0,
      end_sec: 4,
      sequence: {
        from_sec: 0,
        duration_sec: 4,
        layout: 'fill',
        premount_sec: 0.3,
      },
      logic_intent: {
        marketing_role: 'opening',
        emotion_vibe: 'cinematic',
      },
      match: {
        status: 'gap',
        asset_name: null,
        asset_id: 'slot_001',
      },
      replication_instructions: {
        visual_generation_prompt: 'Minimal smoke scene',
        overlay_rewrite_instruction: '',
        visual_motion: {
          preset: 'push_in',
          intensity: 0.2,
          easing: 'ease-out',
          driver: 'useCurrentFrame',
        },
      },
    },
  ],
  transitions: [],
  director_grounding: {
    schema_version: 'director_grounding.v1',
    task_id: taskId,
    content_domain: 'landscape_montage',
    source: {
      sample_video: { id: 'sample', name: 'sample.mp4', role: 'structure_source' },
      reference_materials: [],
    },
    intent: {
      raw_text: 'smoke',
      goal: 'replicate_structure',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: 'smoke test',
    },
    audio_visual_evidence: {
      duration_sec: 4,
      fps: 30,
      key_observations: [],
      beat_summary: '',
    },
    visual_phenomena: [
      {
        id: 'phen_001',
        start_sec: 0,
        end_sec: 4,
        type: 'texture_grade',
        mechanism: 'texture_grade',
        description: 'Subtle cinematic grade',
        evidence: 'Overall warm grade',
        confidence: 0.8,
      },
    ],
    temporal_events: [],
    style_summary: {
      style_family: 'smoke',
      editing_pattern: 'cut',
      audio_sync_logic: 'none',
      visual_style: 'cinematic',
      pace: 'medium',
    },
    remotion_capability_plan: {
      matched_plugins: [],
      capability_layers: [],
      missing_capabilities: [
        {
          id: 'custom_glow',
          description: 'Optional glow not in registry',
          suggested_contract: {
            target_layer: 'effect',
            segment_ids: ['seg_001'],
          },
        },
      ],
      plugin_authoring_skill: {
        enabled: false,
        purpose: 'disabled',
        candidate_plugin_ids: [],
      },
    },
    render_recipe: {
      style_family: 'smoke',
      global_effects: ['primitive_texture_grade'],
      scene_effects: [
        {
          segment_id: 'seg_001',
          plugin_id: 'cinematic_texture_grade',
          layer: 'texture_grade',
          preset: 'primitive_texture_grade',
          evidence_refs: ['phen_001'],
          confidence: 0.8,
        },
      ],
      audio_driver: {
        beat_times: [1, 2, 3],
        strong_beats: [2],
      },
    },
    critique: {
      likely_failure_points: [],
      repair_notes: [],
      final_decision: 'usable',
    },
  },
  render_recipe: {
    style_family: 'smoke',
    global_effects: ['primitive_texture_grade'],
    scene_effects: [
      {
        segment_id: 'seg_001',
        plugin_id: 'cinematic_texture_grade',
        layer: 'texture_grade',
        preset: 'primitive_texture_grade',
        evidence_refs: ['phen_001'],
        confidence: 0.8,
      },
    ],
    audio_driver: {
      beat_times: [1, 2, 3],
      strong_beats: [2],
    },
  },
}

const renderPlan = buildRenderPlanFromStructure({
  taskId,
  structure,
  materials: [],
})

const bundle = await buildEffectDebugArtifacts({
  taskId,
  structure,
  renderPlan,
  componentResolution: {
    enabled: true,
    authoring_enabled: false,
    decisions: [
      {
        capability_id: 'custom_glow',
        segment_ids: ['seg_001'],
        decision: 'fallback',
        preset: 'primitive_bloom_overlay',
        fallback_preset: 'primitive_bloom_overlay',
        reason: 'Smoke fallback decision',
      },
    ],
  },
})

const debugDir = await mkdtemp(path.join(os.tmpdir(), 'effect-debug-smoke-'))
const result = await writeEffectDebugArtifacts({
  taskId,
  bundle,
  debugDir,
})

assert.equal(result.debugDir, debugDir)

for (const fileName of EFFECT_DEBUG_ARTIFACT_FILES) {
  const filePath = path.join(debugDir, fileName)
  const content = await readFile(filePath, 'utf8')
  assert.ok(content.length > 0, `${fileName} should not be empty`)
}

const manifest = JSON.parse(
  await readFile(path.join(debugDir, 'effect-debug-manifest.json'), 'utf8'),
) as { loss_ledger: unknown }
const manifestLedger = EffectLossLedgerSchema.parse(manifest.loss_ledger)
assert.ok(manifestLedger.length > 0, 'manifest loss_ledger should contain entries')

const atomPlan = JSON.parse(await readFile(path.join(debugDir, 'atom-plan.json'), 'utf8')) as {
  loss_ledger: unknown
  data: unknown
}
EffectLossLedgerSchema.parse(atomPlan.loss_ledger)
assert.ok(Array.isArray(atomPlan.data), 'atom-plan.data should be an array when recipe exists')

const effectRoadmap = JSON.parse(
  await readFile(path.join(debugDir, 'effect-roadmap.json'), 'utf8'),
)
const roadmapValidation = validateEffectRoadmap(effectRoadmap)
assert.equal(
  roadmapValidation.ok,
  true,
  roadmapValidation.errors.map((item) => item.message).join('; '),
)
assert.deepEqual(effectRoadmap.segments, [])

const projection = JSON.parse(
  await readFile(path.join(debugDir, 'effect-roadmap-projection.json'), 'utf8'),
) as { schema_version: string; segment_roadmaps: unknown[] }
assert.equal(projection.schema_version, 'effect_roadmap_projection.v1')
assert.ok(Array.isArray(projection.segment_roadmaps) && projection.segment_roadmaps.length > 0)

const doctorReport = JSON.parse(await readFile(path.join(debugDir, 'doctor-report.json'), 'utf8')) as {
  doctor_status: string
  data: unknown
}
assert.equal(doctorReport.doctor_status, 'ok')
assert.ok(doctorReport.data)

const seedRaw = await readFile(
  path.join(debugDir, 'seed-plugin-authoring-raw-response.txt'),
  'utf8',
)
assert.ok(seedRaw.includes('Seed authoring service unavailable'))

const mappingSeed = JSON.parse(
  await readFile(path.join(debugDir, 'mapping-decisions.seed.json'), 'utf8'),
) as { decisions: Array<{ decision: string }> }
assert.equal(mappingSeed.decisions[0]?.decision, 'unavailable')

console.info('[smoke-effect-debug-artifacts] ok', {
  debugDir,
  lossLedgerEntries: manifestLedger.length,
  artifacts: EFFECT_DEBUG_ARTIFACT_FILES.length,
})
