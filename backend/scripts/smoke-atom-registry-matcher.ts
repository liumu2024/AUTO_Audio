import assert from 'node:assert/strict'

import { validColorPortalUnlockRoadmapFixture, validKineticOrbRevealRoadmapFixture } from '../../shared/lib/effect-roadmap.fixtures.js'
import { matchAtomsToRegistry } from '../src/modules/effect-roadmap/atom-registry-matcher.js'
import { expectedTriangleCollageRoadmapFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import { RENDER_PLUGIN_MANIFESTS } from '../../shared/lib/render-plugin-manifest.js'

const portalResult = matchAtomsToRegistry({
  taskId: 'fixture_portal_ring',
  effectRoadmap: validColorPortalUnlockRoadmapFixture,
})

assert.equal(portalResult.atomPlan.source, 'effect_roadmap')
assert.equal(portalResult.atomPlan.atom_count, 3)
assert.equal(portalResult.missingAtomsTodo.items.length, 0)
assert.equal(
  portalResult.localMappingDecisions.every((decision) => decision.decision !== 'missing'),
  true,
)

const maskDecision = portalResult.localMappingDecisions.find(
  (decision) => decision.atom_id === 'atom_mask',
)
assert.equal(maskDecision?.plugin_id, 'circle_mask_reveal')

const triangleResult = matchAtomsToRegistry({
  taskId: 'fixture_triangle_collage',
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
})

const layoutDecision = triangleResult.localMappingDecisions.find(
  (decision) => decision.atom_id === 'atom_layout_collage',
)
assert.equal(triangleResult.missingAtomsTodo.items.length, 0)
assert.equal(layoutDecision?.decision, 'reuse')
assert.equal(layoutDecision?.fallback, null)
assert.equal(layoutDecision?.plugin_id, 'radial_triangle_prism_collage')

const looseRequiredRoadmap = structuredClone(expectedTriangleCollageRoadmapFixture) as typeof expectedTriangleCollageRoadmapFixture
looseRequiredRoadmap.segments[0]!.atoms[0]!.required_params = 'panels, geometry.cell_shape' as unknown as string[]
const looseRequiredResult = matchAtomsToRegistry({
  taskId: 'fixture_triangle_loose_required_params',
  effectRoadmap: looseRequiredRoadmap,
})
const looseLayoutDecision = looseRequiredResult.localMappingDecisions.find(
  (decision) => decision.atom_id === 'atom_layout_collage',
)
assert.equal(looseLayoutDecision?.plugin_id, 'radial_triangle_prism_collage')

const kineticResult = matchAtomsToRegistry({
  taskId: 'fixture_kinetic_orb_reveal',
  effectRoadmap: validKineticOrbRevealRoadmapFixture,
})

assert.equal(
  kineticResult.localMappingDecisions.every((decision) => decision.decision !== 'missing'),
  true,
)

const splitCollage = RENDER_PLUGIN_MANIFESTS.find((plugin) => plugin.id === 'split_collage_layout')
assert.ok(splitCollage)
const negativeBlocked = matchAtomsToRegistry({
  taskId: 'fixture_triangle_negative_only',
  effectRoadmap: expectedTriangleCollageRoadmapFixture,
  manifests: [splitCollage!],
})
assert.equal(negativeBlocked.localMappingDecisions[0]?.decision, 'missing')

console.info('[smoke-atom-registry-matcher] ok', {
  portalMatches: portalResult.localMappingDecisions.length,
  trianglePlugin: layoutDecision?.plugin_id,
  kineticMatches: kineticResult.localMappingDecisions.length,
})
