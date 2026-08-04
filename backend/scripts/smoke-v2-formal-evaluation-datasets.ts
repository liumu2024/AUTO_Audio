import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'v2-formal-datasets-'))
try {
  const { writeMemoryDecisionSuite } = await import(
    '../src/evaluation-v2/formal-dataset-builder.js'
  )
  const memoryFile = path.join(tempDir, 'memory.v1.json')
  const memory = await writeMemoryDecisionSuite({
    sourceFile: path.resolve('evals/v2-agent/memory-decisions.v1.json'),
    outputFile: memoryFile,
  })
  assert.equal(memory.samples, 60)
  assert.equal(memory.holdoutCases, 4)
  assert.equal(memory.suite.cases.length, 12)
  assert.equal(memory.suite.cases.every((item) => item.turns.length === 5), true)

  const artifact = JSON.parse(
    readFileSync(path.resolve('evals/v2-agent/artifact-requirements.v1.json'), 'utf8'),
  ) as { cases: Array<{ id: string; turns: unknown[] }> }
  assert.equal(artifact.cases.length, 20)
  assert.equal(new Set(artifact.cases.map((item) => item.id)).size, 20)
  assert.equal(artifact.cases.every((item) => item.turns.length > 0), true)
  console.log('V2 formal evaluation dataset smoke passed.')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
