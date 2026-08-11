import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineSpecV1,
} from '../../shared/types/remotion-timeline-spec.v1.js'
import { renderV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-renderer.js'

const taskId = `v2_timeline_render_${Date.now()}`
const outputDir = mkdtempSync(path.join(os.tmpdir(), 'v2-remotion-presets-'))
const cleanup = () => rmSync(outputDir, { recursive: true, force: true })
process.once('exit', cleanup)
const localImagePath = path.join(outputDir, 'local-fixture.svg')
writeFileSync(localImagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="100%" height="100%" fill="#172554"/></svg>')
const webpackCacheDir = path.resolve('..', 'remotion', 'node_modules', '.cache', 'webpack')
const webpackCacheFingerprint = () => existsSync(webpackCacheDir)
  ? readdirSync(webpackCacheDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name)
        const stat = statSync(file)
        return `${file}:${stat.size}:${stat.mtimeMs}`
      })
      .sort()
  : []
const webpackCacheBefore = webpackCacheFingerprint()

function stagedAssetSource(propsPath: string) {
  const props = JSON.parse(readFileSync(propsPath, 'utf8')) as RemotionTimelineSpecV1
  const src = props.assets.find((asset) => asset.id === 'local_fixture')?.src
  assert.ok(src?.startsWith('static:'), `Expected a staged static asset in ${propsPath}`)
  return src
}

function stagedAssetDir(propsPath: string) {
  const relativeDir = path.dirname(stagedAssetSource(propsPath).slice('static:'.length))
  return path.resolve('..', 'remotion', 'public', ...relativeDir.split('/'))
}

const sceneDurationSec = 0.5
const spec: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1',
  task_id: taskId,
  canvas: {
    width: 360,
    height: 640,
    fps: 12,
    duration_sec: sceneDurationSec * (REMOTION_TIMELINE_TRANSITION_TYPES.length + 1),
  },
  assets: [{ id: 'local_fixture', type: 'image', src: localImagePath, source: 'local_fixture' }],
  scenes: Array.from({ length: REMOTION_TIMELINE_TRANSITION_TYPES.length + 1 }, (_, index) => ({
    id: `scene_${index + 1}`,
    type: index === 0 ? 'image_motion' : 'remotion_card',
    asset_id: index === 0 ? 'local_fixture' : undefined,
    start_sec: index * sceneDurationSec,
    duration_sec: sceneDurationSec,
    title: `Preset ${index + 1}`,
    background: index % 2 === 0 ? '#172554' : '#7f1d1d',
  })),
  transitions: REMOTION_TIMELINE_TRANSITION_TYPES.map((type, index) => ({
    id: `transition_${index + 1}`,
    from_scene_id: `scene_${index + 1}`,
    to_scene_id: `scene_${index + 2}`,
    type,
    duration_sec: type === 'cut' ? 0 : 0.2,
  })),
  overlays: [],
  material_jobs: [],
  audio: [],
  render_policy: { renderer: 'remotion_timeline' },
}

const validation = validateRemotionTimelineSpec(spec)
assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2))

const result = await renderV2RemotionTimeline({
  spec,
  outputDir,
  outputName: `${taskId}.mp4`,
})

assert.equal(existsSync(result.outputPath), true)
assert.ok(result.fileSizeBytes > 10_000, `Unexpectedly small render: ${result.fileSizeBytes}`)
assert.equal(
  existsSync(stagedAssetDir(result.propsPath)),
  false,
  'a completed render must remove its staged public assets',
)
if (!process.env.REMOTION_BROWSER_EXECUTABLE) {
  assert.equal(
    result.command.includes('--browser-executable'),
    false,
    'the default render path must let Remotion choose its compatible browser',
  )
} else {
  const browserFlag = result.command.indexOf('--browser-executable')
  assert.equal(result.command[browserFlag + 1], process.env.REMOTION_BROWSER_EXECUTABLE)
}

const failedTaskId = `${taskId}_browser_failure`
const failedOutputDir = path.join(outputDir, 'browser-failure')
const previousBrowserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE
process.env.REMOTION_BROWSER_EXECUTABLE = path.join(outputDir, 'missing-browser.exe')
try {
  await assert.rejects(renderV2RemotionTimeline({
    spec: { ...spec, task_id: failedTaskId },
    outputDir: failedOutputDir,
  }))
} finally {
  if (previousBrowserExecutable === undefined) delete process.env.REMOTION_BROWSER_EXECUTABLE
  else process.env.REMOTION_BROWSER_EXECUTABLE = previousBrowserExecutable
}
assert.equal(
  existsSync(path.join(failedOutputDir, '.remotion-timeline-bundle')),
  false,
  'a failed render must remove its task-local bundle',
)
assert.equal(
  existsSync(stagedAssetDir(path.join(failedOutputDir, 'remotion-timeline-props.json'))),
  false,
  'a failed render must remove its staged public assets',
)
assert.deepEqual(
  webpackCacheFingerprint(),
  webpackCacheBefore,
  'one-shot server renders must not grow the shared Webpack disk cache',
)

const sameTaskRenders = await Promise.all([
  renderV2RemotionTimeline({ spec, outputDir: path.join(outputDir, 'same-task-a') }),
  renderV2RemotionTimeline({ spec, outputDir: path.join(outputDir, 'same-task-b') }),
])
const stagedSources = sameTaskRenders.map((render) => stagedAssetSource(render.propsPath))
assert.notEqual(
  stagedSources[0],
  stagedSources[1],
  'parallel renders of the same task must use isolated staged asset directories',
)
assert.equal(
  sameTaskRenders.every((render) => !existsSync(stagedAssetDir(render.propsPath))),
  true,
  'parallel renders must remove their isolated staged asset directories',
)

console.info('[smoke-v2-remotion-timeline-render] OK')
console.info(JSON.stringify({
  taskId,
  outputPath: result.outputPath,
  propsPath: result.propsPath,
  fileSizeBytes: result.fileSizeBytes,
}, null, 2))
cleanup()
