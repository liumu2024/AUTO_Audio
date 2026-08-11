import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type {
  RemotionTimelineAsset,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import {
  markRenderFailed,
  markRenderSucceeded,
  readRenderComponent,
  timelineRenderComponentReferences,
  validateRenderComponentReferences,
} from '../modules/render-components/component-registry.js'

export interface V2TimelineRenderResult {
  propsPath: string
  outputPath: string
  summaryPath: string
  fileSizeBytes: number
  command: string[]
  log: string
}

function resolveFromCwd(value: string, cwd = process.cwd()): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value)
}

function commandForNode(): string {
  return process.execPath
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${stdout}\n${stderr}`))
    })
  })
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function isRemoteOrStatic(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('static:')
}

async function createStagedPublicAssetDir(remotionRoot: string, taskId: string): Promise<string> {
  const root = path.join(remotionRoot, 'public', 'v2-assets')
  await mkdir(root, { recursive: true })
  return mkdtemp(path.join(root, `${safePart(taskId)}-`))
}

async function removeTransientDir(dir: string, label: string, originalError?: unknown): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (cleanupError) {
    if (!originalError) throw cleanupError
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    console.error(`[v2-timeline-render] ${label} cleanup failed: ${message}`)
  }
}

async function stageLocalAssetsForRemotion(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot: string
  publicDir: string
}): Promise<RemotionTimelineSpecV1> {
  const publicRelativeDir = path.relative(path.join(input.remotionRoot, 'public'), input.publicDir)
    .split(path.sep)
    .join('/')

  const assets: RemotionTimelineAsset[] = []
  for (const asset of input.spec.assets) {
    if (isRemoteOrStatic(asset.src)) {
      assets.push(asset)
      continue
    }
    const sourcePath = resolveFromCwd(asset.src, path.resolve(process.cwd(), '..'))
    if (!existsSync(sourcePath)) {
      assets.push(asset)
      continue
    }
    const ext = path.extname(sourcePath) || (asset.type === 'image' ? '.png' : asset.type === 'audio' ? '.mp3' : '.mp4')
    const fileName = `${safePart(asset.id)}${ext}`
    const targetPath = path.join(input.publicDir, fileName)
    await copyFile(sourcePath, targetPath)
    assets.push({
      ...asset,
      src: `static:${path.posix.join(publicRelativeDir, fileName)}`,
    })
  }

  return {
    ...input.spec,
    assets,
  }
}

function referencedComponentIds(spec: RemotionTimelineSpecV1): Set<string> {
  return new Set(timelineRenderComponentReferences(spec).map((reference) => reference.id))
}

async function createCustomComponentRegistry(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot: string
}): Promise<{ dir: string; entryPath: string }> {
  const customDir = await mkdtemp(path.join(input.remotionRoot, `.v2-custom-components-${safePart(input.spec.task_id)}-`))
  const referenced = referencedComponentIds(input.spec)
  try {
    const imports: string[] = []
    const entries: string[] = []
    for (const id of referenced) {
      const component = await readRenderComponent(id)
      if (!component) continue
      const fileName = id.replace(/[^a-zA-Z0-9_-]/g, '_')
      const importName = `component_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`
      await writeFile(path.join(customDir, `${fileName}.js`), component.bundle, 'utf8')
      imports.push(`import * as ${importName} from './${fileName}.js'`)
      entries.push(`  '${id}': ${importName},`)
    }
    const registry = [
      '/* eslint-disable */',
      '// Generated for one render and removed afterwards.',
      ...imports,
      'export const customComponentRegistry: Record<string, { default?: unknown }> = {',
      ...entries,
      '}',
      '',
    ].join('\n')
    const entryPath = path.join(customDir, 'index.ts')
    await writeFile(entryPath, registry, 'utf8')
    return { dir: customDir, entryPath }
  } catch (error) {
    await removeTransientDir(customDir, 'custom component registry', error)
    throw error
  }
}

export async function renderV2RemotionTimeline(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot?: string
  outputDir: string
  outputName?: string
  authorizedDraftComponentIds?: readonly string[]
  authorizedPreviewComponentIds?: readonly string[]
  recordComponentOutcomes?: boolean
  /** Evaluation-only range rendering; production callers omit it. */
  frameRange?: { startFrame: number; endFrame: number }
}): Promise<V2TimelineRenderResult> {
  const spec = assertValidRemotionTimelineSpec(input.spec)
  const componentIds = referencedComponentIds(spec)
  const componentIssues = await validateRenderComponentReferences(
    timelineRenderComponentReferences(spec),
    new Set(input.authorizedDraftComponentIds),
    spec.canvas,
    new Set(input.authorizedPreviewComponentIds),
  )
  if (componentIssues.length) throw new Error(`Invalid custom render component reference: ${componentIssues.join('; ')}`)
  const remotionRoot = resolveFromCwd(input.remotionRoot ?? '../remotion')
  const outputDir = resolveFromCwd(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  const publicAssetDir = await createStagedPublicAssetDir(remotionRoot, spec.task_id)
  let operationError: unknown
  try {
    const renderSpec = await stageLocalAssetsForRemotion({ spec, remotionRoot, publicDir: publicAssetDir })

    const propsPath = path.join(outputDir, 'remotion-timeline-props.json')
    const outputPath = path.join(outputDir, input.outputName ?? `${spec.task_id}.mp4`)
    await writeFile(propsPath, `${JSON.stringify(renderSpec, null, 2)}\n`, 'utf8')

    const args = [
      path.join(remotionRoot, 'scripts', 'render-timeline-video.mjs'),
      '--props',
      propsPath,
      '--out',
      outputPath,
      '--composition-id',
      'V2TimelineVideo',
    ]
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE?.trim()
    if (browserExecutable) args.push('--browser-executable', browserExecutable)
    if (input.frameRange) {
      args.push('--frame-start', String(input.frameRange.startFrame))
      args.push('--frame-end', String(input.frameRange.endFrame))
    }

    const customRegistry = await createCustomComponentRegistry({ spec: renderSpec, remotionRoot })
    args.push('--custom-components-registry', customRegistry.entryPath)
    let result
    let commandError: unknown
    try {
      result = await runCommand(commandForNode(), args, remotionRoot)
    } catch (error) {
      commandError = error
      const message = error instanceof Error ? error.message : String(error)
      if (input.recordComponentOutcomes !== false) {
        for (const id of componentIds) {
          if (message.includes(id)) await markRenderFailed(id)
        }
      }
      throw error
    } finally {
      await removeTransientDir(customRegistry.dir, 'custom registry', commandError)
    }
    const file = await stat(outputPath)
    if (input.recordComponentOutcomes !== false) {
      for (const id of componentIds) {
        await markRenderSucceeded(id)
      }
    }
    return {
      propsPath,
      outputPath,
      summaryPath: path.join(outputDir, 'timeline-render-summary.json'),
      fileSizeBytes: file.size,
      command: [commandForNode(), ...args],
      log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    await removeTransientDir(publicAssetDir, 'staged public assets', operationError)
  }
}
