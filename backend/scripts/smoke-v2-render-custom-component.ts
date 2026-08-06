import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-custom-render-'))
process.env.RENDER_COMPONENTS_DIR = path.join(dataDir, 'components')

try {
  const { registerRenderComponent } = await import('../src/modules/render-components/component-registry.js')
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
  await registerRenderComponent({ id: 'cmp_blur_rise', source: sceneComponent, description: 'blur rise scene' })
  await registerRenderComponent({ id: 'cmp_blur_dissolve', source: transitionComponent, description: 'blur dissolve transition' })

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
    render_policy: { renderer: 'remotion_timeline', allow_custom_component: false },
  }

  const result = await renderV2RemotionTimeline({
    spec,
    outputDir: path.join(dataDir, 'out'),
  })
  assert.equal(existsSync(result.outputPath), true, 'rendered mp4 must exist')
  assert.ok(result.fileSizeBytes > 0, 'rendered mp4 must not be empty')

  // A successful render automatically sediments both referenced components.
  const renderedScene = await readRenderComponent('cmp_blur_rise')
  assert.equal(renderedScene?.manifest.status, 'promoted')
  assert.equal(renderedScene?.manifest.renderedTimes, 1)
  const renderedTransition = await readRenderComponent('cmp_blur_dissolve')
  assert.equal(renderedTransition?.manifest.status, 'promoted')

  // After render the injected registry is reset to the empty template.
  const registryPath = path.resolve('..', 'remotion', 'src', 'timeline', 'custom-components', 'index.ts')
  const registry = await readFile(registryPath, 'utf8')
  assert.match(registry, /customComponentRegistry: Record<string, \{ default\?: unknown \}> = \{\n\}/)

  console.log('[smoke-v2-render-custom-component] OK')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
