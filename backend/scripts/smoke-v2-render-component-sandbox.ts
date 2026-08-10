import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'

process.env.RENDER_COMPONENTS_DIR = mkdtempSync(path.join(os.tmpdir(), 'render-components-'))

try {
  const {
    auditRenderComponentSource,
  } = await import('../src/modules/render-components/component-sandbox.js')
  const {
    listRenderComponents,
    listPromotedComponents,
    bindRegisteredRenderComponentDisplayNames,
    findPromotedRenderComponentBySource,
    markRenderSucceeded,
    markRenderFailed,
    readRenderComponent,
    registerRenderComponent,
    renderComponentEvidenceMatchesCanvas,
    renderComponentsRoot,
    promoteRenderComponent,
    validateRenderComponentReferences,
  } = await import('../src/modules/render-components/component-registry.js')
  const metadata = (effectSummary: string) => ({
    displayName: effectSummary,
    effectSummary,
    effectBrief: effectSummary,
    acceptanceCriteria: [effectSummary],
  })
  const evidence = (criterion: string, canvas = { width: 360, height: 640 }) => ({
    verdict: 'passed' as const,
    policyVersion: 'render_component_visual.v2',
    canvas,
    frameCount: 5,
    summary: 'fixture preview passed',
    criteria: [{ criterion, passed: true, evidence: 'fixture evidence' }],
    reviewedAt: new Date().toISOString(),
  })
  const configuredRoot = process.env.RENDER_COMPONENTS_DIR
  delete process.env.RENDER_COMPONENTS_DIR
  process.env.DPL304_LOCAL_DATA_DIR = path.join(os.tmpdir(), 'v2-local-data-root')
  assert.equal(renderComponentsRoot(), path.join(process.env.DPL304_LOCAL_DATA_DIR, 'render-components'))
  process.env.RENDER_COMPONENTS_DIR = configuredRoot

  // A legitimate Remotion component passes the audit and compiles.
  const valid = `
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'

export default function BlurRise(props) {
  const frame = useCurrentFrame()
  const blur = interpolate(frame, [0, 30], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ filter: \`blur(\${blur}px)\`, background: props.scene?.background ?? '#09090b' }}>
      <div style={{ color: '#f8fafc', fontSize: 48 }}>{props.params?.text ?? ''}</div>
    </AbsoluteFill>
  )
}
`
  assert.deepEqual(auditRenderComponentSource(valid), { ok: true, issues: [] })
  assert.deepEqual(
    auditRenderComponentSource(`const Component = () => null\nexport { Component as default }`),
    { ok: true, issues: [] },
    'an explicit default export alias remains valid',
  )
  const registered = await registerRenderComponent({ id: 'cmp_blur_rise', source: valid, ...metadata('blur rise'), purpose: 'scene' })
  await registerRenderComponent({
    id: 'cmp_blur_dissolve',
    source: `export default function BlurDissolve({ children, progress, direction }) {
  const blur = direction === 'exiting' ? 18 * (progress ?? 0) : 0
  const opacity = direction === 'exiting' ? 1 - (progress ?? 0) : 1
  return <div style={{ filter: \`blur(\${blur}px)\`, height: '100%', opacity, width: '100%' }}>{children}</div>
}`,
    purpose: 'transition',
    ...metadata('模糊溶解过渡：前一镜头模糊消失、后一镜头清晰显现'),
  })
  await promoteRenderComponent({ id: 'cmp_blur_dissolve', previewEvidence: evidence('模糊溶解过渡：前一镜头模糊消失、后一镜头清晰显现') })
  await registerRenderComponent({
    id: 'cmp_legacy_visual_policy', source: `${valid}\n// legacy visual policy`,
    ...metadata('legacy visual policy'), purpose: 'scene',
  })
  await promoteRenderComponent({
    id: 'cmp_legacy_visual_policy',
    previewEvidence: {
      verdict: 'passed', frameCount: 5, summary: 'legacy evidence',
      criteria: [{ criterion: 'legacy visual policy', passed: true, evidence: 'legacy evidence' }],
      reviewedAt: new Date().toISOString(),
    },
  })
  assert.equal(
    (await listPromotedComponents()).some((item) => item.id === 'cmp_legacy_visual_policy'),
    true,
    'legacy promoted components remain discoverable so the selected component can be revalidated on demand',
  )
  assert.equal(registered.manifest.status, 'draft', 'new components start as draft')
  assert.equal(registered.manifest.displayName, 'blur rise')
  assert.equal(registered.manifest.renderedTimes, 0)
  assert.ok(registered.bundle.length > 0, 'bundle must be produced')
  assert.equal((await readRenderComponent('cmp_blur_rise'))?.id, 'cmp_blur_rise')
  assert.equal((await listRenderComponents()).some((item) => item.id === 'cmp_blur_rise'), true)
  assert.deepEqual(
    await validateRenderComponentReferences([{ id: 'cmp_blur_rise', purpose: 'scene' }], new Set(['cmp_blur_rise'])),
    [],
    'an explicitly authorized draft may be referenced for its declared purpose',
  )
  assert.match(
    (await validateRenderComponentReferences([{ id: 'cmp_blur_rise', purpose: 'transition' }], new Set(['cmp_blur_rise'])))[0] ?? '',
    /purpose/,
    'scene components cannot cross into transition references',
  )
  assert.match(
    (await validateRenderComponentReferences([{ id: 'cmp_blur_rise', purpose: 'scene' }]))[0] ?? '',
    /draft/,
    'unrelated drafts are not generally available',
  )

  // Ordinary rendering records behavior but cannot bypass visual acceptance.
  assert.equal((await listPromotedComponents()).some((item) => item.id === 'cmp_blur_rise'), false)
  const renderedDraft = await markRenderSucceeded('cmp_blur_rise')
  assert.equal(renderedDraft?.status, 'draft')
  const promoted = await promoteRenderComponent({ id: 'cmp_blur_rise', previewEvidence: evidence('blur rise') })
  assert.equal(promoted?.status, 'promoted')
  assert.equal(promoted?.renderedTimes, 2)
  assert.equal(promoted?.promotedAt !== undefined, true)
  assert.equal((await listPromotedComponents()).find((item) => item.id === 'cmp_blur_rise')?.displayName, 'blur rise')
  assert.equal(
    (await listPromotedComponents({ width: 720, height: 1280 })).some((item) => item.id === 'cmp_blur_rise'),
    true,
    'a responsive component accepted at the same aspect ratio remains reusable',
  )
  assert.equal(
    (await listPromotedComponents({ width: 1280, height: 720 })).some((item) => item.id === 'cmp_blur_rise'),
    true,
    'cross-aspect components remain discoverable but must pass current-canvas revalidation before persistence',
  )
  assert.match(
    (await validateRenderComponentReferences(
      [{ id: 'cmp_blur_rise', purpose: 'scene' }],
      new Set(),
      { width: 1280, height: 720 },
    ))[0] ?? '',
    /aspect ratio/,
    'a forged or historical cross-aspect reference to a current-policy component is rejected at persistence/render boundaries',
  )
  assert.match(
    (await validateRenderComponentReferences(
      [{ id: 'cmp_legacy_visual_policy', purpose: 'scene' }],
      new Set(),
      { width: 1280, height: 720 },
    ))[0] ?? '',
    /current visual evidence/,
    'legacy promoted references cannot bypass the current visual policy through a saved or direct spec',
  )
  const boundFromRegistry = await bindRegisteredRenderComponentDisplayNames({
    schema_version: 'remotion_timeline_spec.v1',
    task_id: 'component_name_binding',
    canvas: { width: 360, height: 640, fps: 12, duration_sec: 2 },
    assets: [],
    scenes: [
      { id: 'scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 1 },
      { id: 'scene_2', type: 'remotion_card', start_sec: 1, duration_sec: 1 },
    ],
    transitions: [{
      id: 'transition_1', from_scene_id: 'scene_1', to_scene_id: 'scene_2',
      type: 'fade', duration_sec: 0.3,
      custom_render: { component_id: 'cmp_blur_dissolve', display_name: '模型伪造名称' },
    }],
    caption_tracks: [], overlays: [], audio: [], material_jobs: [],
    render_policy: { renderer: 'remotion_timeline' },
  } satisfies RemotionTimelineSpecV1)
  assert.equal(boundFromRegistry.transitions[0]?.custom_render?.display_name, '模糊溶解过渡：前一镜头模糊消失、后一镜头清晰显现')
  const exactDuplicate = await findPromotedRenderComponentBySource({ source: valid, purpose: 'scene' })
  assert.equal(exactDuplicate?.id, 'cmp_blur_rise', 'an identical promoted source must resolve to its server ID')
  const promotedAgain = await markRenderSucceeded('cmp_blur_rise')
  assert.equal(promotedAgain?.renderedTimes, 3)
  assert.equal(promotedAgain?.status, 'promoted')

  // Visual evidence is reusable per aspect ratio, and concurrent manifest
  // updates must merge rather than silently losing one accepted preview.
  const beforeConcurrentPromotions = (await readRenderComponent('cmp_blur_rise'))!.manifest.renderedTimes
  await Promise.all([
    promoteRenderComponent({
      id: 'cmp_blur_rise',
      previewEvidence: evidence('portrait acceptance', { width: 360, height: 640 }),
    }),
    promoteRenderComponent({
      id: 'cmp_blur_rise',
      previewEvidence: evidence('landscape acceptance', { width: 640, height: 360 }),
    }),
  ])
  const multiAspectManifest = (await readRenderComponent('cmp_blur_rise'))!.manifest
  assert.equal(multiAspectManifest.renderedTimes, beforeConcurrentPromotions + 2)
  assert.equal(renderComponentEvidenceMatchesCanvas(
    multiAspectManifest.previewEvidenceByAspect,
    { width: 720, height: 1280 },
  ), true)
  assert.equal(renderComponentEvidenceMatchesCanvas(
    multiAspectManifest.previewEvidenceByAspect,
    { width: 1280, height: 720 },
  ), true)

  // Behavior-weighted ordering: more successful renders rank higher, and a
  // failed render acts as negative feedback that demotes the component.
  await registerRenderComponent({ id: 'cmp_alpha', source: `${valid}\n// alpha`, ...metadata('alpha effect'), purpose: 'scene' })
  await registerRenderComponent({ id: 'cmp_beta', source: `${valid}\n// beta`, ...metadata('beta effect'), purpose: 'scene' })
  await promoteRenderComponent({ id: 'cmp_alpha', previewEvidence: evidence('alpha effect') })
  await promoteRenderComponent({ id: 'cmp_beta', previewEvidence: evidence('beta effect') })
  for (let i = 0; i < 3; i += 1) await markRenderSucceeded('cmp_alpha')
  await markRenderSucceeded('cmp_beta')
  const ordered = await listPromotedComponents()
  const alphaIndex = ordered.findIndex((item) => item.id === 'cmp_alpha')
  const betaIndex = ordered.findIndex((item) => item.id === 'cmp_beta')
  assert.ok(alphaIndex >= 0 && betaIndex >= 0, 'both weighted components must be listed')
  assert.ok(alphaIndex < betaIndex, 'more-rendered component must rank higher')
  await markRenderFailed('cmp_alpha')
  const afterFailure = await listPromotedComponents()
  assert.ok(
    afterFailure.findIndex((item) => item.id === 'cmp_alpha') > afterFailure.findIndex((item) => item.id === 'cmp_beta'),
    'negative feedback must demote the failed component',
  )

  // Malicious or unsafe components must be rejected by the static audit.
  const malicious: Array<{ name: string; source: string }> = [
    { name: 'fetch', source: `export default function Bad() { fetch('https://example.com') }` },
    { name: 'fetch_alias', source: `const request = fetch\nexport default function Bad() { request('https://example.com') }` },
    { name: 'node_fs', source: `import fs from 'node:fs'\nexport default function Bad() { return fs.readFileSync('/etc/passwd') }` },
    { name: 'plain_fs', source: `import fs from 'fs'\nexport default function Bad() { return fs.readFileSync('/x') }` },
    { name: 'eval', source: `export default function Bad() { eval('1+1') }` },
    { name: 'new_function', source: `export default function Bad() { return new Function('x') }` },
    { name: 'function_alias', source: `const Factory = Function\nexport default function Bad() { return new Factory('x') }` },
    { name: 'dynamic_import', source: `export default async function Bad() { await import('https://example.com/x.js') }` },
    { name: 'require', source: `export default function Bad() { return require('fs') }` },
    { name: 'global_access', source: `export default function Bad() { return globalThis.process.env }` },
    { name: 'window_access', source: `export default function Bad() { return window.location }` },
    { name: 'window_alias', source: `const browser = window\nexport default function Bad() { return browser.location }` },
    { name: 'random', source: `export default function Bad() { return Math.random() }` },
    { name: 'random_destructure', source: `const {random} = Math\nexport default function Bad() { return random() }` },
    { name: 'self_fetch', source: `export default function Bad() { return self['fetch']('https://example.com') }` },
    { name: 'crypto_random', source: `export default function Bad() { return crypto.getRandomValues(new Uint8Array(1)) }` },
    { name: 'image_network', source: `export default function Bad() { return new Image() }` },
    { name: 'event_source', source: `export default function Bad() { return new EventSource('https://example.com') }` },
    { name: 'worker', source: `export default function Bad() { return new Worker('https://example.com/a.js') }` },
    { name: 'shared_worker', source: `export default function Bad() { return new SharedWorker('https://example.com/a.js') }` },
    { name: 'jsx_remote_image', source: `export default function Bad() { return <img src="https://example.com/x.png" /> }` },
    { name: 'remote_css_url', source: `export default function Bad() { return <div style={{backgroundImage:'url(https://example.com/x.png)'}} /> }` },
    { name: 'animation_frame', source: `export default function Bad() { requestAnimationFrame(() => {}) }` },
    { name: 'timer', source: `export default function Bad() { setInterval(() => {}, 100) }` },
    { name: 'wall_clock', source: `export default function Bad() { return Date.now() + performance.now() }` },
    { name: 'css_animation', source: `export default function Bad() { return <div style={{animation:'pulse 1s infinite'}} /> }` },
    { name: 'css_transition', source: `export default function Bad() { return <div style={{transition:'opacity 1s'}} /> }` },
    { name: 'named_export_only', source: `const Component = () => null\nexport { Component }` },
    { name: 'scalar_default', source: `const Component = 42\nexport default Component` },
    { name: 'scalar_default_alias', source: `const Component = 42\nexport { Component as default }` },
    { name: 'default_reexport', source: `export { default } from 'react'` },
    { name: 'untrusted_reexport', source: `export { value } from 'unsafe-package'\nexport default function Bad() { return null }` },
    { name: 'no_default_export', source: `export const x = 1` },
    { name: 'import_equals', source: `import fs = require('fs')\nexport default function Bad() { return fs }` },
  ]
  for (const item of malicious) {
    const audit = auditRenderComponentSource(item.source)
    assert.equal(audit.ok, false, `${item.name} must be rejected`)
    assert.ok(audit.issues.length > 0, `${item.name} must report an issue`)
  }

  // Invalid ids are rejected before registration.
  await assert.rejects(
    registerRenderComponent({ id: 'cmp_empty_name', source: valid, ...metadata('invalid name'), displayName: '   ', purpose: 'scene' }),
    /display name/i,
  )
  await assert.rejects(
    registerRenderComponent({ id: 'bad id!', source: valid, ...metadata('invalid id'), purpose: 'scene' }),
    /Invalid component id/,
  )

  console.log('[smoke-v2-render-component-sandbox] OK')
} finally {
  rmSync(process.env.RENDER_COMPONENTS_DIR!, { recursive: true, force: true })
}
