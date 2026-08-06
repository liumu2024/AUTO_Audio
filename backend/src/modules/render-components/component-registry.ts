import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

import { auditRenderComponentSource, componentIdValid } from './component-sandbox.js'
import { longestSharedHanPhrase } from '../creative-memory/creative-memory.service.js'

export interface RenderComponentManifest {
  schema_version: 'render_component.v1'
  id: string
  status: 'draft' | 'promoted' | 'disabled'
  description: string
  hash: string
  source_path: string
  bundle_path: string
  createdAt: string
  purpose?: 'scene' | 'transition'
  renderedTimes: number
  sourceWorkspaceSessionId?: string
  sourcePrompt?: string
  promotedAt?: string
  version: number
}

export interface RegisteredRenderComponent {
  id: string
  source: string
  bundle: string
  manifest: RenderComponentManifest
}

const EXTERNAL_PACKAGES = ['react', 'remotion', '@remotion/transitions', '@remotion/media']

export function renderComponentsRoot(cwd = process.cwd()): string {
  return path.resolve(cwd, process.env.RENDER_COMPONENTS_DIR ?? 'tmp/render-components')
}

export async function registerRenderComponent(input: {
  id: string
  source: string
  description?: string
  purpose?: 'scene' | 'transition'
  sourceWorkspaceSessionId?: string
  sourcePrompt?: string
}): Promise<RegisteredRenderComponent> {
  if (!componentIdValid(input.id)) throw new Error(`Invalid component id: ${input.id}`)
  const audit = auditRenderComponentSource(input.source)
  if (!audit.ok) throw new Error(`Component audit failed: ${audit.issues.join('; ')}`)

  const dir = path.join(renderComponentsRoot(), input.id)
  await mkdir(dir, { recursive: true })
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
  await writeFile(sourcePath, input.source, 'utf8')
  await writeFile(bundlePath, bundle, 'utf8')
  const manifest: RenderComponentManifest = {
    schema_version: 'render_component.v1',
    id: input.id,
    status: 'draft',
    description: input.description?.trim().slice(0, 500) ?? '',
    purpose: input.purpose,
    hash: createHash('sha256').update(bundle).digest('hex').slice(0, 16),
    source_path: sourcePath,
    bundle_path: bundlePath,
    createdAt: new Date().toISOString(),
    renderedTimes: 0,
    sourceWorkspaceSessionId: input.sourceWorkspaceSessionId,
    sourcePrompt: input.sourcePrompt?.trim().slice(0, 1000),
    version: 1,
  }
  await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
 * Behavior-driven sedimentation: a successful render is the verification.
 * The first successful render automatically promotes a draft component to a
 * reusable asset. No user or model confirmation is required.
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
      status: manifest.status === 'draft' ? 'promoted' : manifest.status,
      promotedAt: manifest.status === 'draft' ? (manifest.promotedAt ?? new Date().toISOString()) : manifest.promotedAt,
    }
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  } catch {
    return null
  }
}

export async function listPromotedComponents(): Promise<
  Array<{ id: string; purpose?: 'scene' | 'transition'; description: string }>
> {
  const manifests = await listRenderComponents()
  return manifests
    .filter((item) => item.status === 'promoted')
    .slice(0, 20)
    .map((item) => ({ id: item.id, purpose: item.purpose, description: item.description }))
}

export interface PromotedComponentHint {
  component_id: string
  purpose?: 'scene' | 'transition'
  matched_text: string
}

/**
 * System-side mapping: a request/instruction sharing a >=4 char Chinese phrase
 * with a promoted component description resolves to that component
 * deterministically, so small models do not have to infer the mapping.
 */
export async function matchPromotedComponents(texts: string[]): Promise<PromotedComponentHint[]> {
  const promoted = await listPromotedComponents()
  const hints: PromotedComponentHint[] = []
  for (const component of promoted) {
    const matched = texts.find((text) =>
      Boolean(longestSharedHanPhrase(text, component.description)) ||
      Boolean(longestSharedHanPhrase(component.description, text)))
    if (matched) {
      hints.push({ component_id: component.id, purpose: component.purpose, matched_text: matched })
    }
  }
  return hints
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
