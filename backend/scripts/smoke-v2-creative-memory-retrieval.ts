import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-memory-retrieval-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = dataDir

try {
  const { evaluateCreativeMemoryRetrieval } = await import(
    '../src/evaluation-v2/creative-memory-retrieval-evaluation.js'
  )
  const { prisma } = await import('../src/shared/prisma.service.js')
  const fixtureMemoryCount = async () =>
    (await prisma.creativeMemory.findMany({ where: { userId: 901 } })).length
  const report = await evaluateCreativeMemoryRetrieval({
    suiteFile: path.resolve('evaluation/datasets/source/memory-retrieval.v1.json'),
  })
  const countAfterFirstRun = await fixtureMemoryCount()
  const repeated = await evaluateCreativeMemoryRetrieval({
    suiteFile: path.resolve('evaluation/datasets/source/memory-retrieval.v1.json'),
  })
  assert.equal(await fixtureMemoryCount(), countAfterFirstRun)
  assert.equal(report.activeMemoryRecallAt8, 1)
  assert.equal((report.activeMemoryNdcgAt8 ?? 0) >= 0.9, true)
  assert.equal(report.candidatePrecisionAt3, 1)
  assert.equal(report.crossScopeRetrievalCount, 0)
  assert.equal(report.forbiddenRetrievalCount, 0)
  const stableResults = (value: typeof report.queryResults) => value.map((item) => ({
    id: item.id,
    activeKeys: item.activeKeys,
    candidateKeys: item.candidateKeys,
  }))
  assert.deepEqual(stableResults(repeated.queryResults), stableResults(report.queryResults))
  console.log('V2 creative memory retrieval smoke passed.')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
