import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { auditRenderComponentSource, componentIdValid } from './component-sandbox.js'

export interface RenderComponentManifest {
  schema_version: 'render_component.v1'
  id: string
  status: 'draft' | 'promoted' | 'disabled'
  displayName: string
  effectSummary: string
  effectBrief: string
  acceptanceCriteria: string[]
  sourceHash: string
  hash: string
  source_path: string
  bundle_path: string
  createdAt: string
  purpose: 'scene' | 'transition'
  renderedTimes: number
  failedRenders: number
  sourceWorkspaceSessionId?: string
  previewEvidence?: {
    verdict: 'passed'
    frameCount: number
    summary: string
    criteria: Array<{ criterion: string; passed: boolean; evidence: string }>
    reviewedAt: string
  }
  promotedAt?: string
  version: number
}

export interface RenderComponentSummary {
  id: string
  purpose: 'scene' | 'transition'
  displayName: string
  effectSummary: string
}

export interface RegisteredRenderComponent {
  id: string
  source: string
  bundle: string
  manifest: RenderComponentManifest
}

const EXTERNAL_PACKAGES = ['react', 'remotion', '@remotion/transitions', '@remotion/media']

export function renderComponentsRoot(cwd = process.cwd()): string {
  const configured = process.env.RENDER_COMPONENTS_DIR?.trim()
  if (configured) return path.resolve(cwd, configured)
  const localDataDir = process.env.DPL304_LOCAL_DATA_DIR?.trim()
  return path.resolve(cwd, localDataDir ? path.join(localDataDir, 'render-components') : 'data/render-components')
}

export async function registerRenderComponent(input: {
  id: string
  source: string
  displayName: string
  effectSummary: string
  effectBrief: string
  acceptanceCriteria: string[]
  purpose: 'scene' | 'transition'
  sourceWorkspaceSessionId?: string
}): Promise<RegisteredRenderComponent> {
  if (!componentIdValid(input.id)) throw new Error(`Invalid component id: ${input.id}`)
  const displayName = input.displayName.trim()
  if (!displayName) throw new Error('Component display name is required.')
  const audit = auditRenderComponentSource(input.source)
  if (!audit.ok) throw new Error(`Component audit failed: ${audit.issues.join('; ')}`)

  const sourceHash = createHash('sha256').update(input.source).digest('hex')

  const dir = path.join(renderComponentsRoot(), input.id)
  const result = await build({
    stdin: {
      contents: input.source,
      resolveDir: dir,
      sourcefile: 'component.tsx',
      loader: 'tsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    external: EXTERNAL_PACKAGES,
    write: false,
    minify: true,
    logLevel: 'silent',
  })
  const bundle = result.outputFiles[0]?.text
  if (!bundle) throw new Error('Component compilation produced no output.')

  const sourcePath = path.join(dir, 'source.tsx')
  const bundlePath = path.join(dir, 'bundle.js')
  const manifest: RenderComponentManifest = {
    schema_version: 'render_component.v1',
    id: input.id,
    status: 'draft',
    displayName: displayName.slice(0, 80),
    effectSummary: input.effectSummary.trim().slice(0, 500),
    effectBrief: input.effectBrief.trim().slice(0, 2_000),
    acceptanceCriteria: input.acceptanceCriteria.map((item) => item.trim().slice(0, 500)),
    purpose: input.purpose,
    sourceHash,
    hash: createHash('sha256').update(bundle).digest('hex').slice(0, 16),
    source_path: sourcePath,
    bundle_path: bundlePath,
    createdAt: new Date().toISOString(),
    renderedTimes: 0,
    failedRenders: 0,
    sourceWorkspaceSessionId: input.sourceWorkspaceSessionId,
    version: 1,
  }
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(sourcePath, input.source, 'utf8')
    await writeFile(bundlePath, bundle, 'utf8')
    await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return { id: input.id, source: input.source, bundle, manifest }
}

export async function readRenderComponent(id: string): Promise<RegisteredRenderComponent | null> {
  if (!componentIdValid(id)) return null
  const dir = path.join(renderComponentsRoot(), id)
  try {
    const [source, bundle, manifestRaw] = await Promise.all([
      readFile(path.join(dir, 'source.tsx'), 'utf8'),
      readFile(path.join(dir, 'bundle.js'), 'utf8'),
      readFile(path.join(dir, 'manifest.json'), 'utf8'),
    ])
    const manifest = JSON.parse(manifestRaw) as RenderComponentManifest
    if (manifest.status === 'disabled') return null
    return { id, source, bundle, manifest }
  } catch {
    return null
  }
}

export async function listRenderComponents(): Promise<RenderComponentManifest[]> {
  const root = renderComponentsRoot()
  const entries = await readdirSafe(root)
  const manifests: RenderComponentManifest[] = []
  for (const entry of entries) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, entry, 'manifest.json'), 'utf8'),
      ) as RenderComponentManifest
      if (manifest.schema_version === 'render_component.v1') manifests.push(manifest)
    } catch {
      // ignore non-component directories
    }
  }
  return manifests
}

