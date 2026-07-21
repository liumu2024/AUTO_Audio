import assert from 'node:assert/strict'

import {
  validColorPortalUnlockRoadmapFixture,
  validKineticOrbRevealRoadmapFixture,
} from '../../shared/lib/effect-roadmap.fixtures.js'
import { expectedTriangleCollageRoadmapFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import { matchAtomsToRegistry } from '../src/modules/effect-roadmap/atom-registry-matcher.js'
import { compileEffectRoadmap } from '../src/modules/effect-roadmap/roadmap-compiler.js'
import { resolveEffectIntents } from '../../shared/lib/effect-intent-resolver.js'
import { buildCapabilityGraph, findGraphNodesProviding } from '../../shared/lib/capability-graph.js'
import { recipeForIntent } from '../../shared/lib/composition-recipes.js'
import { planCompositionFromIntents } from '../src/modules/effect-composition/capability-graph-planner.js'
import { validateComposition } from '../src/modules/effect-composition/composition-validator.js'
import {
  runEffectCompositionPipeline,
  attachCompositionStatusToRenderPlan,
} from '../src/modules/effect-composition/run-effect-composition-pipeline.js'
import { applyCompositionPlanToRenderPlan } from '../src/modules/effect-composition/composition-plan-compiler.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'

function compileFixture(taskId: string, roadmap: typeof validColorPortalUnlockRoadmapFixture) {
  const matcher = matchAtomsToRegistry({ taskId, effectRoadmap: roadmap })
  const compiled = compileEffectRoadmap({
    taskId,
    effectRoadmap: roadmap,
    mappingDecisionsLocal: { local_registry_decisions: matcher.localMappingDecisions },
    mappingDecisionsSeed: {
      schema_version: 'mapping_decisions_seed.v1',
      task_id: taskId,
      decisions: [],
      remaining_missing_atoms: [],
    },
  })
  return { matcher, compiled }
}

// Intent IR has no preset/plugin_id
const portalIntents = resolveEffectIntents({
  taskId: 'fixture_portal',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
})
assert.equal(portalIntents.intents[0]?.intent_id, 'grayscale_color_unlock')
assert.equal(JSON.stringify(portalIntents).includes('primitive_color_transform'), false)

const { matcher: portalMatcher, compiled: portalCompiled } = compileFixture(
  'fixture_portal',
  validColorPortalUnlockRoadmapFixture,
)
const portalPipeline = runEffectCompositionPipeline({
  taskId: 'fixture_portal',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  compiledEffectLayers: portalCompiled,
  localMappingDecisions: portalMatcher.localMappingDecisions,
})
assert.equal(portalPipeline.compositionValidation.status, 'complete')
assert.equal(portalPipeline.sceneCompositionStatuses[0]?.status, 'complete')
assert.ok(portalPipeline.sceneCompositionStatuses[0]?.layers.length === 3)

const graph = buildCapabilityGraph()
const maskNodes = findGraphNodesProviding(graph, 'color_reveal', 'grayscale_color_unlock')
assert.ok(maskNodes.some((node) => node.plugin_id === 'circle_mask_reveal'))

const recipe = recipeForIntent('orb_driven_color_wave')
assert.ok(recipe?.required_layers.some((layer) => layer.provides === 'orb_motion'))

const { matcher: kineticMatcher, compiled: kineticCompiled } = compileFixture(
  'fixture_kinetic',
  validKineticOrbRevealRoadmapFixture,
)
const kineticPipeline = runEffectCompositionPipeline({
  taskId: 'fixture_kinetic',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
  compiledEffectLayers: kineticCompiled,
  localMappingDecisions: kineticMatcher.localMappingDecisions,
})
assert.equal(kineticPipeline.compositionValidation.status, 'complete')
assert.equal(kineticPipeline.sceneCompositionStatuses[0]?.layers.length, 4)

// triangle collage -> local triangle layout plugin, no rectangle fallback in compiled layers
const { matcher: triangleMatcher, compiled: triangleCompiled } = compileFixture(
  'fixture_triangle',
  expectedTriangleCollageRoadmapFixture,
)
const trianglePipeline = runEffectCompositionPipeline({
  taskId: 'fixture_triangle',
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
  compiledEffectLayers: triangleCompiled,
  localMappingDecisions: triangleMatcher.localMappingDecisions,
})
assert.equal(trianglePipeline.compositionValidation.status, 'complete')
assert.equal(trianglePipeline.sceneCompositionStatuses[0]?.status, 'complete')
assert.equal(triangleCompiled.segments[0]?.effect_layers.length, 1)
assert.equal(triangleCompiled.segments[0]?.effect_layers[0]?.plugin_id, 'radial_triangle_prism_collage')
assert.equal(
  triangleCompiled.segments[0]?.effect_layers.some((layer) => layer.plugin_id === 'split_collage_layout'),
  false,
)

const patchedPlan = attachCompositionStatusToRenderPlan({
  plan: {
    version: '1.0',
    task_id: 'fixture_portal',
    strategy: 'motion_graphics',
    duration_sec: 3,
    canvas: { width: 1080, height: 1920, fps: 30, ratio: '9:16' },
    assets: [],
    scenes: [
      {
        id: 'scene_1',
        source_anchor_id: 'seg_002',
        name: 'Portal',
        start_sec: 0,
        end_sec: 3,
        role: 'hook',
        intent: { marketing_role: 'hook', emotion_vibe: 'cinematic', purpose: 'test' },
        visual: { mode: 'solid_bg', fit: 'cover', visual_prompt: 'portal' },
        overlays: [],
        audio: [],
      },
    ],
  },
  statuses: portalPipeline.sceneCompositionStatuses,
})
assert.equal(patchedPlan.scenes[0]?.composition_status?.status, 'complete')

// Grounding-only fallback when roadmap is empty
const groundingOnlyPipeline = runEffectCompositionPipeline({
  taskId: 'fixture_grounding_only',
  effectRoadmap: { schema_version: 'effect_roadmap.v1', task_id: 'fixture_grounding_only', segments: [] },
  groundingEffectIntents: [
    {
      intent_id: 'grayscale_color_unlock',
      segment_id: 'seg_001',
      evidence_refs: ['phen_001'],
      unlock_mode: 'radial_reveal',
      sync: { driver: 'audio_beat', peak_policy: 'unlock_on_strong_beat' },
    },
  ],
  compiledEffectLayers: {
    schema_version: 'compiled_effect_layers.v1',
    task_id: 'fixture_grounding_only',
    segments: [],
    loss_ledger: [],
  },
  localMappingDecisions: [],
})
assert.equal(groundingOnlyPipeline.effectIntent.intents[0]?.intent_id, 'grayscale_color_unlock')
assert.equal(groundingOnlyPipeline.compositionPlan.segments.length, 1)
assert.equal(groundingOnlyPipeline.compositionValidation.status, 'auto_repaired')

const groundingOnlyStructure: MigrationProtocolV12 = {
  version: '1.2',
  metadata: { video_id: 'fixture_grounding_only', duration_sec: 3 },
  source_video: { url: 'sample.mp4', duration: 3 },
  generated_video: { url: '', duration: 3 },
  semantic_anchors: [
    {
      anchor_id: 'seg_001',
      start_sec: 0,
      end_sec: 3,
      sequence: { from_sec: 0, duration_sec: 3, layout: 'fill', premount_sec: 0.3 },
      logic_intent: { marketing_role: 'opening', emotion_vibe: 'cinematic' },
      match: { status: 'gap', asset_name: null, asset_id: 'slot_001' },
      replication_instructions: {
        visual_generation_prompt: 'black and white frame unlocks to full color on beat',
        overlay_rewrite_instruction: '',
        visual_motion: { preset: 'static', intensity: 0.1, easing: 'linear', driver: 'useCurrentFrame' },
      },
    },
  ],
  transitions: [],
}
const repairedPlan = applyCompositionPlanToRenderPlan({
  plan: {
    version: '1.0',
    task_id: 'fixture_grounding_only',
    strategy: 'motion_graphics',
    duration_sec: 3,
    canvas: { width: 1080, height: 1920, fps: 30, ratio: '9:16' },
    assets: [],
    scenes: [
      {
        id: 'scene_seg_001',
        source_anchor_id: 'seg_001',
        name: 'Grounding only',
        start_sec: 0,
        end_sec: 3,
        role: 'hook',
        intent: { marketing_role: 'hook', emotion_vibe: 'cinematic', purpose: 'test' },
        visual: { mode: 'solid_bg', fit: 'cover', visual_prompt: 'unlock' },
        overlays: [],
        audio: [],
      },
    ],
  },
  structure: groundingOnlyStructure,
  compositionPlan: groundingOnlyPipeline.compositionPlan,
})
const repairedPresets = repairedPlan.scenes[0]?.effect_layers?.map((layer) => layer.preset) ?? []
assert.ok(
  repairedPresets.includes('primitive_beat_color_unlock') ||
    (repairedPresets.includes('primitive_color_transform') &&
      repairedPresets.includes('primitive_mask_reveal')),
)

console.info('[smoke-effect-composition-pipeline] ok', {
  portalStatus: portalPipeline.compositionValidation.status,
  kineticLayers: kineticPipeline.sceneCompositionStatuses[0]?.layers.length,
  triangleStatus: trianglePipeline.compositionValidation.status,
})
