import assert from 'node:assert/strict'

import { expectedPortalRingRoadmapFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import { portalRingDirectorGroundingFixture } from '../src/modules/effect-roadmap/roadmap-agent.fixtures.js'
import {
  runRoadmapAgent,
  type RoadmapAgentLlmClient,
} from '../src/modules/effect-roadmap/roadmap-agent.service.js'

const mockClient: RoadmapAgentLlmClient = {
  complete: async () => ({
    raw: JSON.stringify(expectedPortalRingRoadmapFixture),
    body: expectedPortalRingRoadmapFixture,
  }),
}

const okResult = await runRoadmapAgent(
  {
    taskId: expectedPortalRingRoadmapFixture.task_id,
    directorGrounding: portalRingDirectorGroundingFixture,
  },
  mockClient,
)

assert.equal(okResult.status, 'ok')
assert.equal(okResult.roadmap?.segments.length, 1)
assert.equal(okResult.repairRounds, 0)

const repairClient: RoadmapAgentLlmClient = {
  complete: async (prompt) => {
    if (prompt.includes('EffectRoadmapRepairAgent')) {
      return {
        raw: JSON.stringify(expectedPortalRingRoadmapFixture),
        body: expectedPortalRingRoadmapFixture,
      }
    }
    return {
      raw: '{"schema_version":"effect_roadmap.v1","task_id":"fixture_portal_ring","segments":[]}',
      body: {
        schema_version: 'effect_roadmap.v1',
        task_id: 'fixture_portal_ring',
        segments: [
          {
            segment_id: 'seg_001',
            motif: { id: 'bad', family: 'x', evidence_refs: [], confidence: 0.5, must_match: {}, can_adapt: [], atom_ids: [] },
            atoms: [{ layerKind: 'layout', capability_query: 'missing id' }],
            bindings: [],
          },
        ],
      },
    }
  },
}

const repaired = await runRoadmapAgent(
  {
    taskId: expectedPortalRingRoadmapFixture.task_id,
    directorGrounding: portalRingDirectorGroundingFixture,
  },
  repairClient,
)

assert.equal(repaired.status, 'ok')
assert.equal(repaired.repairRounds, 1)

const malformedJsonClient: RoadmapAgentLlmClient = {
  complete: async (prompt) => {
    if (prompt.includes('EffectRoadmapRepairAgent')) {
      return {
        raw: JSON.stringify(expectedPortalRingRoadmapFixture),
        body: expectedPortalRingRoadmapFixture,
      }
    }
    return {
      raw: '{"schema_version":"effect_roadmap.v1","task_id":"fixture_portal_ring","segments":[',
      body: '{"schema_version":"effect_roadmap.v1","task_id":"fixture_portal_ring","segments":[',
    }
  },
}

const jsonRepaired = await runRoadmapAgent(
  {
    taskId: expectedPortalRingRoadmapFixture.task_id,
    directorGrounding: portalRingDirectorGroundingFixture,
  },
  malformedJsonClient,
)

assert.equal(jsonRepaired.status, 'ok')
assert.equal(jsonRepaired.repairRounds, 1)
assert.ok(jsonRepaired.initialRawResponse.includes('"segments":['))
assert.ok(jsonRepaired.repairRawResponse.includes('"segments"'))

console.info('[smoke-roadmap-agent-service] ok', {
  segments: okResult.roadmap?.segments.length,
  repairRounds: repaired.repairRounds,
})
