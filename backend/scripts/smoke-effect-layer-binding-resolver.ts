import assert from 'node:assert/strict'

import {
  DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT,
  DEFAULT_PRIMITIVE_RING_OVERLAY_EFFECT,
  DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT,
} from '../../shared/lib/effect-registry.js'
import { validColorPortalUnlockRoadmapFixture, validKineticOrbRevealRoadmapFixture } from '../../shared/lib/effect-roadmap.fixtures.js'
import {
  interpolatePathAtTime,
  resolveEffectLayerBindings,
  sampleLayerEffectsAtTime,
  sampleMaskCenterAtTime,
} from '../../shared/lib/effect-layer-binding-resolver.js'
import { splitEffectLayers } from '../../shared/lib/legacy-preset-split.js'
import { matchAtomsToRegistry } from '../src/modules/effect-roadmap/atom-registry-matcher.js'
import { compileEffectRoadmap } from '../src/modules/effect-roadmap/roadmap-compiler.js'
import { buildRemotionRenderProps } from '../src/modules/render-engine/render-props.js'
import type { RenderEffectLayer, RenderPlanV1 } from '../../shared/types/render-plan.v1.js'

function emptySeed(taskId: string) {
  return {
    schema_version: 'mapping_decisions_seed.v1' as const,
    task_id: taskId,
    decisions: [],
    remaining_missing_atoms: [],
  }
}

// portal: ring follows mask center/radius on the same frame
const portalMatcher = matchAtomsToRegistry({
  taskId: 'fixture_color_portal_unlock',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
})
const portalCompiled = compileEffectRoadmap({
  taskId: 'fixture_color_portal_unlock',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
  mappingDecisionsLocal: { local_registry_decisions: portalMatcher.localMappingDecisions },
  mappingDecisionsSeed: emptySeed('fixture_color_portal_unlock'),
})
const portalSegment = portalCompiled.segments[0]!
const portalResolved = resolveEffectLayerBindings({
  sceneId: portalSegment.segment_id,
  layers: portalSegment.effect_layers,
  sharedParams: portalSegment.shared_params,
  sharedGeometry: validColorPortalUnlockRoadmapFixture.segments[0]?.motif.shared_geometry,
})

const maskLayer = portalResolved.layers.find((layer) => layer.preset === 'primitive_mask_reveal')
const ringLayer = portalResolved.layers.find((layer) => layer.preset === 'primitive_ring_overlay')
assert.ok(maskLayer)
assert.ok(ringLayer)

const sampleTime = 0.6
const maskCenter = sampleMaskCenterAtTime(maskLayer!.effects, sampleTime)
const ringCenter = sampleMaskCenterAtTime(ringLayer!.effects, sampleTime)
assert.ok(maskCenter)
assert.ok(ringCenter)
assert.equal(maskCenter!.x_pct, ringCenter!.x_pct)
assert.equal(maskCenter!.y_pct, ringCenter!.y_pct)

// kinetic: orb path current point drives wave origin
const kineticMatcher = matchAtomsToRegistry({
  taskId: 'fixture_kinetic_orb_reveal',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
})
const kineticCompiled = compileEffectRoadmap({
  taskId: 'fixture_kinetic_orb_reveal',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
  mappingDecisionsLocal: { local_registry_decisions: kineticMatcher.localMappingDecisions },
  mappingDecisionsSeed: emptySeed('fixture_kinetic_orb_reveal'),
})
const kineticSegment = kineticCompiled.segments[0]!
const kineticResolved = resolveEffectLayerBindings({
  sceneId: kineticSegment.segment_id,
  layers: kineticSegment.effect_layers,
  sharedParams: kineticSegment.shared_params,
  sharedGeometry: validKineticOrbRevealRoadmapFixture.segments[0]?.motif.shared_geometry,
})

const orbLayer = kineticResolved.layers.find((layer) => layer.preset === 'primitive_orb_motion')
const waveLayer = kineticResolved.layers.find((layer) => layer.preset === 'primitive_directional_wave_reveal')
assert.ok(orbLayer)
assert.ok(waveLayer)
assert.ok(kineticResolved.runtimeFollows.length >= 1)

