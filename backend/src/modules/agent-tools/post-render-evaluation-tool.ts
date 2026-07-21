import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inflateSync } from 'node:zlib'

import type { RenderEffectLayer, RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import type { RenderOutputQualityReport } from '../render-engine/render-output-quality.js'

const execFileAsync = promisify(execFile)

interface MediaProbe {
  duration_sec?: number
  width?: number
  height?: number
  fps?: number
}

export interface PostRenderEvaluationReport {
  schema_version: 'post_render_evaluation.v1'
  task_id: string
  created_at: string
  inputs: {
    sample_video_url?: string
    output_path?: string
    render_plan_revision?: number
  }
  media: {
    sample?: MediaProbe
    output?: MediaProbe
    quality_gate: RenderOutputQualityReport
  }
  metrics: {
    material_usage_rate: number
    unique_material_assets_used: number
    total_material_assets: number
    unused_material_asset_ids: string[]
    scene_count: number
    avg_scene_duration_sec: number
    scene_switch_density_per_10s: number
    transition_count: number
    transition_non_cut_coverage_rate: number
    transition_types: Record<string, number>
    visual_modes: Record<string, number>
    solid_bg_scene_rate: number
    effect_layer_count: number
    effect_layers_by_source: Record<string, number>
    effect_layers_by_kind: Record<string, number>
    generated_component_scene_coverage_rate: number
    generated_component_layer_count: number
    generated_component_ids: string[]
    dominant_generated_component_id?: string
    dominant_generated_component_scene_coverage_rate?: number
    sample_output_duration_delta_sec?: number
    sample_keyframe_min_rgb_delta?: number
    sample_keyframe_avg_rgb_delta?: number
    output_keyframe_min_rgb_delta?: number
    output_keyframe_avg_rgb_delta?: number
  }
  keyframe_comparison: Array<{
    time_sec: number
    sample_frame_path?: string
    output_frame_path?: string
  }>
  warnings: string[]
  recommendations: string[]
}

export interface PostRenderEvaluationInput {
  taskId: string
  renderPlan: RenderPlanV1
  outputPath?: string
  sampleVideoUrl?: string
  quality: RenderOutputQualityReport
  artifactDir: string
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function resolveExecutable(name: 'ffmpeg' | 'ffprobe'): string {
  const envKey = name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
  const platformBinary = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = [
    process.env[envKey],
    path.resolve(
      process.cwd(),
      `../remotion/node_modules/@remotion/compositor-win32-x64-msvc/${platformBinary}`,
    ),
    path.resolve(
      process.cwd(),
      `../remotion/node_modules/@remotion/compositor-linux-x64-gnu/${name}`,
    ),
    name,
  ].filter((item): item is string => Boolean(item))
  return candidates.find((candidate) => candidate === name || existsSync(candidate)) ?? name
}

function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined
  const [left, right] = value.split('/').map(Number)
  if (!Number.isFinite(left)) return undefined
  if (!right) return left
  return right > 0 ? left / right : undefined
}

async function probeMedia(filePath: string | undefined): Promise<MediaProbe | undefined> {
  if (!filePath || !existsSync(filePath)) return undefined
  const { stdout } = await execFileAsync(resolveExecutable('ffprobe'), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-show_entries',
    'stream=codec_type,width,height,r_frame_rate',
    '-of',
    'json',
    filePath,
  ])
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      r_frame_rate?: string
    }>
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const duration = Number(parsed.format?.duration)
  return {
    ...(Number.isFinite(duration) && duration > 0 ? { duration_sec: duration } : {}),
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
    ...(parseRate(video?.r_frame_rate) ? { fps: parseRate(video?.r_frame_rate) } : {}),
  }
}

function resolveLocalVideoPath(value: string | undefined): string | undefined {
  if (!value || /^(https?:|data:|blob:)/i.test(value)) return undefined
  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value)
    } catch {
      return undefined
    }
  }
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function selectKeyframeTimes(durationSec: number | undefined): number[] {
  const duration = durationSec && durationSec > 0 ? durationSec : 30
  const raw = [2, duration * 0.28, duration * 0.58, duration * 0.86]
  const unique = new Set<number>()
  for (const value of raw) {
    const clamped = Math.max(0.5, Math.min(duration - 0.5, value))
    unique.add(Number(clamped.toFixed(2)))
  }
  return [...unique].sort((left, right) => left - right)
}

