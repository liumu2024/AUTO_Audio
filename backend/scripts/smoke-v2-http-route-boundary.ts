import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const backendRoot = resolve(import.meta.dirname, '..')
const port = 43_000 + Math.floor(Math.random() * 1_000)
const dataDir = await mkdtemp(resolve(tmpdir(), 'dpl304-v2-http-'))
const tsxCli = resolve(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const server = spawn(process.execPath, [tsxCli, 'src/app.ts'], {
  cwd: backendRoot,
  env: {
    ...process.env,
    PORT: String(port),
    DPL304_LOCAL_MODE: 'true',
    DPL304_LOCAL_DATA_DIR: dataDir,
  },
  stdio: 'ignore',
})

assert.doesNotMatch(
  readFileSync(resolve(backendRoot, 'src/app.ts'), 'utf8'),
  /director\/workspaces\/:workspaceSessionId\/outcomes/,
  'workspace mutations must only pass through the serialized Director turn boundary',
)

async function waitForHealthyServer(): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('Timed out waiting for the backend HTTP server.')
}

async function expectStatus(path: string, status: number, init?: RequestInit): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  assert.equal(response.status, status, `${init?.method ?? 'GET'} ${path}`)
}

try {
  await waitForHealthyServer()

  await expectStatus('/api/v2/timeline-drafts', 200)
  await expectStatus('/api/v2/sample/analyze', 400, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

  await expectStatus('/api/tasks', 404)
  await expectStatus('/api/tasks/latest', 404)
  await expectStatus('/api/tasks/legacy', 404)
  await expectStatus('/api/tasks/legacy/pipeline', 404)
  await expectStatus('/api/tasks/legacy/render-plan', 404)
  await expectStatus('/api/tasks/legacy/structure', 404, { method: 'PATCH' })
  await expectStatus('/api/tasks/legacy/cancel', 404, { method: 'POST' })
  await expectStatus('/api/tasks/legacy', 404, { method: 'DELETE' })
  await expectStatus('/renders/legacy.mp4', 404)
} finally {
  server.kill()
}

console.info('[smoke-v2-http-route-boundary] OK')
