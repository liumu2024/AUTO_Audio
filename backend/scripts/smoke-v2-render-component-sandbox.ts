import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.RENDER_COMPONENTS_DIR = mkdtempSync(path.join(os.tmpdir(), 'render-components-'))

try {
  const {
    auditRenderComponentSource,
  } = await import('../src/modules/render-components/component-sandbox.js')
  const {
    listRenderComponents,
    listPromotedComponents,
    markRenderSucceeded,
    matchPromotedComponents,
    readRenderComponent,
    registerRenderComponent,
  } = await import('../src/modules/render-components/component-registry.js')

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
  const registered = await registerRenderComponent({ id: 'cmp_blur_rise', source: valid, description: 'blur rise' })
  await registerRenderComponent({
    id: 'cmp_blur_dissolve',
    source: `export default function BlurDissolve({ children, progress, direction }) {
  const blur = direction === 'exiting' ? 18 * (progress ?? 0) : 0
  const opacity = direction === 'exiting' ? 1 - (progress ?? 0) : 1
  return <div style={{ filter: \`blur(\${blur}px)\`, height: '100%', opacity, width: '100%' }}>{children}</div>
}`,
    purpose: 'transition',
    description: '模糊溶解过渡：前一镜头模糊消失、后一镜头清晰显现',
  })
  await markRenderSucceeded('cmp_blur_dissolve')
  assert.equal(registered.manifest.status, 'draft', 'new components start as draft')
  assert.equal(registered.manifest.renderedTimes, 0)
  assert.ok(registered.bundle.length > 0, 'bundle must be produced')
  assert.equal((await readRenderComponent('cmp_blur_rise'))?.id, 'cmp_blur_rise')
  assert.equal((await listRenderComponents()).some((item) => item.id === 'cmp_blur_rise'), true)

  // A successful render automatically promotes the component (behavior-driven
  // sedimentation): no user or model confirmation is required.
  assert.equal((await listPromotedComponents()).some((item) => item.id === 'cmp_blur_rise'), false)
  const promoted = await markRenderSucceeded('cmp_blur_rise')
  assert.equal(promoted?.status, 'promoted')
  assert.equal(promoted?.renderedTimes, 1)
  assert.equal(promoted?.promotedAt !== undefined, true)
  assert.equal((await listPromotedComponents()).some((item) => item.id === 'cmp_blur_rise'), true)
  const promotedAgain = await markRenderSucceeded('cmp_blur_rise')
  assert.equal(promotedAgain?.renderedTimes, 2)
  assert.equal(promotedAgain?.status, 'promoted')

  // System mapping: a request sharing a >=4 char phrase with a promoted
  // component description resolves to that component deterministically.
  const hints = await matchPromotedComponents(['第二三镜头之间使用模糊溶解过渡'])
  assert.ok(
    hints.some((hint) => hint.component_id === 'cmp_blur_dissolve' && hint.purpose === 'transition'),
    'system mapping must resolve blur dissolve to the promoted component',
  )
  const unrelated = await matchPromotedComponents(['完全无关的风景广告'])
  assert.equal(unrelated.length, 0, 'unrelated requests must not map to any component')

  // Malicious or unsafe components must be rejected by the static audit.
  const malicious: Array<{ name: string; source: string }> = [
    { name: 'fetch', source: `export default function Bad() { fetch('https://example.com') }` },
    { name: 'node_fs', source: `import fs from 'node:fs'\nexport default function Bad() { return fs.readFileSync('/etc/passwd') }` },
    { name: 'plain_fs', source: `import fs from 'fs'\nexport default function Bad() { return fs.readFileSync('/x') }` },
    { name: 'eval', source: `export default function Bad() { eval('1+1') }` },
    { name: 'new_function', source: `export default function Bad() { return new Function('x') }` },
    { name: 'dynamic_import', source: `export default async function Bad() { await import('https://example.com/x.js') }` },
    { name: 'require', source: `export default function Bad() { return require('fs') }` },
    { name: 'global_access', source: `export default function Bad() { return globalThis.process.env }` },
    { name: 'window_access', source: `export default function Bad() { return window.location }` },
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
    registerRenderComponent({ id: 'bad id!', source: valid }),
    /Invalid component id/,
  )

  console.log('[smoke-v2-render-component-sandbox] OK')
} finally {
  rmSync(process.env.RENDER_COMPONENTS_DIR!, { recursive: true, force: true })
}