const kineticTime = 1.1
const orbPath = orbLayer!.effects as { orb: { path_keyframes: Array<{ time: number; x_pct: number; y_pct: number }> } }
const orbPoint = interpolatePathAtTime(orbPath.orb.path_keyframes, kineticTime)
const sampledWave = sampleLayerEffectsAtTime({
  layers: kineticResolved.layers,
  runtimeFollows: kineticResolved.runtimeFollows,
  layerId: waveLayer!.id,
  timeSec: kineticTime,
})
assert.ok(sampledWave && 'reveal_events' in sampledWave)
const waveOrigin = sampledWave.reveal_events[0]?.origin
assert.ok(waveOrigin)
assert.equal(waveOrigin.x_pct, orbPoint.x_pct)
assert.equal(waveOrigin.y_pct, orbPoint.y_pct)

// unresolved binding -> warning, no random default
const unresolved = resolveEffectLayerBindings({
  sceneId: 'seg_bad',
  layers: [
    {
      id: 'effect_seg_bad:atom_ring',
      layerKind: 'motion_driver',
      plugin_id: 'portal_ring_overlay',
      preset: 'primitive_ring_overlay',
      effects: {
        preset: 'primitive_ring_overlay',
        ring: DEFAULT_PRIMITIVE_RING_OVERLAY_EFFECT.ring,
        mask: { $shared: 'missing:key' } as unknown as typeof DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT.mask,
      },
      source: 'scene_recipe',
      is_primary: false,
    } satisfies RenderEffectLayer,
  ],
  sharedParams: {},
})
assert.ok(unresolved.warnings.length >= 1)
assert.equal(unresolved.layers[0]?.effects.preset, 'primitive_ring_overlay')

// legacy kinetic input -> split + render props without kinetic_color_ripple preset
const legacyLayer: RenderEffectLayer = {
  id: 'effect_scene_kinetic',
  layerKind: 'composite',
  plugin_id: 'kinetic_color_ripple',
  preset: 'kinetic_color_ripple',
  effects: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT,
  source: 'scene_recipe',
  is_primary: true,
}

const splitLayers = splitEffectLayers([legacyLayer])
assert.equal(
  splitLayers.every((layer) => layer.preset !== 'kinetic_color_ripple'),
  true,
)

const plan: RenderPlanV1 = {
  version: '1.0',
  task_id: 'fixture_kinetic_legacy_split',
  strategy: 'motion_graphics',
  duration_sec: 3,
  canvas: { width: 1080, height: 1920, fps: 30, ratio: '9:16' },
  assets: [],
  scenes: [
    {
      id: 'scene_kinetic',
      source_anchor_id: 'anchor_kinetic',
      name: 'Kinetic',
      start_sec: 0,
      end_sec: 3,
      role: 'hook',
      intent: {
        marketing_role: 'hook',
        emotion_vibe: 'cinematic',
        purpose: 'legacy kinetic split smoke',
      },
      visual: {
        mode: 'solid_bg',
        fit: 'cover',
        visual_prompt: 'kinetic legacy split',
      },
      effect_layers: splitLayers,
      overlays: [],
      audio: [],
    },
  ],
}

const remotionProps = buildRemotionRenderProps(plan)
const sceneLayers = remotionProps.scenes[0]?.effectLayers ?? []
assert.equal(
  sceneLayers.every((layer) => layer.preset !== 'kinetic_color_ripple'),
  true,
)
assert.ok(sceneLayers.some((layer) => layer.preset === 'primitive_orb_motion'))
assert.ok(sceneLayers.some((layer) => layer.preset === 'primitive_directional_wave_reveal'))

console.info('[smoke-effect-layer-binding-resolver] ok', {
  portalLayers: portalResolved.layers.length,
  kineticFollows: kineticResolved.runtimeFollows.length,
  legacySplitCount: splitLayers.length,
  remotionLayerPresets: sceneLayers.map((layer) => layer.preset),
})
