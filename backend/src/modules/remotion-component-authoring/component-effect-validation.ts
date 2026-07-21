import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { env } from '../../config/env.js'
import { artifactRefForPath, recordAgentTraceEvent } from '../agent-trace/writer.js'
import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import type { SceneEffects } from '../../../../shared/types/render-plan.v1.js'

export interface ComponentEffectValidationContract {
  layerKind: CapabilityLayerKind
  sample_render: 'required'
  metrics: string[]
  acceptance_criteria: string[]
}

export interface ComponentEffectValidationResult {
  ok: boolean
  skipped?: boolean
  component_id: string
  layerKind: CapabilityLayerKind
  frame_count: number
  baseline_frame: number
  frames: Array<{
    frame: number
    inspection: PngFrameStats
    output_path?: string
  }>
  metrics: Record<string, number | boolean>
  failedCriteria: string[]
  warnings: string[]
  frameArtifacts?: string[]
  report_path?: string
}

interface DecodedPng {
  width: number
  height: number
  channels: number
  pixels: Buffer
}

interface PngFrameStats {
  ok: boolean
  file_size: number
  width: number
  height: number
  samples: number
  alpha_coverage: number
  bright_coverage: number
  avg_brightness: number
  contrast: number
  avg_saturation: number
  edge_score: number
  reason?: string
}

interface FrameInspection {
  frame: number
  outputPath: string
  decoded?: DecodedPng
  stats: PngFrameStats
}

function resolveFromBackendCwd(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function commandForNpx(): string {
  if (process.platform !== 'win32') return 'npx'
  const comSpec = process.env.ComSpec
  if (comSpec) return comSpec
  return 'cmd.exe'
}

function commandArgsForNpx(args: string[]): string[] {
  return process.platform === 'win32' ? ['/d', '/s', '/c', 'npx.cmd', ...args] : args
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgsForNpx(args), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${stdout}\n${stderr}`))
    })
  })
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset)
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilterPngScanline(
  input: Buffer,
  output: Buffer,
  inputOffset: number,
  outputOffset: number,
  stride: number,
  bpp: number,
): void {
  const filter = input[inputOffset]
  const scanlineOffset = inputOffset + 1
  for (let x = 0; x < stride; x += 1) {
    const raw = input[scanlineOffset + x]
    const left = x >= bpp ? output[outputOffset + x - bpp] : 0
    const up = outputOffset >= stride ? output[outputOffset + x - stride] : 0
    const upLeft = outputOffset >= stride && x >= bpp ? output[outputOffset + x - stride - bpp] : 0
    let value = raw
    if (filter === 1) value = raw + left
    else if (filter === 2) value = raw + up
    else if (filter === 3) value = raw + Math.floor((left + up) / 2)
    else if (filter === 4) value = raw + paethPredictor(left, up, upLeft)
    output[outputOffset + x] = value & 0xff
  }
}

async function decodePng(filePath: string): Promise<DecodedPng> {
  const png = await readFile(filePath)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks: Buffer[] = []

  while (offset + 8 <= png.length) {
    const length = readUInt32(png, offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > png.length) break
    if (type === 'IHDR') {
      width = readUInt32(png, dataStart)
      height = readUInt32(png, dataStart + 4)
      bitDepth = png[dataStart + 8]
      colorType = png[dataStart + 9]
    } else if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG pixel format width=${width} height=${height} bitDepth=${bitDepth} colorType=${colorType}`)
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    unfilterPngScanline(inflated, pixels, y * (stride + 1), y * stride, stride, channels)
  }

  return { width, height, channels, pixels }
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  if (max === 0) return 0
  return (max - min) / max
}

function pixelBrightness(png: DecodedPng, pixelIndex: number): number {
  const base = pixelIndex * png.channels
  return (png.pixels[base] + png.pixels[base + 1] + png.pixels[base + 2]) / 3
}

