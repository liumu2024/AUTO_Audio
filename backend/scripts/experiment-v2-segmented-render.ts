import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import { generateEvaluationMediaFixtures } from '../src/evaluation-v2/evaluation-media-fixtures.js'
import { renderV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-renderer.js'

type ChangeKind = 'subtitle' | 'transition' | 'scene' | 'timing' | 'structure'

function elapsed(startedAt: number) {
  return Number(((performance.now() - startedAt) / 1_000).toFixed(3))
}

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
}

function probeDuration(file: string): number {
  return Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim())
}

function probeStreams(file: string) {
  const parsed = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-of', 'json', file,
  ], { encoding: 'utf8' })) as {
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
      duration?: string
    }>
  }
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
  const audio = parsed.streams?.filter((stream) => stream.codec_type === 'audio') ?? []
  const fpsValue = (value = '0/1') => {
    const [numerator, denominator] = value.split('/').map(Number)
    return Number(((numerator ?? 0) / (denominator || 1)).toFixed(6))
  }
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    averageFps: fpsValue(video?.avg_frame_rate),
    nominalFps: fpsValue(video?.r_frame_rate),
    audioStreams: audio.length,
    audioDurationSec: Number(audio[0]?.duration ?? 0),
  }
}

function visualSsim(reference: string, candidate: string): number {
  const compared = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-i', reference, '-i', candidate,
    '-lavfi', '[0:v][1:v]ssim=shortest=1', '-f', 'null', '-',
  ], { encoding: 'utf8' })
  if (compared.status !== 0) throw new Error(compared.stderr || 'FFmpeg SSIM comparison failed.')
  const value = /All:([0-9.]+)/u.exec(compared.stderr)?.[1]
  if (!value) throw new Error('FFmpeg SSIM output did not contain an aggregate score.')
  return Number(value)
}

function experimentSpec(input: {
  taskId: string
  durationSec: number
  width: number
  height: number
  fps: number
  video: string
  image: string
}): RemotionTimelineSpecV1 {
  const spec = createRemotionTimelineFixture({
    taskId: input.taskId,
    mainVideoSrc: input.video,
    imageSrc: input.image,
    durationSec: input.durationSec,
    width: input.width,
    height: input.height,
    fps: input.fps,
  })
  const segment = input.durationSec / 3
  spec.scenes = spec.scenes.map((scene, index) => ({
    ...scene,
    type: 'remotion_card' as const,
    start_sec: index * segment,
    duration_sec: index === 2 ? input.durationSec - segment * 2 : segment,
    asset_id: undefined,
    title: `Segment ${index + 1}`,
    subtitle: `Baseline ${index + 1}`,
  }))
  spec.transitions = [
    { id: 'transition_001', from_scene_id: 'scene_001', to_scene_id: 'scene_002', type: 'fade', duration_sec: 0.3 },
    { id: 'transition_002', from_scene_id: 'scene_002', to_scene_id: 'scene_003', type: 'fade', duration_sec: 0.3 },
  ]
  spec.overlays = [{
    id: 'caption_middle', type: 'caption', scene_id: 'scene_002',
    start_sec: segment + 0.2, end_sec: segment * 2 - 0.2,
    text: 'Baseline caption', x_pct: 50, y_pct: 82, width_pct: 80,
  }]
  spec.material_jobs = []
  return spec
}

function modify(spec: RemotionTimelineSpecV1, kind: ChangeKind): RemotionTimelineSpecV1 {
  const next = structuredClone(spec)
  if (kind === 'subtitle') next.overlays[0]!.text = 'Changed caption'
  if (kind === 'transition') next.transitions[0] = { ...next.transitions[0]!, type: 'slide', direction: 'from-left' }
  if (kind === 'scene') next.scenes[1] = { ...next.scenes[1]!, title: 'Changed visual direction', accent_color: '#ff3366' }
  if (kind === 'timing') {
    const delta = Math.min(1, next.scenes[0]!.duration_sec / 4)
    next.scenes[0]!.duration_sec -= delta
    next.scenes[1]!.start_sec -= delta
    next.scenes[1]!.duration_sec += delta
  }
  if (kind === 'structure') {
    const target = next.scenes[1]!
    const firstDuration = target.duration_sec / 2
    target.duration_sec = firstDuration
    next.scenes.splice(2, 0, {
      ...target,
      id: 'scene_inserted',
      start_sec: target.start_sec + firstDuration,
      duration_sec: firstDuration,
      title: 'Inserted structure segment',
    })
    if (next.overlays[0]) next.overlays[0].end_sec = target.start_sec + firstDuration - 0.2
    next.transitions = [
      { id: 'transition_001', from_scene_id: 'scene_001', to_scene_id: 'scene_002', type: 'fade', duration_sec: 0.3 },
      { id: 'transition_inserted', from_scene_id: 'scene_002', to_scene_id: 'scene_inserted', type: 'fade', duration_sec: 0.3 },
      { id: 'transition_002', from_scene_id: 'scene_inserted', to_scene_id: 'scene_003', type: 'fade', duration_sec: 0.3 },
    ]
  }
  return next
}

