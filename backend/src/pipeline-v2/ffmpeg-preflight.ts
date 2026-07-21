import { spawn } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import { detectFfmpegBinary, type V2FfmpegKind } from './ffmpeg-binary.js'

export interface V2FfmpegPreflightCheck {
  name: 'version' | 'libx264_encoder' | 'overlay_filter' | 'mp4_overlay_smoke'
  ok: boolean
  summary: string
}

export interface V2FfmpegPreflightReport {
  schema_version: 'v2_ffmpeg_preflight.v1'
  ok: boolean
  binary: string
  kind: V2FfmpegKind
  version_line?: string
  checks: V2FfmpegPreflightCheck[]
  warnings: string[]
  errors: string[]
}

function runCommand(command: string, args: string[], cwd: string): Promise<{
  code: number | null
  stdout: string
  stderr: string
  error?: string
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        error: error.message,
      })
    })
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).find((line) => line.trim())
}

function hasListItem(output: string, token: string): boolean {
  return output.split(/\r?\n/).some((line) => line.includes(token))
}

export async function runV2FfmpegPreflight(input: {
  outputDir: string
  requireFullFfmpeg?: boolean
}): Promise<V2FfmpegPreflightReport> {
  const ffmpegInfo = detectFfmpegBinary(path.resolve(process.cwd(), '..'))
  const checks: V2FfmpegPreflightCheck[] = []
  const warnings: string[] = []
  const errors: string[] = []

  const version = await runCommand(ffmpegInfo.binary, ['-version'], process.cwd())
  const versionLine = firstLine([version.stdout, version.stderr].filter(Boolean).join('\n'))
  checks.push({
    name: 'version',
    ok: version.code === 0,
    summary: versionLine ?? version.error ?? 'ffmpeg -version did not return a version line.',
  })
  if (version.code !== 0) {
    errors.push(version.error ?? `ffmpeg -version exited with ${version.code}.`)
  }

  const encoders = await runCommand(ffmpegInfo.binary, ['-hide_banner', '-encoders'], process.cwd())
  const hasLibx264 = encoders.code === 0 && hasListItem(encoders.stdout, 'libx264')
  checks.push({
    name: 'libx264_encoder',
    ok: hasLibx264,
    summary: hasLibx264 ? 'libx264 encoder is available.' : 'libx264 encoder was not found.',
  })
  if (!hasLibx264) errors.push('FFmpeg must provide libx264 for V2 MP4 output.')

  const filters = await runCommand(ffmpegInfo.binary, ['-hide_banner', '-filters'], process.cwd())
  const hasOverlay = filters.code === 0 && hasListItem(filters.stdout, 'overlay')
  checks.push({
    name: 'overlay_filter',
    ok: hasOverlay,
    summary: hasOverlay ? 'overlay filter is available.' : 'overlay filter was not found.',
  })
  if (!hasOverlay) errors.push('FFmpeg must provide overlay filter for transparent Remotion composition.')

  const outputDir = path.resolve(input.outputDir)
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  const smokeOutput = path.join(outputDir, 'ffmpeg-preflight-smoke.mp4')
  const smoke = await runCommand(
    ffmpegInfo.binary,
    [
      '-y',
      '-hide_banner',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=64x64:d=0.2:r=10',
      '-f',
      'lavfi',
      '-i',
      'color=c=red@0.45:s=64x64:d=0.2:r=10,format=rgba',
      '-filter_complex',
      '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]',
      '-map',
      '[v]',
      '-t',
      '0.2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      smokeOutput,
    ],
    process.cwd(),
  )
  let smokeSize = 0
  try {
    smokeSize = (await stat(smokeOutput)).size
  } catch {
    smokeSize = 0
  }
  const smokeOk = smoke.code === 0 && smokeSize > 0
  const smokeFailureSummary =
    smoke.error ?? (smoke.stderr.split(/\r?\n/).slice(-6).join('\n') || 'overlay smoke failed.')
  checks.push({
    name: 'mp4_overlay_smoke',
    ok: smokeOk,
    summary: smokeOk ? `overlay smoke MP4 written (${smokeSize} bytes).` : smokeFailureSummary,
  })
  if (!smokeOk) errors.push('FFmpeg failed the minimal overlay MP4 smoke test.')

  if (ffmpegInfo.kind === 'remotion_bundled') {
    warnings.push('Using Remotion bundled FFmpeg; production V2 runs should use a full system FFmpeg.')
    if (input.requireFullFfmpeg) errors.push('A full FFmpeg is required for this run, but only Remotion bundled FFmpeg was found.')
  }
  if (ffmpegInfo.kind === 'unknown') {
    warnings.push('FFmpeg binary source is unknown; set FFMPEG_BIN when media behavior must be reproducible.')
    if (input.requireFullFfmpeg) errors.push('A known full FFmpeg is required for this run.')
  }

  return {
    schema_version: 'v2_ffmpeg_preflight.v1',
    ok: errors.length === 0,
    binary: ffmpegInfo.binary,
    kind: ffmpegInfo.kind,
    version_line: versionLine,
    checks,
    warnings,
    errors,
  }
}
