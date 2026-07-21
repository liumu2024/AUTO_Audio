import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { EFFECT_DEBUG_ARTIFACT_FILES } from '../../shared/types/effect-debug-artifacts.v1.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'
import {
  buildEffectDebugArtifacts,
  writeEffectDebugArtifacts,
} from '../src/modules/effect-debug-artifacts/index.js'
import { expectedTriangleCollageRoadmapFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import {
  buildTriangleSeedSuccessProposal,
  createMockSeedClient,
} from '../src/modules/effect-roadmap/seed-plugin-mapper.fixtures.js'

const taskId = 'smoke_effect_debug_pipeline'

const structure: MigrationProtocolV12 = {
  version: '1.2',
  metadata: { video_id: taskId, duration_sec: 2.8 },
  source_video: { url: 'http://localhost/sample.mp4', duration: 2.8 },
  generated_video: { url: '', duration: 2.8 },
  semantic_anchors: [
    {
      anchor_id: 'seg_001',
      start_sec: 0,
      end_sec: 2.8,
      sequence: { from_sec: 0, duration_sec: 2.8, layout: 'fill', premount_sec: 0.3 },
      logic_intent: { marketing_role: 'climax', emotion_vibe: 'bold' },
      match: { status: 'gap', asset_name: null, asset_id: 'slot_001' },
      replication_instructions: {
        visual_generation_prompt: 'Triangle collage',
        overlay_rewrite_instruction: '',
        visual_motion: { preset: 'static', intensity: 0.1, easing: 'linear', driver: 'useCurrentFrame' },
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
      raw_text: 'triangle collage',
      goal: 'replicate_structure',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: 'smoke pipeline',
    },
    audio_visual_evidence: {
      duration_sec: 2.8,
      fps: 30,
      key_observations: [],
      beat_summary: '',
    },
    visual_phenomena: [
      {
        id: 'phen_tri_001',
        start_sec: 0,
        end_sec: 2.8,
        type: 'triangle_panel_collage',
        mechanism: 'layout',
        description: 'Triangle collage',
        evidence: 'Triangle panels',
        confidence: 0.93,
      },
    ],
    temporal_events: [],
    style_summary: {
      style_family: 'collage',
      editing_pattern: 'cut',
      audio_sync_logic: 'none',
      visual_style: 'editorial',
      pace: 'medium',
    },
    remotion_capability_plan: {
      matched_plugins: [],
      capability_layers: [],
      missing_capabilities: [],
      plugin_authoring_skill: {
        enabled: false,
        purpose: 'disabled',
        candidate_plugin_ids: [],
      },
    },
    render_recipe: { global_effects: [], scene_effects: [] },
    critique: {
      likely_failure_points: [],
      repair_notes: [],
      final_decision: 'usable',
    },
  },
  render_recipe: { global_effects: [], scene_effects: [] },
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
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
  roadmapAgentStatus: 'ok',
  seedClient: createMockSeedClient({
    available: true,
    raw_response: JSON.stringify({ status: 'ok' }),
    proposals: [buildTriangleSeedSuccessProposal()],
  }),
})

const debugDir = await mkdtemp(path.join(os.tmpdir(), 'effect-debug-pipeline-'))
await writeEffectDebugArtifacts({ taskId, bundle, debugDir })

for (const fileName of EFFECT_DEBUG_ARTIFACT_FILES) {
  const content = await readFile(path.join(debugDir, fileName), 'utf8')
  assert.ok(content.length > 0, `${fileName} should not be empty`)
}

const atomPlan = JSON.parse(await readFile(path.join(debugDir, 'atom-plan.json'), 'utf8')) as {
  source: string
  data: Array<{ atom_id: string; mapping_status: string }>
}
assert.equal(atomPlan.source, 'effect_roadmap')
assert.equal(atomPlan.data[0]?.mapping_status, 'missing')

const missingTodo = JSON.parse(
  await readFile(path.join(debugDir, 'missing-atoms.todo.json'), 'utf8'),
) as { items: Array<{ status: string; atom_id: string }> }
assert.equal(missingTodo.items[0]?.atom_id, 'atom_layout_collage')
assert.equal(missingTodo.items[0]?.status, 'seed_pending')

const mappingSeed = JSON.parse(
  await readFile(path.join(debugDir, 'mapping-decisions.seed.json'), 'utf8'),
) as { decisions: Array<{ decision: string; fallback: unknown }> }
assert.equal(mappingSeed.decisions[0]?.decision, 'generate_plugin')
assert.equal(mappingSeed.decisions[0]?.fallback, null)

const mappingLocal = JSON.parse(
  await readFile(path.join(debugDir, 'mapping-decisions.json'), 'utf8'),
) as { local_registry_decisions: Array<{ decision: string }> }
assert.equal(mappingLocal.local_registry_decisions[0]?.decision, 'missing')

const manifest = JSON.parse(
  await readFile(path.join(debugDir, 'effect-debug-manifest.json'), 'utf8'),
) as { loss_ledger: Array<{ reason: string; source_stage: string }> }
assert.equal(
  manifest.loss_ledger.some(
    (entry) =>
      entry.source_stage === 'effect_roadmap' &&
      entry.reason.includes('EffectRoadmap agent has not run'),
  ),
  false,
)

console.info('[smoke-effect-debug-pipeline] ok', {
  debugDir,
  artifacts: EFFECT_DEBUG_ARTIFACT_FILES.length,
})