async function extractFrame(input: {
  videoPath: string | undefined
  timeSec: number
  outputPath: string
}): Promise<string | undefined> {
  if (!input.videoPath || !existsSync(input.videoPath)) return undefined
  await execFileAsync(resolveExecutable('ffmpeg'), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(input.timeSec),
    '-i',
    input.videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=360:-1',
    input.outputPath,
  ])
  return input.outputPath
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

async function pngFrameVector(filePath: string | undefined, gridSize = 32): Promise<Buffer | undefined> {
  if (!filePath || !existsSync(filePath)) return undefined
  const bytes = await readFile(filePath)
  if (bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    return undefined
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks: Buffer[] = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > bytes.length) return undefined
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
  if (!width || !height || bitDepth !== 8 || !idatChunks.length) return undefined

  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!bytesPerPixel) return undefined

  const inflated = inflateSync(Buffer.concat(idatChunks))
  const stride = width * bytesPerPixel
  const rows = Buffer.alloc(stride * height)
  let inputOffset = 0
  let previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset]
    inputOffset += 1
    const current = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset + x]!
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel]! : 0
      const up = previous[x]!
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel]! : 0
      const value =
        filter === 0
          ? raw
          : filter === 1
            ? raw + left
            : filter === 2
              ? raw + up
              : filter === 3
                ? raw + Math.floor((left + up) / 2)
                : filter === 4
                  ? raw + paethPredictor(left, up, upLeft)
                  : raw
      current[x] = value & 0xff
    }
    current.copy(rows, y * stride)
    previous = current
    inputOffset += stride
  }

  const vector = Buffer.alloc(gridSize * gridSize * 3)
  let vectorOffset = 0
  for (let gy = 0; gy < gridSize; gy += 1) {
    const y = Math.min(height - 1, Math.floor(((gy + 0.5) / gridSize) * height))
    for (let gx = 0; gx < gridSize; gx += 1) {
      const x = Math.min(width - 1, Math.floor(((gx + 0.5) / gridSize) * width))
      const pixelOffset = y * stride + x * bytesPerPixel
      if (colorType === 0) {
        const gray = rows[pixelOffset]!
        vector[vectorOffset++] = gray
        vector[vectorOffset++] = gray
        vector[vectorOffset++] = gray
      } else {
        vector[vectorOffset++] = rows[pixelOffset]!
        vector[vectorOffset++] = rows[pixelOffset + 1]!
        vector[vectorOffset++] = rows[pixelOffset + 2]!
      }
    }
  }
  return vector
}

function frameDelta(left: Buffer, right: Buffer): number {
  const length = Math.min(left.length, right.length)
  if (length === 0) return 0
  let total = 0
  for (let index = 0; index < length; index += 1) {
    total += Math.abs(left[index]! - right[index]!)
  }
  return total / length
}

function keyframeDeltaStats(vectors: Array<Buffer | undefined>):
  | {
      min: number
      avg: number
    }
  | undefined {
  const deltas: number[] = []
  for (let index = 1; index < vectors.length; index += 1) {
    const previous = vectors[index - 1]
    const current = vectors[index]
    if (!previous || !current) continue
    deltas.push(frameDelta(previous, current))
  }
  if (!deltas.length) return undefined
  return {
    min: Number(Math.min(...deltas).toFixed(3)),
    avg: Number((deltas.reduce((total, item) => total + item, 0) / deltas.length).toFixed(3)),
  }
}

function allEffectLayers(plan: RenderPlanV1): Array<{ sceneId: string; layer: RenderEffectLayer }> {
  return plan.scenes.flatMap((scene) =>
    (scene.effect_layers ?? []).map((layer) => ({ sceneId: scene.id, layer })),
  )
}

function generatedComponentId(layer: RenderEffectLayer): string | undefined {
  const effects = layer.effects as { component_id?: unknown; preset?: unknown }
  if (layer.preset === 'generated_component' && typeof effects.component_id === 'string') {
    return effects.component_id
  }
  if (layer.plugin_id.startsWith('gen_cap_')) return layer.plugin_id
  return undefined
}

