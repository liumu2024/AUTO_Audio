import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

export async function generateEvaluationMediaFixtures(outputDir: string) {
  await mkdir(outputDir, { recursive: true })
  const landscape = path.join(outputDir, 'testcard-16x9-12fps.mp4')
  const vertical = path.join(outputDir, 'testcard-9x16-15fps.mp4')
  const square = path.join(outputDir, 'testcard-1x1-24fps.mp4')
  const image = path.join(outputDir, 'testcard-still.png')
  const tone = path.join(outputDir, 'test-tone.wav')
  const silence = path.join(outputDir, 'silence.wav')
  const corrupt = path.join(outputDir, 'corrupt.mp4')
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', landscape,
  ])
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=15:duration=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vertical])
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=240x240:rate=24:duration=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', square])
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x345678:size=320x180', '-frames:v', '1', image])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', tone])
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', silence])
  await writeFile(corrupt, Buffer.from('evaluation-corrupt-media'))
  return { landscape, vertical, square, image, tone, silence, corrupt }
}
