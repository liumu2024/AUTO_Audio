import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const remotionRoot = resolve(repoRoot, 'remotion')
const remotionCli = resolve(
  remotionRoot,
  'node_modules',
  '@remotion',
  'cli',
  'remotion-cli.js',
)
const result = spawnSync(process.execPath, [remotionCli, 'compositions', 'src/index.ts'], {
  cwd: remotionRoot,
  encoding: 'utf8',
  windowsHide: true,
})
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

assert.equal(result.status, 0, output)
assert.match(output, /V2TimelineVideo/)
assert.doesNotMatch(output, /Dpl304Video/)

console.info('[smoke-v2-remotion-root-composition] OK')
