import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createV2TraceWriter } from '../src/pipeline-v2/trace.js'

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'v2-trace-session-'))

try {
  const first = createV2TraceWriter({
    taskId: 'director_turn_1',
    baseDir: temporaryRoot,
    sessionId: 'workspace_123',
    operationId: 'turn_0001',
  })
  await first.appendSessionEvent({
    type: 'turn',
    prompt: 'Explain the current plan.',
    assistantMessage: 'Here is the current plan.',
  })

  const second = createV2TraceWriter({
    taskId: 'timeline_patch_2',
    baseDir: temporaryRoot,
    sessionId: 'workspace_123',
    operationId: 'timeline_patch_call_2',
  })
  await second.appendSessionEvent({
    type: 'tool',
    toolId: 'timeline.patch',
    ok: true,
  })

  assert.equal(first.sessionRootDir, second.sessionRootDir)
  assert.match(first.rootDir, /sessions[\\/]workspace_123[\\/]operations[\\/]turn_0001$/)
  assert.match(second.rootDir, /sessions[\\/]workspace_123[\\/]operations[\\/]timeline_patch_call_2$/)

  const lines = (await readFile(path.join(first.sessionRootDir!, 'events.jsonl'), 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  assert.equal(lines.length, 2)
  assert.equal(lines[0]?.type, 'turn')
  assert.equal(lines[1]?.toolId, 'timeline.patch')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.info('[smoke-v2-trace-session] OK')