/**
 * Records ordinary render success without changing lifecycle status. Only the
 * authoring service may promote a draft after visual acceptance.
 */
export async function markRenderSucceeded(id: string): Promise<RenderComponentManifest | null> {
  if (!componentIdValid(id)) return null
  const manifestPath = path.join(renderComponentsRoot(), id, 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RenderComponentManifest
    if (manifest.status === 'disabled') return manifest
    const renderedTimes = (manifest.renderedTimes ?? 0) + 1
    const next: RenderComponentManifest = {
      ...manifest,
      renderedTimes,
      status: manifest.status,
      promotedAt: manifest.promotedAt,
    }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  } catch {
    return null
  }
}

export async function setRenderComponentDisplayName(
  id: string,
  displayName: string,
): Promise<RenderComponentManifest | null> {
  if (!componentIdValid(id)) return null
  const name = displayName.trim()
  if (!name) throw new Error('Component display name is required.')
  const manifestPath = path.join(renderComponentsRoot(), id, 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RenderComponentManifest
    if (manifest.status === 'disabled') return null
    const next = { ...manifest, displayName: name.slice(0, 80) }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  } catch {
    return null
  }
}

export async function promoteRenderComponent(input: {
  id: string
  previewEvidence: NonNullable<RenderComponentManifest['previewEvidence']>
}): Promise<RenderComponentManifest | null> {
  if (!componentIdValid(input.id)) return null
  const manifestPath = path.join(renderComponentsRoot(), input.id, 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RenderComponentManifest
    if (manifest.status !== 'draft') return manifest.status === 'promoted' ? manifest : null
    const next: RenderComponentManifest = {
      ...manifest,
      status: 'promoted',
      renderedTimes: (manifest.renderedTimes ?? 0) + 1,
      previewEvidence: input.previewEvidence,
      promotedAt: new Date().toISOString(),
    }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  } catch {
    return null
  }
}

export async function removeDraftRenderComponent(id: string): Promise<boolean> {
  const component = await readRenderComponent(id)
  if (!component || component.manifest.status !== 'draft') return false
  await rm(path.join(renderComponentsRoot(), id), { recursive: true, force: true })
  return true
}

export async function findPromotedRenderComponentBySource(input: {
  source: string
  purpose: 'scene' | 'transition'
}): Promise<RegisteredRenderComponent | null> {
  const sourceHash = createHash('sha256').update(input.source).digest('hex')
  const manifest = (await listRenderComponents()).find(
    (item) => item.status === 'promoted' && item.sourceHash === sourceHash && item.purpose === input.purpose,
  )
  return manifest ? readRenderComponent(manifest.id) : null
}

