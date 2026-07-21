import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MIN_RENDER_BYTES = 1024

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  r_frame_rate?: string
  nb_frames?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
    size?: string
  }
}

export interface RenderOutputQualityReport {
  ok: boolean
  outputPath?: string
  fileSizeBytes?: number
  expectedDurationSec?: number
  actualDurationSec?: number
  durationDeltaSec?: number
  width?: number
  height?: number
  warnings: string[]
  errors: string[]
}

export interface RenderOutputQualityInput {
  outputPath?: string
  expectedDurationSec?: number
}

function resolveFfprobePath(): string {
  const candidates = [
    process.env.FFPROBE_PATH,
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe',
    ),
    path.resolve(
      process.cwd(),
      '../remotion/node_modules/@remotion/compositor-linux-x64-gnu/ffprobe',
    ),
  ].filter((item): item is string => Boolean(item))
  return candidates.find((candidate) => existsSync(candidate)) ?? 'ffprobe'
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function durationTolerance(expectedDurationSec: number): number {
  return Math.max(1, expectedDurationSec * 0.15)
}

async function probeMedia(outputPath: string): Promise<FfprobeOutput> {
  const { stdout } = await execFileAsync(resolveFfprobePath(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size',
    '-show_entries',
    'stream=codec_type,width,height,r_frame_rate,nb_frames',
    '-of',
    'json',
    outputPath,
  ])
  return JSON.parse(stdout) as FfprobeOutput
}

export async function inspectRenderedOutput(
  input: RenderOutputQualityInput,
): Promise<RenderOutputQualityReport> {
  const report: RenderOutputQualityReport = {
    ok: false,
    outputPath: input.outputPath,
    expectedDurationSec: input.expectedDurationSec,
    warnings: [],
    errors: [],
  }

  if (!input.outputPath) {
    report.errors.push('render output path is missing')
    return report
  }

  try {
    const file = await stat(input.outputPath)
    report.fileSizeBytes = file.size
    if (!file.isFile()) {
      report.errors.push('render output path is not a file')
    }
    if (file.size < MIN_RENDER_BYTES) {
      report.errors.push(`render output is too small: ${file.size} bytes`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report.errors.push(`render output file is not readable: ${message}`)
    return report
  }

  try {
    const metadata = await probeMedia(input.outputPath)
    const duration = parsePositiveNumber(metadata.format?.duration)
    const videoStream =
      metadata.streams?.find((stream) => stream.codec_type === 'video') ??
      metadata.streams?.find((stream) => stream.width && stream.height)

    report.actualDurationSec = duration
    report.width = videoStream?.width
    report.height = videoStream?.height

    if (!videoStream) {
      report.errors.push('render output has no video stream')
    } else if (!videoStream.width || !videoStream.height) {
      report.errors.push('render output video stream has invalid dimensions')
    }

    if (!duration) {
      report.errors.push('render output duration is missing or invalid')
    } else if (input.expectedDurationSec && input.expectedDurationSec > 0) {
      const delta = Math.abs(duration - input.expectedDurationSec)
      report.durationDeltaSec = delta
      if (delta > durationTolerance(input.expectedDurationSec)) {
        report.errors.push(
          `render output duration ${duration.toFixed(3)}s differs from expected ${input.expectedDurationSec.toFixed(3)}s`,
        )
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report.warnings.push(`ffprobe metadata check skipped: ${message}`)
  }

  report.ok = report.errors.length === 0
  return report
}

export function formatRenderOutputQualityFailure(
  report: RenderOutputQualityReport,
): string {
  const firstError = report.errors[0]
  if (!firstError) return 'render output quality check failed'
  return `render output quality check failed: ${firstError}`
}
