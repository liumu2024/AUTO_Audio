import assert from 'node:assert/strict'

import {
  invalidBindingTargetFixture,
  invalidForbiddenPluginFieldFixture,
  invalidMissingAtomIdFixture,
  invalidMissingLayerKindFixture,
  validColorPortalUnlockRoadmapFixture,
  validKineticOrbRevealRoadmapFixture,
  validLayoutCollageRoadmapFixture,
} from '../../shared/lib/effect-roadmap.fixtures.js'
import {
  assertValidEffectRoadmap,
  validateEffectRoadmap,
} from '../../shared/lib/effect-roadmap.validator.js'

function expectInvalid(input: unknown, code: string): void {
  const result = validateEffectRoadmap(input)
  assert.equal(result.ok, false, `expected validation failure for ${code}`)
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected error code ${code}, got ${result.errors.map((item) => item.code).join(', ')}`,
  )
}

assertValidEffectRoadmap(validKineticOrbRevealRoadmapFixture)
assertValidEffectRoadmap(validColorPortalUnlockRoadmapFixture)
assertValidEffectRoadmap(validLayoutCollageRoadmapFixture)

expectInvalid(invalidMissingAtomIdFixture, 'missing_atom_id')
expectInvalid(invalidMissingLayerKindFixture, 'missing_layer_kind')
expectInvalid(invalidBindingTargetFixture, 'unknown_binding_atom')
expectInvalid(invalidForbiddenPluginFieldFixture, 'forbidden_field')

const kinetic = validKineticOrbRevealRoadmapFixture.segments[0]
assert.equal(kinetic.motif.family, 'kinetic_orb_reveal')
assert.deepEqual(kinetic.motif.can_adapt, ['duration', 'asset_crop', 'color_grade'])
assert.equal(kinetic.atoms.find((atom) => atom.id === 'atom_orb')?.layerKind, 'motion_driver')
assert.equal(kinetic.bindings[1]?.source, 'orb.path_keyframes')
assert.equal(kinetic.bindings[1]?.target, 'ring.center_path')

console.info('[smoke-effect-roadmap-schema] ok', {
  validFixtures: 3,
  invalidCases: 4,
})