/** Negative feedback: a failed render demotes the component's rank. */
export async function markRenderFailed(id: string): Promise<RenderComponentManifest | null> {
  if (!componentIdValid(id)) return null
  const manifestPath = path.join(renderComponentsRoot(), id, 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RenderComponentManifest
    const next: RenderComponentManifest = {
      ...manifest,
      failedRenders: (manifest.failedRenders ?? 0) + 1,
    }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  } catch {
    return null
  }
}

function componentBehaviorScore(manifest: RenderComponentManifest): number {
  return (manifest.renderedTimes ?? 0) - (manifest.failedRenders ?? 0) * 3
}

export async function listPromotedComponents(): Promise<
  RenderComponentSummary[]
> {
  const manifests = await listRenderComponents()
  return manifests
    .filter((item) => item.status === 'promoted' && (item.purpose === 'scene' || item.purpose === 'transition'))
    .sort((a, b) => componentBehaviorScore(b) - componentBehaviorScore(a))
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      purpose: item.purpose,
      displayName: item.displayName,
      effectSummary: item.effectSummary,
    }))
}

export function bindRenderComponentDisplayNames(
  spec: RemotionTimelineSpecV1,
  components: readonly RenderComponentSummary[],
): RemotionTimelineSpecV1 {
  const byId = new Map(components.map((component) => [component.id, component]))
  const bind = <T extends { component_id: string; display_name?: string }>(
    reference: T | undefined,
    purpose: RenderComponentSummary['purpose'],
  ): T | undefined => {
    if (!reference) return undefined
    const component = byId.get(reference.component_id)
    return component?.purpose === purpose
      ? { ...reference, display_name: component.displayName }
      : reference
  }
  return {
    ...spec,
    scenes: spec.scenes.map((scene) => scene.custom_render
      ? { ...scene, custom_render: bind(scene.custom_render, 'scene') }
      : scene),
    transitions: spec.transitions.map((transition) => transition.custom_render
      ? { ...transition, custom_render: bind(transition.custom_render, 'transition') }
      : transition),
  }
}

export async function bindRegisteredRenderComponentDisplayNames(
  spec: RemotionTimelineSpecV1,
): Promise<RemotionTimelineSpecV1> {
  const componentIds = [...new Set(timelineRenderComponentReferences(spec).map((reference) => reference.id))]
  const components = (await Promise.all(componentIds.map((id) => readRenderComponent(id))))
    .flatMap((component): RenderComponentSummary[] => component
      ? [{
          id: component.id,
          purpose: component.manifest.purpose,
          displayName: component.manifest.displayName,
          effectSummary: component.manifest.effectSummary,
        }]
      : [])
  return bindRenderComponentDisplayNames(spec, components)
}

export function timelineRenderComponentReferences(
  spec: RemotionTimelineSpecV1,
): Array<{ id: string; purpose: 'scene' | 'transition' }> {
  return [
    ...spec.scenes.flatMap((scene) => scene.custom_render?.component_id
      ? [{ id: scene.custom_render.component_id, purpose: 'scene' as const }]
      : []),
    ...spec.transitions.flatMap((transition) => transition.custom_render?.component_id
      ? [{ id: transition.custom_render.component_id, purpose: 'transition' as const }]
      : []),
  ]
}

export async function validateRenderComponentReferences(
  references: Array<{ id: string; purpose: 'scene' | 'transition' }>,
  allowedDraftIds: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const issues: string[] = []
  for (const reference of references) {
    const component = await readRenderComponent(reference.id)
    if (!component) {
      issues.push(`${reference.id}: component does not exist`)
    } else if (component.manifest.purpose !== reference.purpose) {
      issues.push(`${reference.id}: component purpose is ${String(component.manifest.purpose)}, expected ${reference.purpose}`)
    } else if (component.manifest.status === 'draft' && !allowedDraftIds.has(reference.id)) {
      issues.push(`${reference.id}: draft component is not authorized for this action`)
    }
  }
  return issues
}

async function readdirSafe(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

export function renderComponentId(prefix = 'cmp'): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`
}