function buildRecommendations(warnings: string[]): string[] {
  const recommendations: string[] = []
  if (warnings.some((warning) => warning.includes('material_usage_rate'))) {
    recommendations.push('素材使用不足时，优先调整素材分配/镜头规划，不要直接增加新组件。')
  }
  if (warnings.some((warning) => warning.includes('transition_non_cut_coverage_rate'))) {
    recommendations.push('转场覆盖不足时，优先检查 effect composition 是否把样例转场意图落实到 RenderPlan。')
  }
  if (warnings.some((warning) => warning.includes('dominant_generated_component'))) {
    recommendations.push('单一生成组件覆盖过广时，应回到 gap_report，将能力缺口拆成更小的效果能力。')
  }
  if (warnings.some((warning) => warning.includes('solid_bg_scene_rate'))) {
    recommendations.push('纯背景镜头比例过高时，应优先检查素材 staging 和 RenderPlan 自动修复记录。')
  }
  if (warnings.some((warning) => warning.includes('output_keyframe'))) {
    recommendations.push('输出关键帧变化不足时，应检查长段效果层是否复用同一组素材或同一组布局参数。')
  }
  if (recommendations.length === 0) {
    recommendations.push('主要结构指标未触发硬性告警，下一步应结合关键帧审查视觉相似度。')
  }
  return recommendations
}

