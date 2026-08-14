import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../config/env.js'
import { runAbortableCommand } from './abortable-command.js'
import { findV2FfmpegBinary } from './ffmpeg-binary.js'

export interface V2StandardizedVideoAsset {
  src: string
  command: string[]
  log: string
  fileSizeBytes: number
}

function resolveFromCwd(value: string, cwd = process.cwd()): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value)
}

function isRemotionBundledFfmpeg(ffmpeg: string): boolean {
  return ffmpeg.includes(`@remotion${path.sep}compositor`)
}

export async function standardizeGeneratedVideoAsset(input: {
  src: string
  assetId: string
  outputDir: string
  width?: number
  height?: number
  fps?: number
  signal?: AbortSignal
}): Promise<V2StandardizedVideoAsset> {
  const outputDir = resolveFromCwd(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${input.assetId}.standardized.mp4`)
  const width = input.width ?? env.v2GeneratedVideoWidth
  const height = input.height ?? env.v2GeneratedVideoHeight
  const fps = input.fps ?? env.v2GeneratedVideoFps
  const ffmpeg = findV2FfmpegBinary(path.resolve(process.cwd(), '..'))
  const filter = isRemotionBundledFfmpeg(ffmpeg)
    ? `scale=${width}:${height}`
    : [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        'setsar=1',
      ].join(',')
  const args = [
    '-y',
    '-i',
    input.src,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    filter,
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ]
  const result = await runAbortableCommand(ffmpeg, args, process.cwd(), input.signal)
  const file = await stat(outputPath)
  return {
    src: outputPath,
    command: [ffmpeg, ...args],
    log: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    fileSizeBytes: file.size,
  }
}