async function renderTimed(spec: RemotionTimelineSpecV1, outputDir: string, name: string) {
  const startedAt = performance.now()
  const result = await renderV2RemotionTimeline({ spec, outputDir, outputName: name, recordComponentOutcomes: false })
  return { seconds: elapsed(startedAt), path: result.outputPath }
}

async function runSegmentedWithFullFallback<T>(input: {
  runSegmented: () => Promise<T>
  runFull: () => ReturnType<typeof renderTimed>
}) {
  try {
    return { segmentedCompleted: true as const, result: await input.runSegmented() }
  } catch (error) {
    return {
      segmentedCompleted: false as const,
      segmentedFailure: error instanceof Error ? error.message : String(error),
      full: await input.runFull(),
    }
  }
}

async function verifyFullRenderFallback(input: {
  base: RemotionTimelineSpecV1
  modified: RemotionTimelineSpecV1
  kind: ChangeKind
  outputDir: string
}) {
  const missingBaseline = path.join(input.outputDir, 'missing-baseline.mp4')
  const attempt = await runSegmentedWithFullFallback({
    runSegmented: () => representativeSegmentPrototype({
      base: input.base,
      modified: input.modified,
      kind: input.kind,
      baselinePath: missingBaseline,
      fullModifiedPath: missingBaseline,
      outputDir: path.join(input.outputDir, 'segmented'),
    }),
    runFull: () => renderTimed(input.modified, path.join(input.outputDir, 'full'), 'fallback-full.mp4'),
  })
  if (attempt.segmentedCompleted) throw new Error('The forced segmented failure probe unexpectedly succeeded.')
  return {
    segmentedFailure: attempt.segmentedFailure,
    fullRenderCompleted: existsSync(attempt.full.path) && probeDuration(attempt.full.path) > 0,
    providerPathReachable: input.modified.material_jobs.length > 0,
  }
}

function invalidatedWindow(
  base: RemotionTimelineSpecV1,
  modified: RemotionTimelineSpecV1,
  kind: ChangeKind,
) {
  const ids = kind === 'transition' || kind === 'timing'
    ? ['scene_001', 'scene_002']
    : kind === 'structure'
      ? ['scene_002', 'scene_inserted']
      : ['scene_002']
  const scenes = [...base.scenes, ...modified.scenes].filter((scene) => ids.includes(scene.id))
  return {
    startSec: Math.min(...scenes.map((scene) => scene.start_sec)),
    endSec: Math.max(...scenes.map((scene) => scene.start_sec + scene.duration_sec)),
  }
}