export async function evaluateRenderedVideo(
  input: PostRenderEvaluationInput,
): Promise<PostRenderEvaluationReport> {
  await mkdir(input.artifactDir, { recursive: true })

  const nonAudioAssets = input.renderPlan.assets.filter((asset) => asset.type !== 'audio')
  const userMaterialAssets = nonAudioAssets.filter((asset) => asset.source === 'user_material')
  const materialAssets = userMaterialAssets.length ? userMaterialAssets : nonAudioAssets
  const materialAssetIds = new Set(materialAssets.map((asset) => asset.id))
  const usedMaterialAssetIds = new Set(
    input.renderPlan.scenes
      .map((scene) => scene.visual.asset_id)
      .filter((assetId): assetId is string => Boolean(assetId && materialAssetIds.has(assetId))),
  )
  const unusedMaterialAssetIds = [...materialAssetIds].filter(
    (assetId) => !usedMaterialAssetIds.has(assetId),
  )

  const transitions = input.renderPlan.transitions ?? []
  const transitionTypes = transitions.map((transition) => transition.presentation ?? 'unknown')
  const nonCutTransitions = transitionTypes.filter((type) => type !== 'cut')
  const visualModes = countBy(input.renderPlan.scenes.map((scene) => scene.visual.mode))
  const solidBgSceneRate =
    input.renderPlan.scenes.length > 0
      ? (visualModes.solid_bg ?? 0) / input.renderPlan.scenes.length
      : 0
  const effectLayers = allEffectLayers(input.renderPlan)
  const generatedLayers = effectLayers
    .map(({ sceneId, layer }) => ({ sceneId, componentId: generatedComponentId(layer) }))
    .filter((item): item is { sceneId: string; componentId: string } => Boolean(item.componentId))
  const generatedComponentIds = [...new Set(generatedLayers.map((item) => item.componentId))]
  const generatedSceneIds = new Set(generatedLayers.map((item) => item.sceneId))
  const generatedByComponent = countBy(generatedLayers.map((item) => item.componentId))
  const dominantGenerated = Object.entries(generatedByComponent).sort((a, b) => b[1] - a[1])[0]

  const sampleVideoPath = resolveLocalVideoPath(input.sampleVideoUrl)
  const outputPath = resolveLocalVideoPath(input.outputPath)
  const sampleProbe = await probeMedia(sampleVideoPath).catch(() => undefined)
  const outputProbe = await probeMedia(outputPath).catch(() => undefined)
  const durationSec =
    input.quality.actualDurationSec ??
    outputProbe?.duration_sec ??
    input.renderPlan.duration_sec
  const keyframeTimes = selectKeyframeTimes(durationSec)
  const keyframeComparison = []
  const sampleVectors: Array<Buffer | undefined> = []
  const outputVectors: Array<Buffer | undefined> = []

  for (const [index, timeSec] of keyframeTimes.entries()) {
    const frameTag = String(index + 1).padStart(2, '0')
    const sampleFrame = await extractFrame({
      videoPath: sampleVideoPath,
      timeSec,
      outputPath: path.join(input.artifactDir, `post-render-keyframe-${frameTag}-sample.png`),
    }).catch(() => undefined)
    const outputFrame = await extractFrame({
      videoPath: outputPath,
      timeSec,
      outputPath: path.join(input.artifactDir, `post-render-keyframe-${frameTag}-output.png`),
    }).catch(() => undefined)
    sampleVectors.push(await pngFrameVector(sampleFrame).catch(() => undefined))
    outputVectors.push(await pngFrameVector(outputFrame).catch(() => undefined))
    keyframeComparison.push({
      time_sec: timeSec,
      ...(sampleFrame ? { sample_frame_path: sampleFrame } : {}),
      ...(outputFrame ? { output_frame_path: outputFrame } : {}),
    })
  }

  const materialUsageRate =
    materialAssetIds.size > 0 ? usedMaterialAssetIds.size / materialAssetIds.size : 1
  const avgSceneDuration =
    input.renderPlan.scenes.length > 0
      ? input.renderPlan.duration_sec / input.renderPlan.scenes.length
      : 0
  const dominantCoverage =
    dominantGenerated && input.renderPlan.scenes.length > 0
      ? dominantGenerated[1] / input.renderPlan.scenes.length
      : undefined
  const durationDelta =
    sampleProbe?.duration_sec && outputProbe?.duration_sec
      ? Math.abs(sampleProbe.duration_sec - outputProbe.duration_sec)
      : undefined
  const sampleKeyframeStats = keyframeDeltaStats(sampleVectors)
  const outputKeyframeStats = keyframeDeltaStats(outputVectors)

  const warnings: string[] = []
  if (materialUsageRate < 0.85) {
    warnings.push(`material_usage_rate is low: ${materialUsageRate.toFixed(3)}`)
  }
  if (transitions.length > 0 && nonCutTransitions.length / transitions.length < 0.35) {
    warnings.push(
      `transition_non_cut_coverage_rate is low: ${(nonCutTransitions.length / transitions.length).toFixed(3)}`,
    )
  }
  if (dominantCoverage !== undefined && dominantCoverage > 0.7) {
    warnings.push(
      `dominant_generated_component coverage is high: ${dominantGenerated?.[0]}=${dominantCoverage.toFixed(3)}`,
    )
  }
  if (durationDelta !== undefined && durationDelta > 1) {
    warnings.push(`sample_output_duration_delta_sec is high: ${durationDelta.toFixed(3)}`)
  }
  if (solidBgSceneRate > 0.5) {
    warnings.push(`solid_bg_scene_rate is high: ${solidBgSceneRate.toFixed(3)}`)
  }
  if (keyframeComparison.every((item) => !item.sample_frame_path || !item.output_frame_path)) {
    warnings.push('keyframe comparison frames were not fully extracted')
  }
  if (outputKeyframeStats && outputKeyframeStats.min < 5) {
    warnings.push(`output_keyframe_min_rgb_delta is low: ${outputKeyframeStats.min}`)
  }
  if (
    sampleKeyframeStats &&
    outputKeyframeStats &&
    outputKeyframeStats.avg < sampleKeyframeStats.avg * 0.45
  ) {
    warnings.push(
      `output_keyframe_avg_rgb_delta is low relative to sample: output=${outputKeyframeStats.avg}, sample=${sampleKeyframeStats.avg}`,
    )
  }

  return {
    schema_version: 'post_render_evaluation.v1',
    task_id: input.taskId,
    created_at: new Date().toISOString(),
    inputs: {
      sample_video_url: input.sampleVideoUrl,
      output_path: input.outputPath,
      render_plan_revision: input.renderPlan.plan_revision,
    },
    media: {
      ...(sampleProbe ? { sample: sampleProbe } : {}),
      ...(outputProbe ? { output: outputProbe } : {}),
      quality_gate: input.quality,
    },
    metrics: {
      material_usage_rate: Number(materialUsageRate.toFixed(3)),
      unique_material_assets_used: usedMaterialAssetIds.size,
      total_material_assets: materialAssetIds.size,
      unused_material_asset_ids: unusedMaterialAssetIds,
      scene_count: input.renderPlan.scenes.length,
      avg_scene_duration_sec: Number(avgSceneDuration.toFixed(3)),
      scene_switch_density_per_10s: Number(
        ((transitions.length / Math.max(input.renderPlan.duration_sec, 1)) * 10).toFixed(3),
      ),
      transition_count: transitions.length,
      transition_non_cut_coverage_rate:
        transitions.length > 0 ? Number((nonCutTransitions.length / transitions.length).toFixed(3)) : 0,
      transition_types: countBy(transitionTypes),
      visual_modes: visualModes,
      solid_bg_scene_rate: Number(solidBgSceneRate.toFixed(3)),
      effect_layer_count: effectLayers.length,
      effect_layers_by_source: countBy(effectLayers.map(({ layer }) => layer.source)),
      effect_layers_by_kind: countBy(effectLayers.map(({ layer }) => layer.layerKind)),
      generated_component_scene_coverage_rate:
        input.renderPlan.scenes.length > 0
          ? Number((generatedSceneIds.size / input.renderPlan.scenes.length).toFixed(3))
          : 0,
      generated_component_layer_count: generatedLayers.length,
      generated_component_ids: generatedComponentIds,
      ...(dominantGenerated ? { dominant_generated_component_id: dominantGenerated[0] } : {}),
      ...(dominantCoverage !== undefined
        ? {
            dominant_generated_component_scene_coverage_rate: Number(
              dominantCoverage.toFixed(3),
            ),
          }
        : {}),
      ...(durationDelta !== undefined
        ? { sample_output_duration_delta_sec: Number(durationDelta.toFixed(3)) }
        : {}),
      ...(sampleKeyframeStats
        ? {
            sample_keyframe_min_rgb_delta: sampleKeyframeStats.min,
            sample_keyframe_avg_rgb_delta: sampleKeyframeStats.avg,
          }
        : {}),
      ...(outputKeyframeStats
        ? {
            output_keyframe_min_rgb_delta: outputKeyframeStats.min,
            output_keyframe_avg_rgb_delta: outputKeyframeStats.avg,
          }
        : {}),
    },
    keyframe_comparison: keyframeComparison,
    warnings,
    recommendations: buildRecommendations(warnings),
  }
}

