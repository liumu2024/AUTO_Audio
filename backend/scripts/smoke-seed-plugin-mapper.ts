import assert from 'node:assert/strict'

import {
  buildTriangleSeedMapperInput,
  buildTriangleSeedSuccessProposal,
  buildTriangleSeedViolationProposal,
  createMockSeedClient,
  triangleMissingAtomTodoFixture,
} from '../src/modules/effect-roadmap/seed-plugin-mapper.fixtures.js'
import { mapMissingAtomsWithSeed, violatesMustMatch } from '../src/modules/effect-roadmap/seed-plugin-mapper.js'

function assertDecisionFields(
  decision: {
    atom_id: string
    target_layer: string
    plugin_family: string
    must_match: Record<string, unknown>
    can_adapt: string[]
    fallback: unknown
    loss_risk: unknown[]
  },
): void {
  assert.ok(decision.atom_id.trim().length > 0)
  assert.ok(['effect', 'overlay'].includes(decision.target_layer))
  assert.ok(decision.plugin_family.trim().length > 0)
  assert.ok(typeof decision.must_match === 'object')
  assert.ok(Array.isArray(decision.can_adapt))
  assert.ok(Array.isArray(decision.loss_risk))
}

// mock Seed success: missing triangle layout -> generate_plugin proposal
const successResult = await mapMissingAtomsWithSeed(
  buildTriangleSeedMapperInput(
    createMockSeedClient({
      available: true,
      raw_response: JSON.stringify({
        status: 'ok',
        proposals: [buildTriangleSeedSuccessProposal()],
      }),
      proposals: [buildTriangleSeedSuccessProposal()],
    }),
  ),
)

assert.equal(successResult.seedPluginAuthoringRequest.invoked, true)
assert.ok(successResult.seedPluginAuthoringRequest.data?.authoring_items.length === 1)
assert.ok(successResult.seedPluginAuthoringRawResponse.includes('ok'))

const successDecision = successResult.mappingDecisionsSeed.decisions[0]
assert.ok(successDecision)
assert.equal(successDecision.decision, 'generate_plugin')
assert.equal(successDecision.atom_id, 'atom_layout_collage')
assert.equal(successDecision.plugin_family, 'layout')
assert.equal(successDecision.must_match['geometry.cell_shape'], 'triangle')
assert.equal(successDecision.fallback, null)
assertDecisionFields(successDecision)
assert.ok(successResult.seedGeneratedPlugins.data?.proposals[0]?.plugin_id === 'triangle_collage_layout')
assert.equal(successResult.mappingDecisionsSeed.remaining_missing_atoms[0]?.status, 'seed_pending')

// mock Seed unavailable: missing atom still preserved as open
const unavailableResult = await mapMissingAtomsWithSeed(
  buildTriangleSeedMapperInput(
    createMockSeedClient({
      available: false,
      raw_response: 'Seed authoring endpoint unreachable (503)\n',
      proposals: [],
      unavailable_reason: 'Seed authoring service unavailable',
    }),
  ),
)

const unavailableDecision = unavailableResult.mappingDecisionsSeed.decisions[0]
assert.equal(unavailableDecision.decision, 'unavailable')
assert.equal(unavailableDecision.fallback, null)
assertDecisionFields(unavailableDecision)
assert.equal(
  unavailableResult.mappingDecisionsSeed.remaining_missing_atoms[0]?.status,
  'open',
)
assert.equal(
  unavailableResult.mappingDecisionsSeed.remaining_missing_atoms[0]?.id,
  triangleMissingAtomTodoFixture.items?.[0]?.id,
)
assert.equal(unavailableResult.seedGeneratedPlugins.data?.proposals.length ?? 0, 0)

// mock Seed violates must_match: decision=rejected
const rejectedResult = await mapMissingAtomsWithSeed(
  buildTriangleSeedMapperInput(
    createMockSeedClient({
      available: true,
      raw_response: JSON.stringify({
        status: 'ok',
        proposals: [buildTriangleSeedViolationProposal()],
      }),
      proposals: [buildTriangleSeedViolationProposal()],
    }),
  ),
)

const rejectedDecision = rejectedResult.mappingDecisionsSeed.decisions[0]
assert.equal(rejectedDecision.decision, 'rejected')
assert.equal(rejectedDecision.fallback, null)
assert.ok(rejectedDecision.rejection_reason?.includes('geometry.cell_shape'))
assertDecisionFields(rejectedDecision)
assert.equal(rejectedResult.seedGeneratedPlugins.data?.proposals[0]?.status, 'rejected')
assert.equal(rejectedResult.mappingDecisionsSeed.remaining_missing_atoms[0]?.status, 'open')

assert.equal(violatesMustMatch({}, {}), null)
assert.equal(violatesMustMatch({}, undefined), null)

console.info('[smoke-seed-plugin-mapper] ok', {
  cases: ['generate_plugin', 'unavailable', 'rejected', 'empty_must_match_ok'],
})
