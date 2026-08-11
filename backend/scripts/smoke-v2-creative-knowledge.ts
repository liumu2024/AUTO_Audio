import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-creative-knowledge-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = dataDir

try {
  const {
    createCreativeKnowledgeCandidatesFromSample,
    listCreativeKnowledge,
    searchCreativeKnowledge,
    updateCreativeKnowledge,
  } = await import('../src/modules/creative-knowledge/creative-knowledge.service.js')

  const sample = {
    schema_version: 'v2_sample_understanding.v2' as const,
    task_id: 'sample_task_1',
    source: 'llm' as const,
    sample: { name: 'reference.mp4', duration_sec: 12 },
    summary: 'A restrained product reveal.',
    content_observations: [],
    method_observations: [{
      id: 'method_reveal',
      expression: 'Reveal the subject after a quiet establishing shot',
      purpose: 'Build anticipation before the key information',
      timing_rationale: 'The reveal lands on the first strong beat',
      evidence_ranges: [{ start_sec: 0, end_sec: 4 }],
    }],
    transferable_knowledge: [{
      statement: 'Use a restrained establishing shot before the main reveal',
      applicability: 'Product and character introduction videos',
      evidence_method_ids: ['method_reveal'],
    }],
    shot_evidence: [],
    questions: [],
    warnings: [],
  }

  const first = await createCreativeKnowledgeCandidatesFromSample({ userId: 1, understanding: sample })
  const replay = await createCreativeKnowledgeCandidatesFromSample({ userId: 1, understanding: sample })
  assert.equal(first.length, 1)
  assert.equal(replay[0]?.id, first[0]?.id, 'same sample knowledge must converge to one entity')
  assert.equal(first[0]?.status, 'candidate')
  assert.deepEqual(first[0]?.sources[0]?.methodIds, ['method_reveal'])
  assert.deepEqual(first[0]?.sources[0]?.evidenceRanges, [{ start_sec: 0, end_sec: 4 }])

  const beforeReview = await searchCreativeKnowledge({ query: 'Use a restrained establishing shot before the main reveal' })
  assert.equal(beforeReview.items.length, 0, 'candidate knowledge must not enter planning retrieval')

  await updateCreativeKnowledge({ id: first[0]!.id, status: 'active' })
  const relevant = await searchCreativeKnowledge({ query: 'Use a restrained establishing shot before the main reveal' })
  assert.equal(relevant.items[0]?.knowledge.id, first[0]?.id)
  assert.equal(relevant.items[0]?.rank, 1)

  const unrelated = await searchCreativeKnowledge({ query: 'bright sports montage' })
  assert.equal(unrelated.items.length, 0, 'retrieval must not randomly fill Top-K')

  const records = await listCreativeKnowledge({ status: 'active' })
  assert.equal(records.length, 1)
  assert.equal(records[0]?.applicability, 'Product and character introduction videos')

  const second = await createCreativeKnowledgeCandidatesFromSample({
    userId: 1,
    understanding: {
      ...sample,
      task_id: 'sample_task_2',
      transferable_knowledge: [{
        statement: 'Contrast a wide establishing shot with a close detail',
        applicability: 'Product reveals',
        evidence_method_ids: ['method_reveal'],
      }],
    },
  })
  await assert.rejects(
    () => updateCreativeKnowledge({
      id: second[0]!.id,
      statement: first[0]!.statement,
    }),
    /semantic identity already exists/i,
    'local JSON must enforce the same semantic uniqueness as PostgreSQL on update',
  )

  const concurrentKnowledgeStatement = 'Use a visual pause before revealing the decisive detail'
  const concurrentKnowledge = await Promise.all([
    createCreativeKnowledgeCandidatesFromSample({
      userId: 1,
      understanding: {
        ...sample,
        task_id: 'sample_concurrent_a',
        transferable_knowledge: [{
          statement: concurrentKnowledgeStatement,
          applicability: 'Narrative reveals',
          evidence_method_ids: ['method_reveal'],
        }],
      },
    }),
    createCreativeKnowledgeCandidatesFromSample({
      userId: 2,
      understanding: {
        ...sample,
        task_id: 'sample_concurrent_b',
        transferable_knowledge: [{
          statement: concurrentKnowledgeStatement,
          applicability: 'Narrative reveals',
          evidence_method_ids: ['method_reveal'],
        }],
      },
    }),
  ])
  assert.equal(concurrentKnowledge[0]?.[0]?.id, concurrentKnowledge[1]?.[0]?.id)
  assert.deepEqual(
    (await listCreativeKnowledge()).find((item) => item.id === concurrentKnowledge[0]?.[0]?.id)
      ?.sources.map((source) => source.taskId).sort(),
    ['sample_concurrent_a', 'sample_concurrent_b'],
    'concurrent candidate creation must preserve every source',
  )

  console.log('V2 creative knowledge smoke passed.')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
