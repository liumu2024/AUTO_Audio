import assert from 'node:assert/strict'

import { validateEffectRoadmap } from '../../shared/lib/effect-roadmap.validator.js'
import {
  expectedOrbRippleRoadmapFixture,
  expectedPortalRingRoadmapFixture,
  expectedTriangleCollageRoadmapFixture,
  orbRippleDirectorGroundingFixture,
  portalRingDirectorGroundingFixture,
  portalRingSampleHintsFixture,
  triangleCollageDirectorGroundingFixture,
} from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import { buildRoadmapAgentPrompt } from '../src/modules/effect-roadmap/roadmap-agent-prompt.js'
import { buildRoadmapPluginRegistrySnapshot } from '../src/modules/effect-roadmap/roadmap-plugin-registry-snapshot.js'

function assertPromptPolicy(prompt: string): void {
  assert.ok(prompt.includes('Effect Roadmap Agent'), 'includes agent title')
  assert.ok(prompt.includes('禁止'), 'includes prohibition policy')
  assert.ok(prompt.includes('不要输出 preset') || prompt.includes('禁止'), 'mentions preset restriction')
  assert.ok(prompt.includes('loss_risk'), 'mentions loss_risk policy')
  assert.ok(prompt.includes('geometry.cell_shape'), 'mentions cell_shape fidelity')
  assert.ok(prompt.includes('三角形') || prompt.includes('triangle'), 'mentions triangle fidelity')
  assert.ok(prompt.includes('director_grounding='), 'embeds director grounding')
  assert.ok(prompt.includes('local_plugin_registry_snapshot='), 'embeds registry snapshot')
  assert.ok(!prompt.includes('\\u'), 'no unicode escape artifacts')
}

function assertExpectedRoadmap(
  roadmap: typeof expectedPortalRingRoadmapFixture,
  input: {
    family: string
    atomIds: string[]
    layerKinds: string[]
    mustMatchKey?: string
    mustMatchValue?: string | number
  },
): void {
  const result = validateEffectRoadmap(roadmap)
  assert.equal(result.ok, true, result.errors.map((item) => item.message).join('; '))

  const segment = roadmap.segments[0]
  assert.equal(segment.motif.family, input.family)
  assert.deepEqual(segment.motif.atom_ids, input.atomIds)
  assert.equal(segment.motif.evidence_refs.length > 0, true)
  assert.ok(segment.motif.confidence >= 0 && segment.motif.confidence <= 1)
  assert.ok(Array.isArray(segment.motif.can_adapt))

  const layerKinds = segment.atoms.map((atom) => atom.layerKind)
  assert.deepEqual(layerKinds, input.layerKinds)

  for (const atom of segment.atoms) {
    assert.ok(atom.capability_query.trim().length > 0)
    assert.equal('preset' in atom, false)
    assert.equal('plugin_id' in atom, false)
  }

  if (input.mustMatchKey) {
    assert.equal(segment.motif.must_match[input.mustMatchKey], input.mustMatchValue)
  }
}

const registry = buildRoadmapPluginRegistrySnapshot()

const portalPrompt = buildRoadmapAgentPrompt({
  taskId: portalRingDirectorGroundingFixture.task_id,
  directorGrounding: portalRingDirectorGroundingFixture,
  sampleHints: portalRingSampleHintsFixture,
  pluginRegistrySnapshot: registry,
})
assertPromptPolicy(portalPrompt)
assert.ok(portalPrompt.includes('phen_portal_001'))
assert.ok(portalPrompt.includes('grayscale_portal_color_unlock'))
assert.ok(portalPrompt.includes('color_portal_unlock'))

assertExpectedRoadmap(expectedPortalRingRoadmapFixture, {
  family: 'color_portal_unlock',
  atomIds: ['atom_color_transform', 'atom_mask_reveal', 'atom_ring_overlay'],
  layerKinds: ['color_transform', 'mask_reveal', 'motion_driver'],
  mustMatchKey: 'geometry.mask_shape',
  mustMatchValue: 'circle',
})

const orbPrompt = buildRoadmapAgentPrompt({
  taskId: orbRippleDirectorGroundingFixture.task_id,
  directorGrounding: orbRippleDirectorGroundingFixture,
  pluginRegistrySnapshot: registry,
})
assertPromptPolicy(orbPrompt)
assert.ok(orbPrompt.includes('phen_orb_001'))
assert.ok(orbPrompt.includes('kinetic_orb_reveal'))

assertExpectedRoadmap(expectedOrbRippleRoadmapFixture, {
  family: 'kinetic_orb_reveal',
  atomIds: ['atom_color_transform', 'atom_wave_reveal', 'atom_orb_motion', 'atom_orb_ring'],
  layerKinds: ['color_transform', 'mask_reveal', 'motion_driver', 'motion_driver'],
})

const trianglePrompt = buildRoadmapAgentPrompt({
  taskId: triangleCollageDirectorGroundingFixture.task_id,
  directorGrounding: triangleCollageDirectorGroundingFixture,
  pluginRegistrySnapshot: registry,
})
assertPromptPolicy(trianglePrompt)
assert.ok(trianglePrompt.includes('phen_tri_001'))
assert.ok(trianglePrompt.includes('triangle_panel_collage'))
assert.ok(trianglePrompt.includes('triangle'))

assertExpectedRoadmap(expectedTriangleCollageRoadmapFixture, {
  family: 'layout_collage',
  atomIds: ['atom_layout_collage'],
  layerKinds: ['layout'],
  mustMatchKey: 'geometry.cell_shape',
  mustMatchValue: 'triangle',
})

const triangleMotif = expectedTriangleCollageRoadmapFixture.segments[0].motif
assert.ok(triangleMotif.loss_risk?.length)
assert.equal(triangleMotif.loss_risk?.[0]?.requested_grammar, 'geometry.cell_shape=triangle')
assert.ok(expectedTriangleCollageRoadmapFixture.loss_ledger?.length)

console.info('[smoke-roadmap-agent-prompt] ok', {
  promptLengths: {
    portal: portalPrompt.length,
    orb: orbPrompt.length,
    triangle: trianglePrompt.length,
  },
})
