import type { EffectMotifMustMatch } from '../../../../shared/types/effect-roadmap.v1.js'
import {
  expectedTriangleCollageRoadmapFixture,
  triangleCollageDirectorGroundingFixture,
} from './roadmap-agent.fixtures.js'
import { buildRoadmapPluginRegistrySnapshot } from './roadmap-plugin-registry-snapshot.js'
import type {
  AtomPlanArtifact,
  MissingAtomsTodoArtifact,
  SeedAuthoringClient,
  SeedAuthoringInvokeResult,
  SeedAuthoringProposalDraft,
  SeedPluginMapperInput,
} from './seed-plugin-mapper.js'

const triangleSegment = expectedTriangleCollageRoadmapFixture.segments[0]
const triangleAtom = triangleSegment.atoms[0]
const triangleMotif = triangleSegment.motif

export const triangleMissingAtomTodoFixture: MissingAtomsTodoArtifact = {
  schema_version: 'missing_atoms_todo.v1',
  task_id: 'fixture_triangle_collage',
  items: [
    {
      id: 'triangle_panel_layout',
      atom_id: triangleAtom.id,
      description: 'Triangle cell collage layout not in local registry',
      status: 'open',
      plugin_family: 'layout',
      layerKind: 'layout',
      target_layer: 'effect',
      segment_ids: [triangleSegment.segment_id],
      must_match: triangleMotif.must_match,
      can_adapt: triangleMotif.can_adapt,
      loss_risk: triangleMotif.loss_risk ?? [],
      capability_query: triangleAtom.capability_query,
      suggested_contract: {
        target_layer: 'effect',
        segment_ids: [triangleSegment.segment_id],
      },
    },
  ],
}

export const triangleAtomPlanFixture: AtomPlanArtifact = {
  schema_version: 'atom_plan.v1',
  task_id: 'fixture_triangle_collage',
  data: [
    {
      atom_key: triangleAtom.id,
      atom_id: triangleAtom.id,
      preset: null,
      plugin_id: null,
      layer: 'layout',
      capability_query: triangleAtom.capability_query,
      time_range: {
        start_sec: triangleSegment.start_sec ?? 0,
        end_sec: triangleSegment.end_sec ?? 2.8,
        segment_id: triangleSegment.segment_id,
      },
      evidence: {
        evidence_refs: triangleMotif.evidence_refs,
        confidence: triangleMotif.confidence,
      },
      sequence: 1,
    },
  ],
}

export const triangleDirectorGroundingArtifactFixture = {
  schema_version: 'director_grounding.v1',
  task_id: triangleCollageDirectorGroundingFixture.task_id,
  data: triangleCollageDirectorGroundingFixture,
}

export const triangleRegistrySnapshotFixture = buildRoadmapPluginRegistrySnapshot()

export function buildTriangleSeedMapperInput(
  seedClient: SeedAuthoringClient,
): SeedPluginMapperInput {
  return {
    taskId: 'fixture_triangle_collage',
    atomPlan: triangleAtomPlanFixture,
    missingAtomsTodo: triangleMissingAtomTodoFixture,
    directorGrounding: triangleDirectorGroundingArtifactFixture,
    registrySnapshot: triangleRegistrySnapshotFixture,
    seedClient,
  }
}

export function buildTriangleSeedSuccessProposal(): SeedAuthoringProposalDraft {
  return {
    atom_id: triangleAtom.id,
    missing_atom_id: 'triangle_panel_layout',
    plugin_id: 'triangle_collage_layout',
    plugin_family: 'layout',
    target_layer: 'effect',
    must_match: triangleMotif.must_match,
    can_adapt: triangleMotif.can_adapt,
    loss_risk: triangleMotif.loss_risk ?? [],
    fallback: null,
    manifest: {
      id: 'triangle_collage_layout',
      layerKind: 'layout',
      visual_grammar: ['geometry.cell_shape=triangle', 'geometry.panel_count=3'],
    },
    component_summary: 'Draft triangle panel collage layout plugin for Seed authoring.',
  }
}

export function buildTriangleSeedViolationProposal(): SeedAuthoringProposalDraft {
  const violatedMustMatch: EffectMotifMustMatch = {
    'geometry.cell_shape': 'rectangle',
    'geometry.panel_count': 3,
    'geometry.arrangement': 'vertical_triptych',
  }
  return {
    atom_id: triangleAtom.id,
    missing_atom_id: 'triangle_panel_layout',
    plugin_id: 'rectangle_collage_layout',
    plugin_family: 'layout',
    target_layer: 'effect',
    must_match: violatedMustMatch,
    can_adapt: ['duration'],
    fallback: null,
    manifest: {
      id: 'rectangle_collage_layout',
      layerKind: 'layout',
      visual_grammar: ['geometry.cell_shape=rectangle'],
    },
    component_summary: 'Incorrect rectangle-only collage fallback proposal.',
  }
}

export function createMockSeedClient(result: SeedAuthoringInvokeResult): SeedAuthoringClient {
  return {
    invoke: async () => result,
  }
}
