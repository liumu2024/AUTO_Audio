import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type V2FfmpegKind = 'env' | 'system' | 'remotion_bundled' | 'unknown'

export function detectFfmpegBinary(repoRoot = path.resolve(process.cwd(), '..')): {
  binary: string
  kind: V2FfmpegKind
} {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) {
    return { binary: process.env.FFMPEG_BIN, kind: 'env' }
  }

  const systemProbe = spawnSync('ffmpeg', ['-version'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  if (!systemProbe.error && systemProbe.status === 0) {
    return { binary: 'ffmpeg', kind: 'system' }
  }

  const remotionFfmpeg = path.join(
    repoRoot,
    'remotion',
    'node_modules',
    '@remotion',
    'compositor-win32-x64-msvc',
    'ffmpeg.exe',
  )
  if (existsSync(remotionFfmpeg)) return { binary: remotionFfmpeg, kind: 'remotion_bundled' }
  return { binary: 'ffmpeg', kind: 'unknown' }
}

export function findV2FfmpegBinary(repoRoot = path.resolve(process.cwd(), '..')): string {
  return detectFfmpegBinary(repoRoot).binary
}

export function findV2FfprobeBinary(repoRoot = path.resolve(process.cwd(), '..')): string {
  const configured = process.env.FFPROBE_BIN ?? process.env.FFPROBE_PATH
  if (configured && existsSync(configured)) return configured

  const systemProbe = spawnSync('ffprobe', ['-version'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  if (!systemProbe.error && systemProbe.status === 0) return 'ffprobe'

  const candidates = [
    path.join(repoRoot, 'remotion', 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffprobe.exe'),
    path.join(repoRoot, 'remotion', 'node_modules', '@remotion', 'compositor-linux-x64-gnu', 'ffprobe'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? 'ffprobe'
}