async function inspectFrame(filePath: string): Promise<{ decoded?: DecodedPng; stats: PngFrameStats }> {
  const file = await readFile(filePath)
  try {
    const decoded = await decodePng(filePath)
    const step = Math.max(1, Math.floor((decoded.width * decoded.height) / 2200))
    let samples = 0
    let alphaSamples = 0
    let brightSamples = 0
    let brightnessSum = 0
    let saturationSum = 0
    let edgeSum = 0
    let edgeSamples = 0
    let minBrightness = 255
    let maxBrightness = 0

    for (let pixelIndex = 0; pixelIndex < decoded.width * decoded.height; pixelIndex += step) {
      const base = pixelIndex * decoded.channels
      const r = decoded.pixels[base]
      const g = decoded.pixels[base + 1]
      const b = decoded.pixels[base + 2]
      const a = decoded.channels === 4 ? decoded.pixels[base + 3] : 255
      const brightness = (r + g + b) / 3
      brightnessSum += brightness
      saturationSum += saturation(r, g, b)
      minBrightness = Math.min(minBrightness, brightness)
      maxBrightness = Math.max(maxBrightness, brightness)
      if (a > 8) alphaSamples += 1
      if (brightness > 18) brightSamples += 1

      const x = pixelIndex % decoded.width
      const y = Math.floor(pixelIndex / decoded.width)
      if (x + 1 < decoded.width && y + 1 < decoded.height) {
        const right = pixelBrightness(decoded, pixelIndex + 1)
        const down = pixelBrightness(decoded, pixelIndex + decoded.width)
        edgeSum += Math.abs(brightness - right) + Math.abs(brightness - down)
        edgeSamples += 2
      }
      samples += 1
    }

    const avgBrightness = brightnessSum / Math.max(1, samples)
    const contrast = maxBrightness - minBrightness
    const alphaCoverage = alphaSamples / Math.max(1, samples)
    const brightCoverage = brightSamples / Math.max(1, samples)
    const avgSaturation = saturationSum / Math.max(1, samples)
    const edgeScore = edgeSum / Math.max(1, edgeSamples)
    return {
      decoded,
      stats: {
        ok: alphaCoverage > 0.5 && avgBrightness > 2 && contrast > 1,
        file_size: file.length,
        width: decoded.width,
        height: decoded.height,
        samples,
        alpha_coverage: Number(alphaCoverage.toFixed(4)),
        bright_coverage: Number(brightCoverage.toFixed(4)),
        avg_brightness: Number(avgBrightness.toFixed(3)),
        contrast: Number(contrast.toFixed(3)),
        avg_saturation: Number(avgSaturation.toFixed(4)),
        edge_score: Number(edgeScore.toFixed(4)),
      },
    }
  } catch (error) {
    return {
      stats: {
        ok: file.length > 4096,
        file_size: file.length,
        width: 0,
        height: 0,
        samples: 0,
        alpha_coverage: 0,
        bright_coverage: 0,
        avg_brightness: 0,
        contrast: 0,
        avg_saturation: 0,
        edge_score: 0,
        reason: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function compareFrames(left: DecodedPng | undefined, right: DecodedPng | undefined): number {
  if (!left || !right) return 0
  if (left.width !== right.width || left.height !== right.height) return 0
  const step = Math.max(1, Math.floor((left.width * left.height) / 2600))
  let samples = 0
  let delta = 0
  for (let pixelIndex = 0; pixelIndex < left.width * left.height; pixelIndex += step) {
    const leftBase = pixelIndex * left.channels
    const rightBase = pixelIndex * right.channels
    delta +=
      Math.abs(left.pixels[leftBase] - right.pixels[rightBase]) +
      Math.abs(left.pixels[leftBase + 1] - right.pixels[rightBase + 1]) +
      Math.abs(left.pixels[leftBase + 2] - right.pixels[rightBase + 2])
    samples += 1
  }
  return Number((delta / Math.max(1, samples) / 3).toFixed(4))
}

function sampleImageDataUrl(layerKind: CapabilityLayerKind): string {
  const gridOpacity = layerKind === 'distortion' || layerKind === 'motion_driver' ? '0.78' : '0.34'
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="0.45" stop-color="#64748b"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#ffffff" stroke-width="3" opacity="${gridOpacity}"/>
    </pattern>
  </defs>
  <rect width="720" height="1280" fill="url(#g)"/>
  <rect width="720" height="1280" fill="url(#grid)"/>
  <circle cx="360" cy="640" r="210" fill="#22d3ee" opacity="0.34"/>
  <rect x="128" y="210" width="170" height="170" fill="#ef4444" opacity="0.72"/>
  <rect x="420" y="890" width="180" height="180" fill="#facc15" opacity="0.72"/>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function buildValidationProps(input: {
  componentId: string
  componentProps: Record<string, unknown>
  fallbackPreset: SceneEffects['preset']
  layerKind: CapabilityLayerKind
  withEffect: boolean
}) {
  return {
    taskId: `${input.componentId}_${input.withEffect ? 'effect_validation' : 'effect_baseline'}`,
    fps: 30,
    width: 360,
    height: 640,
    durationInFrames: 45,
    strategy: 'motion_graphics',
    assets: [
      {
        id: 'sample_asset',
        type: 'image',
        name: 'component-effect-validation.svg',
        url: sampleImageDataUrl(input.layerKind),
        source: 'system',
      },
    ],
    scenes: [
      {
        id: 'scene_effect_validation',
        sourceAnchorId: 'seg_effect_validation',
        fromFrame: 0,
        durationInFrames: 45,
        role: 'component_effect_validation',
        visual: {
          mode: 'material_clip',
          asset_id: 'sample_asset',
          material_source: 'system',
          fit: 'cover',
          visual_prompt: 'Generated component effect validation sample.',
        },
        ...(input.withEffect
          ? {
              effects: {
                preset: 'generated_component',
                component_id: input.componentId,
                props: input.componentProps,
                fallback_preset: input.fallbackPreset,
              },
            }
          : {}),
        overlays: [],
        audio: [],
      },
    ],
    transitions: [],
  }
}

async function renderStill(input: {
  propsPath: string
  outputPath: string
  frame: number
  remotionRoot: string
}): Promise<void> {
  await runCommand(
    commandForNpx(),
    [
      '--no-install',
      'remotion',
      'still',
      'src/index.ts',
      env.remotionCompositionId,
      input.outputPath,
      '--props',
      input.propsPath,
      '--frame',
      String(input.frame),
      '--overwrite',
    ],
    input.remotionRoot,
  )
}

function metricDeltas(frames: FrameInspection[], baseline: FrameInspection): Record<string, number | boolean> {
  const first = frames[0]
  const middle = frames[Math.floor(frames.length / 2)] ?? frames[0]
  const last = frames[frames.length - 1] ?? frames[0]
  let maxFrameRgbDelta = 0
  let maxBrightnessDelta = 0
  let maxSaturationDelta = 0
  let maxContrastDelta = 0
  let maxEdgeDelta = 0
  let maxCoverageDelta = 0

  for (let index = 1; index < frames.length; index += 1) {
    const prev = frames[index - 1]
    const current = frames[index]
    maxFrameRgbDelta = Math.max(maxFrameRgbDelta, compareFrames(prev?.decoded, current.decoded))
    maxBrightnessDelta = Math.max(
      maxBrightnessDelta,
      Math.abs(current.stats.avg_brightness - (prev?.stats.avg_brightness ?? current.stats.avg_brightness)),
    )
    maxSaturationDelta = Math.max(
      maxSaturationDelta,
      Math.abs(current.stats.avg_saturation - (prev?.stats.avg_saturation ?? current.stats.avg_saturation)),
    )
    maxContrastDelta = Math.max(
      maxContrastDelta,
      Math.abs(current.stats.contrast - (prev?.stats.contrast ?? current.stats.contrast)),
    )
    maxEdgeDelta = Math.max(
      maxEdgeDelta,
      Math.abs(current.stats.edge_score - (prev?.stats.edge_score ?? current.stats.edge_score)),
    )
    maxCoverageDelta = Math.max(
      maxCoverageDelta,
      Math.abs(current.stats.bright_coverage - (prev?.stats.bright_coverage ?? current.stats.bright_coverage)),
    )
  }

  return {
    all_frames_non_blank: frames.every((frame) => frame.stats.ok) && baseline.stats.ok,
    baseline_mid_rgb_delta: compareFrames(baseline.decoded, middle?.decoded),
    first_last_rgb_delta: compareFrames(first?.decoded, last?.decoded),
    max_frame_rgb_delta: Number(maxFrameRgbDelta.toFixed(4)),
    max_brightness_delta: Number(maxBrightnessDelta.toFixed(4)),
    max_saturation_delta: Number(maxSaturationDelta.toFixed(4)),
    max_contrast_delta: Number(maxContrastDelta.toFixed(4)),
    max_edge_delta: Number(maxEdgeDelta.toFixed(4)),
    max_bright_coverage_delta: Number(maxCoverageDelta.toFixed(4)),
    baseline_mid_brightness_delta: Number(Math.abs((middle?.stats.avg_brightness ?? 0) - baseline.stats.avg_brightness).toFixed(4)),
    baseline_mid_saturation_delta: Number(Math.abs((middle?.stats.avg_saturation ?? 0) - baseline.stats.avg_saturation).toFixed(4)),
    baseline_mid_contrast_delta: Number(Math.abs((middle?.stats.contrast ?? 0) - baseline.stats.contrast).toFixed(4)),
    baseline_mid_edge_delta: Number(Math.abs((middle?.stats.edge_score ?? 0) - baseline.stats.edge_score).toFixed(4)),
    baseline_mid_bright_coverage_delta: Number(Math.abs((middle?.stats.bright_coverage ?? 0) - baseline.stats.bright_coverage).toFixed(4)),
  }
}

function metric(metrics: Record<string, number | boolean>, key: string): number {
  const value = metrics[key]
  return typeof value === 'number' ? value : 0
}

function evaluateLayerKind(
  layerKind: CapabilityLayerKind,
  metrics: Record<string, number | boolean>,
): { ok: boolean; failedCriteria: string[]; warnings: string[] } {
  const failedCriteria: string[] = []
  const warnings: string[] = []
  if (metrics.all_frames_non_blank !== true) {
    failedCriteria.push('all rendered validation frames must be non-blank')
  }

  const temporalChange =
    metric(metrics, 'max_frame_rgb_delta') >= 1.5 ||
    metric(metrics, 'first_last_rgb_delta') >= 1.5
  const baselineChange = metric(metrics, 'baseline_mid_rgb_delta') >= 1.5

  if (layerKind === 'motion_driver') {
    if (!temporalChange) failedCriteria.push('motion_driver requires measurable temporal frame change')
  } else if (layerKind === 'mask_reveal') {
    if (!temporalChange && metric(metrics, 'max_bright_coverage_delta') < 0.015) {
      failedCriteria.push('mask_reveal requires temporal reveal or visible coverage change')
    }
  } else if (layerKind === 'distortion') {
    if (
      metric(metrics, 'baseline_mid_edge_delta') < 0.08 &&
      metric(metrics, 'baseline_mid_rgb_delta') < 2 &&
      metric(metrics, 'max_edge_delta') < 0.08
    ) {
      failedCriteria.push('distortion requires edge/grid displacement or visible warp delta')
    }
  } else if (layerKind === 'color_transform') {
    if (
      metric(metrics, 'baseline_mid_saturation_delta') < 0.015 &&
      metric(metrics, 'baseline_mid_brightness_delta') < 2 &&
      metric(metrics, 'max_saturation_delta') < 0.015
    ) {
      failedCriteria.push('color_transform requires measurable saturation, brightness, or color change')
    }
  } else if (layerKind === 'texture_grade' || layerKind === 'color_grade') {
    if (
      metric(metrics, 'baseline_mid_contrast_delta') < 1 &&
      metric(metrics, 'baseline_mid_brightness_delta') < 1.5 &&
      metric(metrics, 'baseline_mid_rgb_delta') < 1.5
    ) {
      failedCriteria.push(`${layerKind} requires measurable grade, texture, contrast, or brightness change`)
    }
  } else if (layerKind === 'layout') {
    if (!baselineChange && metric(metrics, 'baseline_mid_edge_delta') < 0.1) {
      failedCriteria.push('layout requires visible composition/layout change against baseline')
    }
  } else if (layerKind === 'overlay') {
    if (!baselineChange) failedCriteria.push('overlay requires visible overlay difference against baseline')
  } else if (layerKind === 'audio_driver') {
    if (!temporalChange && !baselineChange) {
      warnings.push('audio_driver validation used a silent visual fixture; no visual modulation was detected')
    }
  } else if (!temporalChange && !baselineChange) {
    failedCriteria.push('component requires measurable frame or baseline visual delta')
  }

  return {
    ok: failedCriteria.length === 0,
    failedCriteria,
    warnings,
  }
}

export async function validateComponentEffect(input: {
  componentId: string
  componentProps: Record<string, unknown>
  layerKind: CapabilityLayerKind
  fallbackPreset: SceneEffects['preset']
  validationContract?: ComponentEffectValidationContract
  componentDir: string
  debugDir: string
  taskId?: string
}): Promise<ComponentEffectValidationResult> {
  const remotionRoot = resolveFromBackendCwd(env.remotionRoot)
  const frames = [0, 22, 44]
  const baselineFrame = 22
  const outputDir =
    env.traceVerbosity === 'debug'
      ? path.join(input.debugDir, `${input.componentId}.effect-validation`)
      : path.join(input.componentDir, '.effect-validation')
  await mkdir(outputDir, { recursive: true })

  const effectPropsPath = path.join(outputDir, `${input.componentId}.effect-validation-props.json`)
  const baselinePropsPath = path.join(outputDir, `${input.componentId}.effect-validation-baseline-props.json`)
  await writeFile(
    effectPropsPath,
    `${JSON.stringify(
      buildValidationProps({
        componentId: input.componentId,
        componentProps: input.componentProps,
        fallbackPreset: input.fallbackPreset,
        layerKind: input.layerKind,
        withEffect: true,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeFile(
    baselinePropsPath,
    `${JSON.stringify(
      buildValidationProps({
        componentId: input.componentId,
        componentProps: input.componentProps,
        fallbackPreset: input.fallbackPreset,
        layerKind: input.layerKind,
        withEffect: false,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )

  const renderedFrames: FrameInspection[] = []
  const frameArtifacts: string[] = []
  const baselineOutputPath = path.join(outputDir, `${input.componentId}.baseline-${baselineFrame}.png`)
  await renderStill({
    propsPath: baselinePropsPath,
    outputPath: baselineOutputPath,
    frame: baselineFrame,
    remotionRoot,
  })
  const baselineInspection = await inspectFrame(baselineOutputPath)
  const baseline: FrameInspection = {
    frame: baselineFrame,
    outputPath: baselineOutputPath,
    decoded: baselineInspection.decoded,
    stats: baselineInspection.stats,
  }
  if (env.traceVerbosity === 'debug') frameArtifacts.push(baselineOutputPath)

  for (const frame of frames) {
    const outputPath = path.join(outputDir, `${input.componentId}.frame-${String(frame).padStart(3, '0')}.png`)
    await renderStill({
      propsPath: effectPropsPath,
      outputPath,
      frame,
      remotionRoot,
    })
    const inspection = await inspectFrame(outputPath)
    renderedFrames.push({
      frame,
      outputPath,
      decoded: inspection.decoded,
      stats: inspection.stats,
    })
    if (env.traceVerbosity === 'debug') frameArtifacts.push(outputPath)
  }

  const metrics = metricDeltas(renderedFrames, baseline)
  const evaluation = evaluateLayerKind(input.layerKind, metrics)
  const result: ComponentEffectValidationResult = {
    ok: evaluation.ok,
    component_id: input.componentId,
    layerKind: input.layerKind,
    frame_count: frames.length,
    baseline_frame: baselineFrame,
    frames: renderedFrames.map((frame) => ({
      frame: frame.frame,
      inspection: frame.stats,
      ...(env.traceVerbosity === 'debug' ? { output_path: frame.outputPath } : {}),
    })),
    metrics,
    failedCriteria: evaluation.failedCriteria,
    warnings: evaluation.warnings,
    ...(env.traceVerbosity === 'debug' ? { frameArtifacts } : {}),
  }

  if (env.traceVerbosity === 'debug') {
    const reportPath = path.join(outputDir, `${input.componentId}.effect-validation.json`)
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    result.report_path = reportPath
    if (input.taskId) {
      const taskId = input.taskId
      const artifactRefs = await Promise.all([
        artifactRefForPath({
          taskId,
          path: reportPath,
          label: path.basename(reportPath),
        }),
        ...frameArtifacts.map((artifactPath) =>
          artifactRefForPath({
            taskId,
            path: artifactPath,
            label: path.basename(artifactPath),
            kind: 'image' as const,
          }),
        ),
      ])
      await recordAgentTraceEvent({
        taskId,
        phase: 'component_authoring',
        actor: 'renderer',
        event: 'artifact',
        status: result.ok ? 'success' : 'warning',
        summary: `Component effect validation ${result.ok ? 'passed' : 'failed'}: ${input.componentId}`,
        artifactRefs,
        data: {
          layerKind: input.layerKind,
          metrics,
          failedCriteria: evaluation.failedCriteria,
        },
      })
    }
  }

  return result
}
