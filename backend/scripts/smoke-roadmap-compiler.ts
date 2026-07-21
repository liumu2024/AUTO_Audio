import assert from 'node:assert/strict'

import {
  validColorPortalUnlockRoadmapFixture,
  validKineticOrbRevealRoadmapFixture,
} from '../../shared/lib/effect-roadmap.fixtures.js'
import { matchAtomsToRegistry } from '../src/modules/effect-roadmap/atom-registry-matcher.js'
import {
  applyCompiledEffectLayersToRenderPlan,
  compileEffectRoadmap,
  layerHasSharedBinding,
  LAYER_COMPILE_ORDER,
} from '../src/modules/effect-roadmap/roadmap-compiler.js'
import { expectedTriangleCollageRoadmapFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import {
  buildTriangleSeedMapperInput,
  createMockSeedClient,
} from '../src/modules/effect-roadmap/seed-plugin-mapper.fixtures.js'
import { mapMissingAtomsWithSeed } from '../src/modules/effect-roadmap/seed-plugin-mapper.js'

function emptySeedArtifact(taskId: string) {
  return {
    schema_version: 'mapping_decisions_seed.v1' as const,
    task_id: taskId,
    decisions: [],
    remaining_missing_atoms: [],
  }
}

function assertLayerOrder(layers: Array<{ layerKind: string }>): void {
  let lastIndex = -1
  for (const layer of layers) {
    const index = LAYER_COMPILE_ORDER.indexOf(layer.layerKind as (typeof LAYER_COMPILE_ORDER)[number])
    assert.ok(index >= lastIndex, `layer order violated at ${layer.layerKind}`)
    lastIndex = index
  }
}

// color_portal_unlock -> 3 primitive layers; mask/ring share center/radius
const portalMatcher = matchAtomsToRegistry({
  taskId: 'fixture_color_portal_unlock',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
})

const portalCompiled = compileEffectRoadmap({
  taskId: 'fixture_color_portal_unlock',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  mappingDecisionsLocal: {
    local_registry_decisions: portalMatcher.localMappingDecisions,
  },
  mappingDecisionsSeed: emptySeedArtifact('fixture_color_portal_unlock'),
})

const portalSegment = portalCompiled.segments[0]
assert.ok(portalSegment)
assert.equal(portalSegment.effect_layers.length, 3)
assert.equal(
  portalSegment.effect_layers.every((layer) => !layer.preset.includes('color_portal_spotlight')),
  true,
)
assertLayerOrder(portalSegment.effect_layers)

const portalSharedKeys = Object.keys(portalSegment.shared_params)
assert.ok(portalSharedKeys.length >= 2)

const maskRingCenterKey = portalSharedKeys.find((key) =>
  portalSegment.shared_params[key]?.source_path.includes('center'),
)
const maskRingRadiusKey = portalSharedKeys.find((key) =>
  portalSegment.shared_params[key]?.source_path.includes('radius'),
)
assert.ok(maskRingCenterKey)
assert.ok(maskRingRadiusKey)

const ringLayer = portalSegment.effect_layers.find(
  (layer) =>
    layer.preset === 'primitive_ring_overlay' || layer.preset === 'primitive_orb_ring_overlay',
)
assert.ok(ringLayer)
assert.equal(layerHasSharedBinding(ringLayer, maskRingCenterKey!), true)
assert.equal(layerHasSharedBinding(ringLayer, maskRingRadiusKey!), true)

// kinetic_orb_reveal -> 4 layers; wave origin bound to orb path
const kineticMatcher = matchAtomsToRegistry({
  taskId: 'fixture_kinetic_orb_reveal',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
})

const kineticCompiled = compileEffectRoadmap({
  taskId: 'fixture_kinetic_orb_reveal',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
  mappingDecisionsLocal: {
    local_registry_decisions: kineticMatcher.localMappingDecisions,
  },
  mappingDecisionsSeed: emptySeedArtifact('fixture_kinetic_orb_reveal'),
})

const kineticSegment = kineticCompiled.segments[0]
assert.ok(kineticSegment)
assert.equal(kineticSegment.effect_layers.length, 4)
assert.equal(
  kineticSegment.effect_layers.every((layer) => !layer.preset.includes('kinetic_color_ripple')),
  true,
)
assertLayerOrder(kineticSegment.effect_layers)

const waveOriginKey = Object.keys(kineticSegment.shared_params).find((key) =>
  kineticSegment.shared_params[key]?.source_path.includes('orb.path_keyframes'),
)
assert.ok(waveOriginKey)

const waveLayer = kineticSegment.effect_layers.find(
  (layer) => layer.preset === 'primitive_directional_wave_reveal',
)
assert.ok(waveLayer)
assert.equal(layerHasSharedBinding(waveLayer, waveOriginKey!), true)

// triangle collage with local triangle plugin -> no rectangle fallback
const triangleMatcher = matchAtomsToRegistry({
  taskId: 'fixture_triangle_collage',
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
})

const triangleSeed = await mapMissingAtomsWithSeed(
  buildTriangleSeedMapperInput(
    createMockSeedClient({
      available: false,
      raw_response: 'Seed authoring endpoint unreachable (503)\n',
      proposals: [],
      unavailable_reason: 'Seed authoring service unavailable',
    }),
  ),
)

const triangleCompiled = compileEffectRoadmap({
  taskId: 'fixture_triangle_collage',
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
  mappingDecisionsLocal: {
    local_registry_decisions: triangleMatcher.localMappingDecisions,
  },
  mappingDecisionsSeed: triangleSeed.mappingDecisionsSeed,
  lossLedger: expectedTriangleCollageRoadmapFixture.loss_ledger,
})

const triangleSegment = triangleCompiled.segments[0]
assert.ok(triangleSegment)
assert.equal(triangleSegment.effect_layers.length, 1)
assert.equal(triangleSegment.effect_layers[0]?.plugin_id, 'radial_triangle_prism_collage')
assert.equal(
  triangleSegment.effect_layers.some((layer) => layer.plugin_id === 'split_collage_layout'),
  false,
)
assert.equal(
  triangleSegment.effect_layers.some((layer) => layer.preset === 'primitive_collage_layout'),
  true,
)

// Seed mappings preserve layerKind from generated manifest instead of collapsing to layout.
const seedLayerKindAtom = validColorPortalUnlockRoadmapFixture.segments[0]!.atoms[0]!
const seedLayerKindCompiled = compileEffectRoadmap({
  taskId: 'fixture_seed_layer_kind',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  mappingDecisionsLocal: {
    local_registry_decisions: [],
  },
  mappingDecisionsSeed: {
    schema_version: 'mapping_decisions_seed.v1',
    task_id: 'fixture_seed_layer_kind',
    remaining_missing_atoms: [],
    decisions: [
      {
        atom_id: seedLayerKindAtom.id,
        missing_atom_id: 'missing_seed_mask',
        decision: 'generate_plugin',
        target_layer: 'effect',
        plugin_family: 'mask_reveal',
        must_match: {},
        can_adapt: [],
        fallback: null,
        loss_risk: [],
        proposal: {
          atom_id: seedLayerKindAtom.id,
          missing_atom_id: 'missing_seed_mask',
          plugin_id: 'seed_mask_reveal',
          plugin_family: 'mask_reveal',
          target_layer: 'effect',
          must_match: {},
          can_adapt: [],
          status: 'draft',
          manifest: {
            id: 'seed_mask_reveal',
            layer_kind: 'mask_reveal',
            fallbackPreset: 'primitive_mask_reveal',
          },
        },
      },
    ],
  },
})
assert.equal(seedLayerKindCompiled.segments[0]?.effect_layers[0]?.layerKind, 'mask_reveal')

// Seed manifest without fallbackPreset hydrates from layerKind and compiles.
const seedHydrateAtom = validColorPortalUnlockRoadmapFixture.segments[0]!.atoms.find(
  (atom) => atom.id === 'atom_mask',
)!
const seedHydrateCompiled = compileEffectRoadmap({
  taskId: 'fixture_seed_hydrate',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  mappingDecisionsLocal: { local_registry_decisions: [] },
  mappingDecisionsSeed: {
    schema_version: 'mapping_decisions_seed.v1',
    task_id: 'fixture_seed_hydrate',
    remaining_missing_atoms: [],
    decisions: [
      {
        atom_id: seedHydrateAtom.id,
        missing_atom_id: 'missing_seed_mask',
        decision: 'generate_plugin',
        target_layer: 'effect',
        plugin_family: 'mask_reveal',
        must_match: {},
        can_adapt: [],
        fallback: null,
        loss_risk: [],
        proposal: {
          atom_id: seedHydrateAtom.id,
          missing_atom_id: 'missing_seed_mask',
          plugin_id: 'seed_custom_mask_reveal',
          plugin_family: 'mask_reveal',
          target_layer: 'effect',
          must_match: {},
          can_adapt: [],
          status: 'draft',
          manifest: {
            id: 'seed_custom_mask_reveal',
            layerKind: 'mask_reveal',
            visual_grammar: ['geometry.mask_shape=circle'],
          },
        },
      },
    ],
  },
})
const hydratedMaskLayer = seedHydrateCompiled.segments[0]?.effect_layers.find(
  (layer) => layer.preset === 'primitive_mask_reveal',
)
assert.ok(hydratedMaskLayer)
assert.equal(hydratedMaskLayer?.layerKind, 'mask_reveal')

// Verified seed component authoring maps to generated_component instead of primitive fallback.
const seedGeneratedCompiled = compileEffectRoadmap({
  taskId: 'fixture_seed_generated_component',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  mappingDecisionsLocal: { local_registry_decisions: [] },
  mappingDecisionsSeed: {
    schema_version: 'mapping_decisions_seed.v1',
    task_id: 'fixture_seed_generated_component',
    remaining_missing_atoms: [],
    decisions: [
      {
        atom_id: seedHydrateAtom.id,
        missing_atom_id: 'missing_seed_mask',
        decision: 'generate_plugin',
        target_layer: 'effect',
        plugin_family: 'mask_reveal',
        must_match: {},
        can_adapt: [],
        fallback: null,
        loss_risk: [],
        proposal: {
          atom_id: seedHydrateAtom.id,
          missing_atom_id: 'missing_seed_mask',
          plugin_id: 'seed_custom_mask_reveal',
          plugin_family: 'mask_reveal',
          target_layer: 'effect',
          must_match: {},
          can_adapt: [],
          status: 'draft',
          manifest: {
            id: 'seed_custom_mask_reveal',
            layerKind: 'mask_reveal',
            visual_grammar: ['geometry.mask_shape=circle'],
          },
        },
      },
    ],
  },
  seedAuthoringByAtomId: new Map([
    [
      seedHydrateAtom.id,
      {
        atom_id: seedHydrateAtom.id,
        component_id: 'gen_seed_custom_mask_reveal',
        ok: true,
        layerKind: 'mask_reveal',
        fallback_preset: 'primitive_mask_reveal',
        component_props: { capability_id: 'seed_custom_mask_reveal' },
        reason: 'Seed proposal seed_custom_mask_reveal authored as gen_seed_custom_mask_reveal.',
      },
    ],
  ]),
})
const generatedLayer = seedGeneratedCompiled.segments[0]?.effect_layers.find(
  (layer) => layer.preset === 'generated_component',
)
assert.ok(generatedLayer)
assert.equal(generatedLayer?.plugin_id, 'gen_seed_custom_mask_reveal')
assert.equal(
  (generatedLayer?.effects as { component_id?: string }).component_id,
  'gen_seed_custom_mask_reveal',
)

// Compiled layers can be written back to RenderPlan for frontend/Remotion consumption.
const patchedPlan = applyCompiledEffectLayersToRenderPlan({
  compiled: portalCompiled,
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  plan: {
    version: '1.0',
    task_id: 'fixture_color_portal_unlock',
    strategy: 'hybrid',
    duration_sec: 3,
    canvas: { width: 1080, height: 1920, fps: 30, ratio: '9:16' },
    assets: [],
    scenes: [
      {
        id: 'scene_segment_portal',
        source_anchor_id: validColorPortalUnlockRoadmapFixture.segments[0]!.segment_id,
        name: 'portal',
        start_sec: 0,
        end_sec: 3,
        role: 'demo',
        intent: {
          marketing_role: 'demo',
          emotion_vibe: 'clean',
          purpose: 'smoke',
        },
        visual: {
          mode: 'solid_bg',
          fit: 'cover',
          visual_prompt: 'portal',
        },
        effect_layers: [
          {
            id: 'legacy_scene_recipe',
            layerKind: 'composite',
            kind: 'composite',
            plugin_id: 'color_portal_spotlight',
            preset: 'color_portal_spotlight',
            effects: {
              preset: 'color_portal_spotlight',
              portal: {
                shape: 'circle',
                position_keyframes: [{ time: 0, x_pct: 50, y_pct: 50 }],
                radius_pct_keyframes: [
                  { time: 0, value: 0 },
                  { time: 1, value: 55 },
                ],
              },
              ring: {
                enabled: true,
                stroke_px: 8,
                colors: ['#ffffff'],
                glow: {
                  outer_blur_px: 18,
                  outer_spread_px: 0,
                  inner_blur_px: 0,
                },
              },
            },
            source: 'scene_recipe',
            is_primary: true,
          },
          {
            id: 'global_grade',
            layerKind: 'texture_grade',
            kind: 'texture_grade',
            plugin_id: 'cinematic_texture_grade',
            preset: 'primitive_texture_grade',
            effects: {
              preset: 'primitive_texture_grade',
              color_grade: { saturate: 1.05, contrast: 1.02 },
            },
            source: 'global_effect',
            is_primary: false,
          },
        ],
        overlays: [],
        audio: [],
      },
    ],
  },
})
const patchedLayers = patchedPlan.scenes[0]?.effect_layers ?? []
assert.equal(
  patchedLayers.some((layer) => layer.preset === 'color_portal_spotlight'),
  false,
)
assert.equal(
  patchedLayers.some((layer) => layer.preset === 'primitive_ring_overlay'),
  true,
)
assert.equal(
  patchedLayers.some((layer) => layer.id === 'global_grade'),
  true,
)
const patchedBinding = patchedPlan.scenes[0]?.effect_binding
assert.ok(patchedBinding?.sharedParams && Object.keys(patchedBinding.sharedParams).length > 0)
assert.ok(patchedBinding?.sharedGeometry?.origin)

console.info('[smoke-roadmap-compiler] ok', {
  portalLayers: portalSegment.effect_layers.length,
  kineticLayers: kineticSegment.effect_layers.length,
  triangleLayers: triangleSegment.effect_layers.length,
  triangleLossEntries: triangleCompiled.loss_ledger.length,
})
