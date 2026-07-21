import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type {
  RemotionTimelineAsset,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'

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

  const result = await runCommand(commandForNode(), args, remotionRoot)
  const file = await stat(outputPath)
  return {
    propsPath,
    outputPath,
    summaryPath: path.join(outputDir, 'timeline-render-summary.json'),
    fileSizeBytes: file.size,
    command: [commandForNode(), ...args],
    log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
  }
}