export function formatPostRenderEvaluationMarkdown(report: PostRenderEvaluationReport): string {
  const lines = [
    '# 后渲染评价',
    '',
    `task_id: ${report.task_id}`,
    '',
    '## 核心指标',
    `- 素材使用率: ${report.metrics.unique_material_assets_used}/${report.metrics.total_material_assets} (${report.metrics.material_usage_rate})`,
    `- 镜头数: ${report.metrics.scene_count}`,
    `- 镜头切换密度: ${report.metrics.scene_switch_density_per_10s}/10s`,
    `- 非硬切转场覆盖率: ${report.metrics.transition_non_cut_coverage_rate}`,
    `- 纯背景镜头比例: ${report.metrics.solid_bg_scene_rate}`,
    `- 样例关键帧平均变化: ${report.metrics.sample_keyframe_avg_rgb_delta ?? 'n/a'}`,
    `- 输出关键帧平均变化: ${report.metrics.output_keyframe_avg_rgb_delta ?? 'n/a'}`,
    `- 效果层数量: ${report.metrics.effect_layer_count}`,
    `- 生成组件覆盖率: ${report.metrics.generated_component_scene_coverage_rate}`,
    '',
    '## 告警',
    ...(report.warnings.length ? report.warnings.map((warning) => `- ${warning}`) : ['- 无硬性告警']),
    '',
    '## 建议',
    ...report.recommendations.map((item) => `- ${item}`),
    '',
    '## 关键帧',
    ...report.keyframe_comparison.map(
      (item) =>
        `- ${item.time_sec}s sample=${item.sample_frame_path ?? 'missing'} output=${item.output_frame_path ?? 'missing'}`,
    ),
  ]
  return `${lines.join('\n')}\n`
}
