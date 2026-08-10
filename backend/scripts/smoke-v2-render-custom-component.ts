import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-custom-render-'))
process.env.RENDER_COMPONENTS_DIR = path.join(dataDir, 'components')

try {
  const {
    promoteRenderComponent,
    registerRenderComponent,
    RENDER_COMPONENT_VISUAL_POLICY_VERSION,
  } = await import('../src/modules/render-components/component-registry.js')
  const { renderV2RemotionTimeline } = await import('../src/pipeline-v2/remotion-timeline-renderer.js')
  const { readRenderComponent } = await import('../src/modules/render-components/component-registry.js')
  const type = await import('../../shared/types/remotion-timeline-spec.v1.js')

  const sceneComponent = `
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'

export default function BlurRise(props) {
  const frame = useCurrentFrame()
  const blur = interpolate(frame, [0, 12], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        background: '#09090b',
        color: '#f8fafc',
        display: 'flex',
        filter: \`blur(\${blur}px)\`,
        fontSize: 40,
        justifyContent: 'center',
      }}
    >
      {props.params?.text ?? ''}
    </AbsoluteFill>
  )
}
`
  const transitionComponent = `
export default function BlurDissolve({ children, progress, direction }) {
  const blur = direction === 'exiting' ? 18 * (progress ?? 0) : 0
  const opacity = direction === 'exiting' ? 1 - (progress ?? 0) : 1
  return (
    <div style={{ filter: \`blur(\${blur}px)\`, height: '100%', opacity, width: '100%' }}>
      {children}
    </div>
  )
}
`
  await registerRenderComponent({ id: 'cmp_blur_rise', source: sceneComponent, displayName: '模糊升起', effectSummary: 'blur rise scene', effectBrief: 'blur rise scene', acceptanceCriteria: ['scene becomes sharp'], purpose: 'scene' })
  await registerRenderComponent({ id: 'cmp_blur_dissolve', source: transitionComponent, displayName: '模糊溶解', effectSummary: 'blur dissolve transition', effectBrief: 'blur dissolve transition', acceptanceCriteria: ['children remain visible during transition'], purpose: 'transition' })

  const taskId = `v2_custom_render_${Date.now()}`
  const spec: type.RemotionTimelineSpecV1 = {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: taskId,
    canvas: { width: 360, height: 640, fps: 12, duration_sec: 2 },
    assets: [],
    scenes: [
      {
        id: 'scene_a',
        type: 'remotion_card',
        start_sec: 0,
        duration_sec: 1,
        title: 'Scene A',
        custom_render: { component_id: 'cmp_blur_rise', params: { text: '沙箱场景组件' } },
      },
      { id: 'scene_b', type: 'remotion_card', start_sec: 1, duration_sec: 1, title: 'Scene B' },
    ],
    transitions: [{
      id: 'transition_ab',
      from_scene_id: 'scene_a',
      to_scene_id: 'scene_b',
      type: 'fade',
      duration_sec: 0.5,
      custom_render: { component_id: 'cmp_blur_dissolve', params: {} },
    }],
    overlays: [],
    material_jobs: [],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
  }

  await assert.rejects(
    renderV2RemotionTimeline({
      spec: {
        ...spec,
        transitions: [{
          ...spec.transitions[0]!,
          custom_render: { component_id: 'cmp_blur_rise', params: {} },
        }],
      },
      outputDir: path.join(dataDir, 'wrong-purpose'),
    }),
    /purpose/,
    'rendering must reject a scene component referenced as a transition',
  )

  await assert.rejects(
    renderV2RemotionTimeline({
      spec,
      outputDir: path.join(dataDir, 'unauthorized-draft'),
    }),
    /not authorized/,
    'a lower-level render caller must explicitly authorize draft components',
  )

  const result = await renderV2RemotionTimeline({
    spec,
    outputDir: path.join(dataDir, 'out'),
    authorizedDraftComponentIds: ['cmp_blur_rise', 'cmp_blur_dissolve'],
  })
  assert.equal(existsSync(result.outputPath), true, 'rendered mp4 must exist')
  assert.ok(result.fileSizeBytes > 0, 'rendered mp4 must not be empty')

  // A successful ordinary render records usage but cannot bypass authoring review.
  const renderedScene = await readRenderComponent('cmp_blur_rise')
  assert.equal(renderedScene?.manifest.status, 'draft')
  assert.equal(renderedScene?.manifest.renderedTimes, 1)
  const renderedTransition = await readRenderComponent('cmp_blur_dissolve')
  assert.equal(renderedTransition?.manifest.status, 'draft')
  const previewEvidence = (canvas: { width: number; height: number }) => ({
    verdict: 'passed' as const,
    policyVersion: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
    canvas,
    frameCount: 5,
    summary: 'fixture preview passed',
    criteria: [{ criterion: 'fixture renders', passed: true, evidence: 'real Remotion output exists' }],
    reviewedAt: new Date().toISOString(),
  })
  await promoteRenderComponent({ id: 'cmp_blur_rise', previewEvidence: previewEvidence(spec.canvas) })
  await promoteRenderComponent({ id: 'cmp_blur_dissolve', previewEvidence: previewEvidence(spec.canvas) })

  const concurrentSpec: type.RemotionTimelineSpecV1 = {
    ...spec,
    task_id: `${taskId}_concurrent`,
    canvas: { width: 160, height: 160, fps: 12, duration_sec: 0.5 },
    scenes: [{ ...spec.scenes[0]!, start_sec: 0, duration_sec: 0.5 }],
    transitions: [],
  }
  await promoteRenderComponent({ id: 'cmp_blur_rise', previewEvidence: previewEvidence(concurrentSpec.canvas) })
  const concurrent = await Promise.all([
    renderV2RemotionTimeline({
      spec: concurrentSpec,
      outputDir: path.join(dataDir, 'concurrent-a'),
      authorizedDraftComponentIds: ['cmp_blur_rise'],
    }),
    renderV2RemotionTimeline({
      spec: { ...concurrentSpec, task_id: `${taskId}_concurrent_b` },
      outputDir: path.join(dataDir, 'concurrent-b'),
      authorizedDraftComponentIds: ['cmp_blur_rise'],
    }),
  ])
  const registryPaths = concurrent.map((item) => {
    const flag = item.command.indexOf('--custom-components-registry')
    return item.command[flag + 1]!
  })
  assert.notEqual(registryPaths[0], registryPaths[1], 'parallel renders must use isolated component registries')
  assert.equal(registryPaths.every((registryPath) => !existsSync(registryPath)), true, 'temporary registries must be removed')

  await promoteRenderComponent({ id: 'cmp_blur_rise', previewEvidence: previewEvidence(spec.canvas) })
  await promoteRenderComponent({ id: 'cmp_blur_dissolve', previewEvidence: previewEvidence(spec.canvas) })

  const remotionRoot = path.resolve('..', 'remotion')
  const customRegistryDirs = () => readdirSync(remotionRoot)
    .filter((entry) => entry.startsWith('.v2-custom-components-'))
  const registriesBeforeBrowserFailure = new Set(customRegistryDirs())
  const previousBrowserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE
  process.env.REMOTION_BROWSER_EXECUTABLE = path.join(dataDir, 'missing-browser.exe')
  try {
    await assert.rejects(renderV2RemotionTimeline({
      spec,
      outputDir: path.join(dataDir, 'browser-failure'),
      authorizedDraftComponentIds: ['cmp_blur_rise', 'cmp_blur_dissolve'],
    }))
  } finally {
    if (previousBrowserExecutable === undefined) delete process.env.REMOTION_BROWSER_EXECUTABLE
    else process.env.REMOTION_BROWSER_EXECUTABLE = previousBrowserExecutable
  }
  assert.deepEqual(
    customRegistryDirs().filter((entry) => !registriesBeforeBrowserFailure.has(entry)),
    [],
    'failed renders must not leave task-local component registries behind',
  )
  assert.equal(
    (await readRenderComponent('cmp_blur_rise'))?.manifest.failedRenders,
    0,
    'browser failures must not be attributed to custom components without component-specific evidence',
  )

  // Task-local registries must never modify the tracked Studio fallback.
  const registryPath = path.resolve('..', 'remotion', 'src', 'timeline', 'custom-components', 'index.ts')
  const registry = await readFile(registryPath, 'utf8')
  assert.match(registry, /customComponentRegistry: Record<string, \{ default\?: unknown \}> = \{\n\}/)

  console.log('[smoke-v2-render-custom-component] OK')
} finally {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
