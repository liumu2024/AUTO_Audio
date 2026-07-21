import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../../config/env.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import {
  buildRemotionRenderProps,
  type RemotionRenderProps,
} from './render-props.js'
import { agentTraceArtifactsDir } from '../agent-trace/paths.js'
import { artifactRefForPath, recordAgentTraceEvent } from '../agent-trace/writer.js'

export interface RenderEngineOutput {
  taskId: string
  propsPath: string
  finalVideoUrl?: string
  outputPath?: string
  status: 'props_ready' | 'render_skipped' | 'rendered'
  log?: string
}

export interface RenderMediaOptions {
  outputDir?: string
  propsDir?: string
  remotionRoot?: string
  compositionId?: string
  publicBaseUrl?: string
  browserExecutable?: string
  requireRender?: boolean
  onProgress?: (event: {
    renderedFrames: number
    totalFrames: number
    progress: number
    message: string
  }) => void
}

const activeRenderProcesses = new Map<string, ChildProcess>()

function resolveFromBackendCwd(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function commandForNpx(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function commandForWindowsShell(): string {
  const comSpec = process.env.ComSpec
  if (comSpec && existsSync(comSpec)) return comSpec
  const systemCmd = 'C:\\Windows\\System32\\cmd.exe'
  return existsSync(systemCmd) ? systemCmd : 'cmd.exe'
}

function publicRenderUrl(publicBaseUrl: string, filename: string): string {
  return `${publicBaseUrl.replace(/\/$/, '')}/renders/${filename}`
}

function renderOutputFilename(id: string): string {
  return `${id}-${Date.now()}.mp4`
}

function defaultRenderPropsDir(taskId: string): string {
  return agentTraceArtifactsDir(taskId, 'render')
}

async function recordRenderPropsArtifact(taskId: string, propsPath: string): Promise<void> {
  const artifact = await artifactRefForPath({
    taskId,
    path: propsPath,
    label: path.basename(propsPath),
    kind: 'json',
    phase: 'render',
    category: 'render_input',
  })
  await recordAgentTraceEvent({
    taskId,
    phase: 'render',
    actor: 'renderer',
    event: 'artifact',
    status: 'success',
    summary: 'Remotion render props written.',
    artifactRefs: [artifact],
  })
}

function summarizeRenderProps(props: RemotionRenderProps): Record<string, unknown> {
  const visualModes = props.scenes.reduce<Record<string, number>>((counts, scene) => {
    const mode = scene.visual?.mode ?? 'unknown'
    counts[mode] = (counts[mode] ?? 0) + 1
    return counts
  }, {})
  const assetRefCount = props.scenes.reduce((total, scene) => {
    const visualRef = scene.visual?.asset_id ? 1 : 0
    const audioRefs = scene.audio.filter((audio) => audio.asset_id).length
    return total + visualRef + audioRefs
  }, 0)
  const effectLayerCount = props.scenes.reduce(
    (total, scene) => total + (scene.effectLayers?.length ?? 0),
    0,
  )

  return {
    schema_version: 'remotion_render_props_summary.v1',
    task_id: props.taskId,
    canvas: {
      width: props.width,
      height: props.height,
      fps: props.fps,
      duration_in_frames: props.durationInFrames,
    },
    counts: {
      assets: props.assets.length,
      scenes: props.scenes.length,
      transitions: props.transitions.length,
      scene_asset_refs: assetRefCount,
      effect_layers: effectLayerCount,
      component_resolution_decisions: props.componentResolution?.decisions.length ?? 0,
    },
    visual_modes: visualModes,
    asset_ids: props.assets.map((asset) => asset.id),
    transition_types: props.transitions.map((transition) => transition.presentation),
    note: 'Full render props are kept beside this file because Remotion CLI reads them directly.',
  }
}

async function recordRenderPropsSummaryArtifact(
  taskId: string,
  outputDir: string,
  props: RemotionRenderProps,
): Promise<void> {
  const summaryPath = path.join(outputDir, `${taskId}.render-props.summary.json`)
  await writeFile(summaryPath, `${JSON.stringify(summarizeRenderProps(props), null, 2)}\n`, 'utf8')
  const artifact = await artifactRefForPath({
    taskId,
    path: summaryPath,
    label: path.basename(summaryPath),
    kind: 'json',
    phase: 'render',
    category: 'summary',
  })
  await recordAgentTraceEvent({
    taskId,
    phase: 'render',
    actor: 'renderer',
    event: 'artifact',
    status: 'success',
    summary: 'Remotion render props summary written.',
    artifactRefs: [artifact],
  })
}

async function recordRenderOutput(input: {
  taskId: string
  outputPath: string
  finalVideoUrl?: string
  status: 'success' | 'warning' | 'failed'
  summary: string
  error?: Error
}): Promise<void> {
  const outputRef =
    input.status === 'success'
      ? [
          await artifactRefForPath({
            taskId: input.taskId,
            path: input.outputPath,
            label: path.basename(input.outputPath),
            kind: 'video',
            phase: 'render',
            category: 'render_output',
          }),
        ]
      : undefined
  await recordAgentTraceEvent({
    taskId: input.taskId,
    phase: 'render',
    actor: 'renderer',
    event: 'render',
    status: input.status,
    summary: input.summary,
    outputRefs: outputRef,
    data: {
      output_path: input.outputPath,
      final_video_url: input.finalVideoUrl,
    },
    error: input.error ? { message: input.error.message, stack: input.error.stack } : undefined,
  })
}

function findInstalledBrowser(): string | undefined {
  if (env.remotionBrowserExecutable) return env.remotionBrowserExecutable
  if (process.platform !== 'win32') return undefined

  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate))
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
  options: {
    taskId?: string
    onOutput?: (text: string) => void
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const quoteWindowsArg = (arg: string) =>
      /[\s&()^|<>]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
    const commandArgs =
      process.platform === 'win32'
        ? [
            '/d',
            '/c',
            [command, ...args].map(quoteWindowsArg).join(' '),
          ]
        : args
    const child = spawn(
      process.platform === 'win32' ? commandForWindowsShell() : command,
      commandArgs,
      {
        cwd,
        env: {
          ...process.env,
          ...extraEnv,
        },
        shell: false,
        windowsHide: true,
      },
    )
    if (options.taskId) {
      activeRenderProcesses.set(options.taskId, child)
    }
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      options.onOutput?.(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      options.onOutput?.(text)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (options.taskId) {
        activeRenderProcesses.delete(options.taskId)
      }
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with ${code}\n${stdout}\n${stderr}`,
        ),
      )
    })
  })
}

export function cancelRemotionRender(taskId: string): boolean {
  const child = activeRenderProcesses.get(taskId)
  if (!child) return false
  child.kill('SIGTERM')
  activeRenderProcesses.delete(taskId)
  return true
}

function parseRemotionProgress(text: string):
  | {
      renderedFrames: number
      totalFrames: number
      progress: number
      message: string
    }
  | undefined {
  const match = text.match(/Rendered\s+(\d+)\/(\d+)(?:,\s*time remaining:\s*([^\r\n]+))?/i)
  if (!match) return undefined
  const renderedFrames = Number(match[1])
  const totalFrames = Number(match[2])
  if (!Number.isFinite(renderedFrames) || !Number.isFinite(totalFrames) || totalFrames <= 0) {
    return undefined
  }
  const progress = Math.min(99, Math.max(0, (renderedFrames / totalFrames) * 100))
  const remaining = match[3]?.trim()
  return {
    renderedFrames,
    totalFrames,
    progress,
    message: remaining
      ? `已渲染 ${renderedFrames}/${totalFrames} 帧，预计剩余 ${remaining}`
      : `已渲染 ${renderedFrames}/${totalFrames} 帧`,
  }
}

function createProgressOutputHandler(
  options: RenderMediaOptions,
): (text: string) => void {
  let lastFrame = -1
  return (text) => {
    const event = parseRemotionProgress(text)
    if (!event || event.renderedFrames === lastFrame) return
    lastFrame = event.renderedFrames
    options.onProgress?.(event)
  }
}

export class RemotionRendererService {
  async prepareRenderProps(
    plan: RenderPlanV1,
    options: { outputDir?: string } = {},
  ): Promise<RenderEngineOutput> {
    const outputDir =
      options.outputDir ?? defaultRenderPropsDir(plan.task_id)
    await mkdir(outputDir, { recursive: true })

    const props = buildRemotionRenderProps(plan)
    const propsPath = path.join(outputDir, `${plan.task_id}.render-props.json`)
    await writeFile(propsPath, `${JSON.stringify(props, null, 2)}\n`, 'utf8')
    await recordRenderPropsArtifact(plan.task_id, propsPath)
    await recordRenderPropsSummaryArtifact(plan.task_id, outputDir, props)

    return {
      taskId: plan.task_id,
      propsPath,
      status: 'props_ready',
    }
  }

  async renderFromProps(
    props: RemotionRenderProps,
    options: RenderMediaOptions = {},
  ): Promise<RenderEngineOutput> {
    const propsDir =
      options.propsDir ?? defaultRenderPropsDir(props.taskId)
    await mkdir(propsDir, { recursive: true })

    const propsPath = path.join(propsDir, `${props.taskId}.render-props.json`)
    await writeFile(propsPath, `${JSON.stringify(props, null, 2)}\n`, 'utf8')
    await recordRenderPropsArtifact(props.taskId, propsPath)
    await recordRenderPropsSummaryArtifact(props.taskId, propsDir, props)
    const prepared: RenderEngineOutput = {
      taskId: props.taskId,
      propsPath,
      status: 'props_ready',
    }

    const outputDir = resolveFromBackendCwd(
      options.outputDir ?? env.renderOutputDir,
    )
    await mkdir(outputDir, { recursive: true })

    const outputFilename = renderOutputFilename(props.taskId)
    const outputPath = path.join(outputDir, outputFilename)
    const remotionRoot = resolveFromBackendCwd(
      options.remotionRoot ?? env.remotionRoot,
    )
    const compositionId = options.compositionId ?? env.remotionCompositionId
    const publicBaseUrl = options.publicBaseUrl ?? env.publicBaseUrl
    const browserExecutable = options.browserExecutable ?? findInstalledBrowser()

    try {
      const result = await runCommand(
        commandForNpx(),
        [
          '--no-install',
          'remotion',
          'render',
          'src/index.ts',
          compositionId,
          outputPath,
          '--props',
          prepared.propsPath,
          '--overwrite',
        ],
        remotionRoot,
        browserExecutable
          ? { REMOTION_BROWSER_EXECUTABLE: browserExecutable }
          : {},
        {
          taskId: props.taskId,
          onOutput: createProgressOutputHandler(options),
        },
      )

      await recordRenderOutput({
        taskId: props.taskId,
        outputPath,
        finalVideoUrl: publicRenderUrl(publicBaseUrl, outputFilename),
        status: 'success',
        summary: 'Remotion render completed.',
      })
      return {
        ...prepared,
        outputPath,
        finalVideoUrl: publicRenderUrl(publicBaseUrl, outputFilename),
        status: 'rendered',
        log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordRenderOutput({
        taskId: props.taskId,
        outputPath,
        status: options.requireRender ? 'failed' : 'warning',
        summary: options.requireRender
          ? 'Remotion render failed.'
          : 'Remotion render skipped after CLI failure.',
        error: error instanceof Error ? error : new Error(message),
      })
      if (options.requireRender) {
        throw new Error(`Remotion render failed: ${message}`)
      }
      return {
        ...prepared,
        outputPath,
        status: 'render_skipped',
        log: `Remotion CLI unavailable or failed; props are ready. ${message}`,
      }
    }
  }

  async renderMedia(
    plan: RenderPlanV1,
    options: RenderMediaOptions = {},
  ): Promise<RenderEngineOutput> {
    const propsDir =
      options.propsDir ?? defaultRenderPropsDir(plan.task_id)
    const prepared = await this.prepareRenderProps(plan, { outputDir: propsDir })
    const outputDir = resolveFromBackendCwd(
      options.outputDir ?? env.renderOutputDir,
    )
    await mkdir(outputDir, { recursive: true })

    const outputFilename = renderOutputFilename(plan.task_id)
    const outputPath = path.join(outputDir, outputFilename)
    const remotionRoot = resolveFromBackendCwd(
      options.remotionRoot ?? env.remotionRoot,
    )
    const compositionId = options.compositionId ?? env.remotionCompositionId
    const publicBaseUrl = options.publicBaseUrl ?? env.publicBaseUrl
    const browserExecutable = options.browserExecutable ?? findInstalledBrowser()

    try {
      const result = await runCommand(
        commandForNpx(),
        [
          '--no-install',
          'remotion',
          'render',
          'src/index.ts',
          compositionId,
          outputPath,
          '--props',
          prepared.propsPath,
          '--overwrite',
        ],
        remotionRoot,
        browserExecutable
          ? { REMOTION_BROWSER_EXECUTABLE: browserExecutable }
          : {},
        {
          taskId: plan.task_id,
          onOutput: createProgressOutputHandler(options),
        },
      )

      await recordRenderOutput({
        taskId: plan.task_id,
        outputPath,
        finalVideoUrl: publicRenderUrl(publicBaseUrl, outputFilename),
        status: 'success',
        summary: 'Remotion render completed.',
      })
      return {
        ...prepared,
        outputPath,
        finalVideoUrl: publicRenderUrl(publicBaseUrl, outputFilename),
        status: 'rendered',
        log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordRenderOutput({
        taskId: plan.task_id,
        outputPath,
        status: options.requireRender ? 'failed' : 'warning',
        summary: options.requireRender
          ? 'Remotion render failed.'
          : 'Remotion render skipped after CLI failure.',
        error: error instanceof Error ? error : new Error(message),
      })
      if (options.requireRender) {
        throw new Error(`Remotion render failed: ${message}`)
      }
      return {
        ...prepared,
        outputPath,
        status: 'render_skipped',
        log: `Remotion CLI unavailable or failed; props are ready. ${message}`,
      }
    }
  }
}

export const remotionRenderer = new RemotionRendererService()