async function representativeSegmentPrototype(input: {
  base: RemotionTimelineSpecV1
  modified: RemotionTimelineSpecV1
  kind: ChangeKind
  baselinePath: string
  fullModifiedPath: string
  outputDir: string
}) {
  const window = invalidatedWindow(input.base, input.modified, input.kind)
  const startFrame = Math.floor(window.startSec * input.modified.canvas.fps)
  const endFrame = Math.ceil(window.endSec * input.modified.canvas.fps) - 1
  const segmentStart = startFrame / input.modified.canvas.fps
  const segmentEnd = (endFrame + 1) / input.modified.canvas.fps
  const startedAt = performance.now()
  const range = await renderV2RemotionTimeline({
    spec: input.modified,
    outputDir: path.join(input.outputDir, 'range'),
    outputName: 'changed-range.mp4',
    frameRange: { startFrame, endFrame },
    recordComponentOutcomes: false,
  })
  const prefix = path.join(input.outputDir, 'prefix.mp4')
  const changed = path.join(input.outputDir, 'changed-normalized.mp4')
  const suffix = path.join(input.outputDir, 'suffix.mp4')
  const stitched = path.join(input.outputDir, 'stitched.mp4')
  const normalize = [
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(input.modified.canvas.fps),
    '-c:a', 'aac', '-ar', '48000',
  ]
  const parts: string[] = []
  if (startFrame > 0) {
    ffmpeg(['-i', input.baselinePath, '-t', String(segmentStart), ...normalize, prefix])
    parts.push(prefix)
  }
  ffmpeg(['-i', range.outputPath, ...normalize, changed])
  parts.push(changed)
  const totalFrames = Math.round(input.modified.canvas.duration_sec * input.modified.canvas.fps)
  if (endFrame < totalFrames - 1) {
    ffmpeg(['-ss', String(segmentEnd), '-i', input.baselinePath, ...normalize, suffix])
    parts.push(suffix)
  }
  const concatFile = path.join(input.outputDir, 'concat.txt')
  writeFileSync(concatFile, parts.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'))
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', stitched])
  const durationDelta = Math.abs(probeDuration(stitched) - probeDuration(input.fullModifiedPath))
  const referenceStreams = probeStreams(input.fullModifiedPath)
  const candidateStreams = probeStreams(stitched)
  const ssim = visualSsim(input.fullModifiedPath, stitched)
  const audioDurationDelta = Math.abs(referenceStreams.audioDurationSec - candidateStreams.audioDurationSec)
  const streamShape = (value: typeof referenceStreams) => ({
    width: value.width,
    height: value.height,
    averageFps: value.averageFps,
    nominalFps: value.nominalFps,
    audioStreams: value.audioStreams,
  })
  return {
    seconds: elapsed(startedAt),
    invalidatedFrameRatio: Number(((endFrame - startFrame + 1) / Math.round(input.modified.canvas.duration_sec * input.modified.canvas.fps)).toFixed(4)),
    durationDeltaSec: Number(durationDelta.toFixed(4)),
    equivalentDuration: durationDelta <= 1 / input.modified.canvas.fps,
    visualSsim: Number(ssim.toFixed(6)),
    equivalentVisual: ssim >= 0.98,
    equivalentStreams: JSON.stringify(streamShape(referenceStreams)) === JSON.stringify(streamShape(candidateStreams)),
    streamComparison: {
      full: streamShape(referenceStreams),
      segmented: streamShape(candidateStreams),
    },
    audioDurationDeltaSec: Number(audioDurationDelta.toFixed(4)),
    equivalentAudioStreamTiming: referenceStreams.audioStreams === candidateStreams.audioStreams
      && audioDurationDelta <= 1 / input.modified.canvas.fps,
    audioWaveformCompared: false,
    audioEvidenceSufficient: referenceStreams.audioStreams === 0 && candidateStreams.audioStreams === 0,
    audioComparison: referenceStreams.audioStreams > 0
      ? 'stream_presence_and_duration_only_waveform_not_compared'
      : 'not_applicable_no_audio_stream',
  }
}

const root = mkdtempSync(path.join(os.tmpdir(), 'v2-segment-render-experiment-'))
try {
  const media = await generateEvaluationMediaFixtures(path.join(root, 'media'))
  const matrix = process.argv.includes('--matrix')
    ? [
        { durationSec: 15, width: 320, height: 180, kind: 'subtitle' as const },
        { durationSec: 15, width: 180, height: 320, kind: 'transition' as const },
        { durationSec: 30, width: 320, height: 180, kind: 'scene' as const },
        { durationSec: 30, width: 180, height: 320, kind: 'timing' as const },
        { durationSec: 45, width: 320, height: 180, kind: 'structure' as const },
      ]
    : [{ durationSec: 15, width: 320, height: 180, kind: 'subtitle' as const }]
  const results = []
  for (const [index, item] of matrix.entries()) {
    const outputDir = path.join(root, `case-${index}`)
    const base = experimentSpec({ ...item, taskId: `segment_base_${index}`, fps: 6, video: media.landscape, image: media.image })
    const modified = modify({ ...base, task_id: `segment_modified_${index}` }, item.kind)
    const baseline = await renderTimed(base, path.join(outputDir, 'base'), 'base.mp4')
    const full = await renderTimed(modified, path.join(outputDir, 'full'), 'full.mp4')
    const prototype = await representativeSegmentPrototype({
      base,
      modified,
      kind: item.kind,
      baselinePath: baseline.path,
      fullModifiedPath: full.path,
      outputDir,
    })
    results.push({ ...item, fps: 6, baselineSeconds: baseline.seconds, fullModifiedSeconds: full.seconds, prototype })
  }
  if (matrix && results.some((item) => !item.prototype)) {
    throw new Error('Every matrix change kind must execute the segmented prototype.')
  }
  const speedups = results
    .map((item) => 100 * (1 - item.prototype.seconds / item.fullModifiedSeconds))
    .sort((left, right) => left - right)
  const medianSpeedupPct = speedups[Math.floor(speedups.length / 2)] ?? 0
  const allOutputsEquivalent = results.every((item) =>
    item.prototype.equivalentDuration
    && item.prototype.equivalentVisual
    && item.prototype.equivalentStreams
    && item.prototype.equivalentAudioStreamTiming
    && item.prototype.audioEvidenceSufficient)
  const fallbackBase = experimentSpec({
      ...matrix[0]!,
      taskId: 'segment_fallback_probe',
      fps: 6,
      video: media.landscape,
      image: media.image,
    })
  const fallbackProbe = await verifyFullRenderFallback({
    base: fallbackBase,
    modified: modify({ ...fallbackBase, task_id: 'segment_fallback_modified' }, matrix[0]!.kind),
    kind: matrix[0]!.kind,
    outputDir: path.join(root, 'fallback-probe'),
  })
  if (!fallbackProbe.fullRenderCompleted) throw new Error('Forced segmented failure did not fall back to a valid full render.')
  const experimentVersion = 'v2_segmented_render_experiment.v2'
  const hashFile = (file: URL) => createHash('sha256')
    .update(readFileSync(fileURLToPath(file)))
    .digest('hex')
  const codeInputs = {
    experiment: hashFile(new URL(import.meta.url)),
    fixture: hashFile(new URL('../../shared/lib/remotion-timeline-fixtures.ts', import.meta.url)),
    mediaFixture: hashFile(new URL('../src/evaluation-v2/evaluation-media-fixtures.ts', import.meta.url)),
    renderer: hashFile(new URL('../src/pipeline-v2/remotion-timeline-renderer.ts', import.meta.url)),
    renderScript: hashFile(new URL('../../remotion/scripts/render-timeline-video.mjs', import.meta.url)),
    composition: hashFile(new URL('../../remotion/src/timeline/TimelineComposition.tsx', import.meta.url)),
    sceneRenderer: hashFile(new URL('../../remotion/src/timeline/SceneRenderer.tsx', import.meta.url)),
    backendLock: hashFile(new URL('../package-lock.json', import.meta.url)),
    remotionLock: hashFile(new URL('../../remotion/package-lock.json', import.meta.url)),
  }
  const relevantTrackedDiff = execFileSync('git', [
    'diff', '--binary', 'HEAD', '--',
    ':(top)shared/lib/remotion-timeline-fixtures.ts',
    ':(top)backend/src/evaluation-v2/evaluation-media-fixtures.ts',
    ':(top)backend/src/pipeline-v2/remotion-timeline-renderer.ts',
    ':(top)remotion/scripts/render-timeline-video.mjs',
    ':(top)remotion/src/timeline/TimelineComposition.tsx',
    ':(top)remotion/src/timeline/SceneRenderer.tsx',
    ':(top)backend/package-lock.json',
    ':(top)remotion/package-lock.json',
  ], { encoding: 'utf8' })
  const runtime = {
    node: process.version,
    ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split(/\r?\n/u)[0] ?? 'unknown',
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    gitDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    relevantTrackedDiffHash: createHash('sha256').update(relevantTrackedDiff).digest('hex'),
  }
  const matrixConfiguration = {
    experimentVersion,
    matrix,
    fps: 6,
    visualSsimThreshold: 0.98,
    durationToleranceFrames: 1,
  }
  const matrixHash = createHash('sha256').update(JSON.stringify(matrixConfiguration)).digest('hex')
  const reproducibilityHash = createHash('sha256').update(JSON.stringify({
    matrixConfiguration,
    codeInputs,
    runtime,
  })).digest('hex')
  const report = {
    experimentVersion,
    matrixHash,
    reproducibilityHash,
    codeInputs,
    runtime,
    mode: process.argv.includes('--matrix') ? 'matrix' : 'representative',
    productionChanged: false,
    providerCalls: 0,
    fallbackProbe,
    decision: {
      medianSpeedupPct: Number(medianSpeedupPct.toFixed(2)),
      allOutputsEquivalent,
      productionRecommended: allOutputsEquivalent && medianSpeedupPct >= 25,
    },
    results,
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  const reportArg = process.argv.indexOf('--report')
  if (reportArg >= 0) {
    const reportPath = process.argv[reportArg + 1]
    if (!reportPath) throw new Error('--report requires an output path.')
    mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true })
    writeFileSync(path.resolve(reportPath), serialized)
  }
  console.log(serialized)
} finally {
  rmSync(root, { recursive: true, force: true })
}
