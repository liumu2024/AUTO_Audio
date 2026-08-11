import { bundle, webpack } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const remotionRoot = path.resolve(__dirname, '..')

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

const propsPath = argValue('--props')
const outputPath = argValue('--out')
const compositionId = argValue('--composition-id') ?? 'V2TimelineVideo'
const browserExecutable = argValue('--browser-executable')
const customComponentsRegistry = argValue('--custom-components-registry')
const keepBundle = process.argv.includes('--keep-bundle')
const frameStart = Number(argValue('--frame-start'))
const frameEnd = Number(argValue('--frame-end'))
const frameRange = Number.isInteger(frameStart) && Number.isInteger(frameEnd)
  ? [frameStart, frameEnd]
  : undefined

if (!propsPath || !outputPath) {
  console.error(
    'Usage: node scripts/render-timeline-video.mjs --props <props.json> --out <video.mp4> [--composition-id V2TimelineVideo] [--browser-executable <path>] [--custom-components-registry <path>]',
  )
  process.exit(2)
}

const inputProps = JSON.parse(await readFile(path.resolve(propsPath), 'utf8'))
const resolvedOutputPath = path.resolve(outputPath)
const outputDir = path.dirname(resolvedOutputPath)
const bundleDir = path.join(outputDir, '.remotion-timeline-bundle')
const removeBundle = () => rm(bundleDir, {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
})

await mkdir(outputDir, { recursive: true })
await removeBundle()

let renderError
try {
const serveUrl = await bundle({
  entryPoint: path.join(remotionRoot, 'src', 'index.ts'),
  enableCaching: false,
  outDir: bundleDir,
  webpackOverride: (config) => ({
    ...config,
    plugins: customComponentsRegistry
      ? [
          ...(config.plugins ?? []),
          new webpack.NormalModuleReplacementPlugin(
            /custom-components[\\/]index$/,
            path.resolve(customComponentsRegistry),
          ),
        ]
      : config.plugins,
  }),
  onProgress: (progress) => {
    if (progress === 1) console.log('[v2-timeline-render] bundle complete')
  },
})

const composition = await selectComposition({
  serveUrl,
  id: compositionId,
  inputProps,
  browserExecutable,
  logLevel: 'warn',
})

await renderMedia({
  serveUrl,
  composition,
  inputProps,
  codec: 'h264',
  outputLocation: resolvedOutputPath,
  overwrite: true,
  pixelFormat: 'yuv420p',
  browserExecutable,
  logLevel: 'warn',
  frameRange,
  onStart: (data) => {
    console.log(`[v2-timeline-render] frames=${data.frameCount}`)
  },
  onProgress: (progress) => {
    const rendered = progress.renderedFrames
    const encoded = progress.encodedFrames
    if (rendered === 1 || rendered % 30 === 0 || progress.progress >= 1) {
      console.log(`[v2-timeline-render] rendered=${rendered} encoded=${encoded} progress=${progress.progress.toFixed(3)}`)
    }
  },
})

const file = await stat(resolvedOutputPath)
const summary = {
  composition_id: compositionId,
  output_path: resolvedOutputPath,
  file_size_bytes: file.size,
  duration_in_frames: composition.durationInFrames,
  fps: composition.fps,
  width: composition.width,
  height: composition.height,
}

await writeFile(
  path.join(outputDir, 'timeline-render-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
)
console.log(JSON.stringify(summary))
} catch (error) {
  renderError = error
  throw error
} finally {
  if (!keepBundle) {
    try {
      await removeBundle()
    } catch (cleanupError) {
      if (!renderError) throw cleanupError
      console.error(`[v2-timeline-render] bundle cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
    }
  }
}
