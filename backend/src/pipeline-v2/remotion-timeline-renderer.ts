import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

function findInstalledBrowser(): string | undefined {
  return [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
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

async function stageLocalAssetsForRemotion(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot: string
}): Promise<RemotionTimelineSpecV1> {
  const publicRelativeDir = path.posix.join('v2-assets', safePart(input.spec.task_id))
  const publicDir = path.join(input.remotionRoot, 'public', ...publicRelativeDir.split('/'))
  await mkdir(publicDir, { recursive: true })

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
    const targetPath = path.join(publicDir, fileName)
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
  const referenced = new Set<string>()
  for (const scene of spec.scenes) {
    if (scene.custom_render?.component_id) referenced.add(scene.custom_render.component_id)
  }
  for (const transition of spec.transitions) {
    if (transition.custom_render?.component_id) referenced.add(transition.custom_render.component_id)
  }
  return referenced
}

async function injectCustomComponents(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot: string
}): Promise<void> {
  const customDir = path.join(input.remotionRoot, 'src', 'timeline', 'custom-components')
  const referenced = referencedComponentIds(input.spec)

  await mkdir(customDir, { recursive: true })
  for (const file of (await readdir(customDir)).filter((name) => name !== 'index.ts')) {
    await rm(path.join(customDir, file), { force: true })
  }

  const imports: string[] = []
  const entries: string[] = []
  for (const id of referenced) {
    const component = await readRenderComponent(id)
    if (!component) continue
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
    await writeFile(path.join(customDir, `${safeId}.js`), component.bundle, 'utf8')
    imports.push(`import * as ${safeId} from './${safeId}.js'`)
    entries.push(`  '${id}': ${safeId},`)
  }
  const registry = [
    '/* eslint-disable */',
    '// Regenerated before each render. Do not edit manually.',
    ...imports,
    'export const customComponentRegistry: Record<string, { default?: unknown }> = {',
    ...entries,
    '}',
    '',
  ].join('\n')
  await writeFile(path.join(customDir, 'index.ts'), registry, 'utf8')
}

export async function renderV2RemotionTimeline(input: {
  spec: RemotionTimelineSpecV1
  remotionRoot?: string
  outputDir: string
  outputName?: string
}): Promise<V2TimelineRenderResult> {
  const spec = assertValidRemotionTimelineSpec(input.spec)
  const remotionRoot = resolveFromCwd(input.remotionRoot ?? '../remotion')
  const outputDir = resolveFromCwd(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  const renderSpec = await stageLocalAssetsForRemotion({ spec, remotionRoot })
  await injectCustomComponents({ spec: renderSpec, remotionRoot })

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
  const browserExecutable = findInstalledBrowser()
  if (browserExecutable) args.push('--browser-executable', browserExecutable)

  let result
  try {
    result = await runCommand(commandForNode(), args, remotionRoot)
  } catch (error) {
    for (const id of referencedComponentIds(renderSpec)) {
      await markRenderFailed(id)
    }
    throw error
  } finally {
    await injectCustomComponents({ spec: { ...renderSpec, scenes: [], transitions: [] }, remotionRoot })
  }
  const file = await stat(outputPath)
  for (const id of referencedComponentIds(renderSpec)) {
    await markRenderSucceeded(id)
  }
  return {
    propsPath,
    outputPath,
    summaryPath: path.join(outputDir, 'timeline-render-summary.json'),
    fileSizeBytes: file.size,
    command: [commandForNode(), ...args],
    log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
  }
}
