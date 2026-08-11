import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type {
  RemotionTimelineAsset,
  RemotionTimelineMaterialJob,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import { ensureExternallyReachableUploadUrl } from '../modules/upload/asset-publisher.js'
import { findV2FfprobeBinary } from './ffmpeg-binary.js'
import {
  v2IdempotencyRequestHash,
  type V2IdempotencyRepository,
  type V2IdempotencyReceiptRecord,
} from './idempotency-repository.js'
import { standardizeGeneratedVideoAsset } from './media-standardizer.js'
import {
  createNoopMaterialGenerationAdapter,
  type V2MaterialGenerationResult,
  type V2MaterialGenerationAdapter,
} from './material-generation-adapter.js'
import { prepareV2MaterialGenerationRequest } from './material-generation-request.js'

export interface V2TimelineMaterialResolutionReport {
  schema_version: 'v2_timeline_material_resolution.v1'
  ok: boolean
  fulfilled_jobs: string[]
  failed_jobs: Array<{
    id: string
    reason: string
  }>
  resolved_assets: RemotionTimelineAsset[]
  generation_trace: Array<{
    id: string
    scene_id: string
    type: string
    prompt?: string
    input_asset_id?: string
    input_image_url?: string
    output_asset_id?: string
    provider_task_id?: string
    request_fingerprint?: string
    output_sha256?: string
    reused_from_run_id?: string
    status: 'fulfilled' | 'fallback' | 'failed'
    elapsed_ms: number
    standardized_src?: string
    error?: string
  }>
  delivery_readiness: {
    ready: boolean
    planned_generated_scene_count: number
    resolved_generated_scene_count: number
    fallback_scene_count: number
    missing_generated_scene_ids: string[]
  }
}

const execFileAsync = promisify(execFile)

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function isReadableVideo(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(findV2FfprobeBinary(path.resolve(process.cwd(), '..')), [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1:nk=1', filePath,
    ])
    return stdout.trim() === 'video'
  } catch {
    return false
  }
}

async function copyReusableGeneratedAsset(input: {
  runId: string
  spec: RemotionTimelineSpecV1
  report: V2TimelineMaterialResolutionReport
  requestFingerprint: string
  outputAssetId: string
  outputDir?: string
}): Promise<{ asset: RemotionTimelineAsset; sha256: string } | undefined> {
  if (!input.outputDir) return undefined
  const priorTrace = input.report.generation_trace.find((trace) =>
    trace.status === 'fulfilled' &&
    trace.request_fingerprint === input.requestFingerprint &&
    Boolean(trace.output_asset_id) &&
    Boolean(trace.output_sha256),
  )
  const priorAsset = assetById(input.spec.assets, priorTrace?.output_asset_id)
  if (!priorTrace?.output_sha256 || priorAsset?.type !== 'video' || !path.isAbsolute(priorAsset.src)) return undefined
  try {
    if (await sha256File(priorAsset.src) !== priorTrace.output_sha256) return undefined
    if (!await isReadableVideo(priorAsset.src)) return undefined
    const targetDir = path.join(input.outputDir, 'timeline-reused-materials')
    await mkdir(targetDir, { recursive: true })
    const target = path.join(targetDir, `${input.outputAssetId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.mp4`)
    await copyFile(priorAsset.src, target)
    return {
      asset: convertGeneratedAsset({ id: input.outputAssetId, type: 'video', src: target, label: `Reused from ${input.runId}` }),
      sha256: priorTrace.output_sha256,
    }
  } catch {
    return undefined
  }
}

async function generateWithIdempotency(input: {
  adapter: V2MaterialGenerationAdapter
  request: Parameters<V2MaterialGenerationAdapter['generate']>[0]
  requestFingerprint: string
  jobId: string
  outputAssetId: string
  outputDir?: string
  context?: {
    repository: V2IdempotencyRepository
    userId: number
    draftId: string
    renderRunId: string
    renderKey: string
  }
}): Promise<{ generated: V2MaterialGenerationResult; receipt?: V2IdempotencyReceiptRecord }> {
  if (!input.context) {
    return {
      generated: await input.adapter.generate(input.request).catch((error: unknown) => ({
        ok: false,
        submissionState: 'not_submitted' as const,
        error: error instanceof Error ? error.message : String(error),
      })),
    }
  }
  const idempotencyKey = v2IdempotencyRequestHash({ renderKey: input.context.renderKey, jobId: input.jobId })
  const reservation = await input.context.repository.reserve({
    userId: input.context.userId,
    draftId: input.context.draftId,
    operation: 'material.generate',
    idempotencyKey,
    resourceKey: `${input.context.renderRunId}:${input.jobId}`,
    requestHash: input.requestFingerprint,
  })
  if (reservation.kind === 'replay') {
    const receipt = reservation.receipt
    if (receipt.status === 'completed' && receipt.resultRef) {
      let replaySource = receipt.resultRef
      if (input.outputDir && path.isAbsolute(receipt.resultRef)) {
        const replayDir = path.join(input.outputDir, 'timeline-idempotent-replay')
        await mkdir(replayDir, { recursive: true })
        replaySource = path.join(replayDir, `${input.outputAssetId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.mp4`)
        if (path.resolve(receipt.resultRef) !== path.resolve(replaySource)) {
          await copyFile(receipt.resultRef, replaySource)
        }
      }
      return {
        receipt,
        generated: {
          ok: true,
          submissionState: receipt.providerTaskId ? 'submitted' : 'not_submitted',
          providerTaskId: receipt.providerTaskId,
          asset: { id: input.outputAssetId, type: 'video', src: replaySource, source: 'generated_asset' },
        },
      }
    }
    return {
      receipt,
      generated: {
        ok: false,
        providerTaskId: receipt.providerTaskId,
        submissionState: receipt.providerTaskId ? 'submitted' : 'not_submitted',
        error: receipt.failure?.message ?? `Material generation is ${receipt.status}.`,
      },
    }
  }
  await input.context.repository.update({ id: reservation.receipt.id, phase: 'submitting' })
  const generated: V2MaterialGenerationResult = await input.adapter.generate(input.request, {
    onProviderTaskSubmitted: async (providerTaskId) => {
      await input.context!.repository.update({
        id: reservation.receipt.id,
        phase: 'polling',
        providerTaskId,
      })
    },
  }).catch((error: unknown) => ({
    ok: false,
    submissionState: 'not_submitted' as const,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (!generated.ok) {
    await input.context.repository.update({
      id: reservation.receipt.id,
      status: 'failed',
      providerTaskId: generated.providerTaskId,
      failure: {
        code: generated.failureCode ?? 'material_generation_failed',
        message: generated.error ?? 'Material generation failed.',
      },
    })
  }
  return { generated, receipt: reservation.receipt }
}

export interface V2TimelineMaterialProgress {
  status: 'started' | 'fulfilled' | 'fallback' | 'failed'
  jobId: string
  sceneId: string
  completed: number
  total: number
}

function assetById(assets: RemotionTimelineAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

function convertGeneratedAsset(input: {
  id: string
  type: 'video' | 'image'
  src: string
  label?: string
}): RemotionTimelineAsset {
  return {
    id: input.id,
    type: input.type,
    src: input.src,
    source: 'generated_asset',
    label: input.label,
  }
}

function fallbackAsset(input: {
  job: RemotionTimelineMaterialJob
  currentAssets: RemotionTimelineAsset[]
}): RemotionTimelineAsset | undefined {
  if (!input.job.output_asset_id) return undefined
  if (!input.job.fallback_asset_id) return undefined
  const source = assetById(input.currentAssets, input.job.fallback_asset_id)
  if (!source) return undefined
  return {
    ...source,
    id: input.job.output_asset_id,
    source: 'fallback_asset',
    label: `Fallback for ${input.job.id}`,
  }
}

async function standardizeIfVideo(input: {
  asset: RemotionTimelineAsset
  outputDir?: string
  width: number
  height: number
  fps: number
}): Promise<{
  asset: RemotionTimelineAsset
  standardizedSrc?: string
}> {
  if (input.asset.type !== 'video' || input.asset.source !== 'generated_asset' || !input.outputDir) {
    return { asset: input.asset }
  }
  const standardized = await standardizeGeneratedVideoAsset({
    src: input.asset.src,
    assetId: input.asset.id,
    outputDir: path.join(input.outputDir, 'timeline-generated-materials'),
    width: input.width,
    height: input.height,
    fps: input.fps,
  })
  return {
    asset: {
      ...input.asset,
      src: standardized.src,
    },
    standardizedSrc: standardized.src,
  }
}

function mergeAssets(input: {
  existing: RemotionTimelineAsset[]
  resolved: RemotionTimelineAsset[]
}): RemotionTimelineAsset[] {
  const resolvedById = new Map(input.resolved.map((asset) => [asset.id, asset]))
  const merged = input.existing.map((asset) => resolvedById.get(asset.id) ?? asset)
  const ids = new Set(merged.map((asset) => asset.id))
  for (const asset of input.resolved) {
    if (!ids.has(asset.id)) merged.push(asset)
  }
  return merged
}

export async function resolveRemotionTimelineMaterialJobs(input: {
  spec: RemotionTimelineSpecV1
  adapter?: V2MaterialGenerationAdapter
  outputDir?: string
  maxConcurrency?: number
  onProgress?: (event: V2TimelineMaterialProgress) => void | Promise<void>
  reusableRun?: {
    runId: string
    spec: RemotionTimelineSpecV1
    report: V2TimelineMaterialResolutionReport
  }
  idempotency?: {
    repository: V2IdempotencyRepository
    userId: number
    draftId: string
    renderRunId: string
    renderKey: string
  }
}): Promise<{
  spec: RemotionTimelineSpecV1
  report: V2TimelineMaterialResolutionReport
}> {
  // Planner output describes desired work, not authoritative execution state.
  // A generated job is fulfilled only when its output asset actually exists.
  const normalizedInputSpec: RemotionTimelineSpecV1 = {
    ...input.spec,
    material_jobs: input.spec.material_jobs.map((job) =>
      job.type === 'generate_video' &&
      job.status === 'fulfilled' &&
      !assetById(input.spec.assets, job.output_asset_id)
        ? { ...job, status: 'planned' as const }
        : job),
  }
  const spec = assertValidRemotionTimelineSpec(normalizedInputSpec)
  const adapter = input.adapter ?? createNoopMaterialGenerationAdapter()
  const fulfilledJobs: string[] = []
  const failedJobs: V2TimelineMaterialResolutionReport['failed_jobs'] = []
  const resolvedAssets: RemotionTimelineAsset[] = []
  const generationTrace: V2TimelineMaterialResolutionReport['generation_trace'] = []
  const blankCardFallbackJobs = new Set<string>()

  type JobOutcome = {
    fulfilledJob?: string
    failedJob?: V2TimelineMaterialResolutionReport['failed_jobs'][number]
    resolvedAsset?: RemotionTimelineAsset
    trace?: V2TimelineMaterialResolutionReport['generation_trace'][number]
    blankCardFallbackJob?: string
  }
  const total = spec.material_jobs.length
  let completed = 0
  const reportProgress = async (
    job: RemotionTimelineMaterialJob,
    status: V2TimelineMaterialProgress['status'],
  ) => {
    if (status !== 'started') completed += 1
    await input.onProgress?.({
      status,
      jobId: job.id,
      sceneId: job.scene_id,
      completed,
      total,
    })
  }
  const resolveJob = async (job: RemotionTimelineMaterialJob): Promise<JobOutcome> => {
    const startedAt = Date.now()
    await reportProgress(job, 'started')
    if (job.status === 'failed') {
      const reason = 'Material job is already failed; revise or replan it before execution.'
      await reportProgress(job, 'failed')
      return {
        failedJob: { id: job.id, reason },
        trace: {
          id: job.id,
          scene_id: job.scene_id,
          type: job.type,
          output_asset_id: job.output_asset_id,
          status: 'failed',
          elapsed_ms: Date.now() - startedAt,
          error: reason,
        },
      }
    }
    if (job.status === 'fulfilled' && assetById(spec.assets, job.output_asset_id)) {
      await reportProgress(job, 'fulfilled')
      return {
        fulfilledJob: job.id,
        trace: {
          id: job.id,
          scene_id: job.scene_id,
          type: job.type,
          output_asset_id: job.output_asset_id,
          status: 'fulfilled',
          elapsed_ms: Date.now() - startedAt,
        },
      }
    }
    if (job.type === 'reuse_asset') {
      if (!assetById(spec.assets, job.output_asset_id)) {
        const reason = 'reuse_asset job references an unavailable asset.'
        await reportProgress(job, 'failed')
        return {
          failedJob: { id: job.id, reason },
          trace: {
            id: job.id,
            scene_id: job.scene_id,
            type: job.type,
            output_asset_id: job.output_asset_id,
            status: 'failed',
            elapsed_ms: Date.now() - startedAt,
            error: reason,
          },
        }
      }
      await reportProgress(job, 'fulfilled')
      return {
        fulfilledJob: job.id,
        trace: {
          id: job.id,
          scene_id: job.scene_id,
          type: job.type,
          output_asset_id: job.output_asset_id,
          status: 'fulfilled',
          elapsed_ms: Date.now() - startedAt,
        },
      }
    }
    if (job.type === 'request_user_material') {
      const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        status: 'failed',
        elapsed_ms: Date.now() - startedAt,
        error: 'User material is required.',
      }
      await reportProgress(job, 'failed')
      return {
        failedJob: { id: job.id, reason: 'User material is required.' },
        trace,
      }
    }
    if (job.type !== 'generate_video') {
      const reason = `Unsupported timeline material job type: ${job.type}`
      await reportProgress(job, 'failed')
      return { failedJob: { id: job.id, reason } }
    }
    if (!job.prompt || !job.output_asset_id) {
      const reason = 'generate_video jobs require prompt and output_asset_id.'
      await reportProgress(job, 'failed')
      return { failedJob: { id: job.id, reason } }
    }

    let inputImageUrl = job.input_image_url
    let inputBindingError: string | undefined
    if (job.input_asset_id) {
      const inputAsset = assetById(spec.assets, job.input_asset_id)!
      try {
        inputImageUrl = await ensureExternallyReachableUploadUrl(inputAsset.src)
      } catch (error) {
        inputBindingError = `Unable to bind image asset ${job.input_asset_id} for generation: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    }

    const prepared = prepareV2MaterialGenerationRequest({ spec, job, inputImageUrl })
    const reusable = input.reusableRun
      ? await copyReusableGeneratedAsset({
          ...input.reusableRun,
          requestFingerprint: prepared.fingerprint,
          outputAssetId: job.output_asset_id,
          outputDir: input.outputDir,
        })
      : undefined
    if (reusable) {
      const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: prepared.request.prompt,
        input_asset_id: job.input_asset_id,
        input_image_url: inputImageUrl,
        output_asset_id: job.output_asset_id,
        request_fingerprint: prepared.fingerprint,
        output_sha256: reusable.sha256,
        reused_from_run_id: input.reusableRun!.runId,
        status: 'fulfilled',
        elapsed_ms: Date.now() - startedAt,
        standardized_src: reusable.asset.src,
      }
      await reportProgress(job, 'fulfilled')
      return { fulfilledJob: job.id, resolvedAsset: reusable.asset, trace }
    }

    const execution = inputBindingError
      ? { generated: { ok: false, submissionState: 'not_submitted' as const, error: inputBindingError } }
      : await generateWithIdempotency({
          adapter,
          request: prepared.request,
          requestFingerprint: prepared.fingerprint,
          jobId: job.id,
          outputAssetId: job.output_asset_id,
          outputDir: input.outputDir,
          context: input.idempotency,
        })
    const generated: V2MaterialGenerationResult = execution.generated

    if (generated.ok && generated.asset) {
      const normalized = await standardizeIfVideo({
        asset: convertGeneratedAsset({
          id: job.output_asset_id,
          type: generated.asset.type === 'image' ? 'image' : 'video',
          src: generated.asset.src,
          label: `Generated asset for ${job.scene_id}`,
        }),
        outputDir: input.outputDir,
        width: spec.canvas.width,
        height: spec.canvas.height,
        fps: spec.canvas.fps,
      })
      const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: prepared.request.prompt,
        input_asset_id: job.input_asset_id,
        input_image_url: inputImageUrl,
        output_asset_id: job.output_asset_id,
        provider_task_id: generated.providerTaskId,
        request_fingerprint: prepared.fingerprint,
        status: 'fulfilled',
        elapsed_ms: Date.now() - startedAt,
        standardized_src: normalized.standardizedSrc,
        output_sha256: path.isAbsolute(normalized.asset.src) ? await sha256File(normalized.asset.src) : undefined,
      }
      if (execution.receipt && input.idempotency && execution.receipt.status === 'running') {
        await input.idempotency.repository.update({
          id: execution.receipt.id,
          status: 'completed',
          resultRef: normalized.asset.src,
          providerTaskId: generated.providerTaskId,
        })
      }
      await reportProgress(job, 'fulfilled')
      return { fulfilledJob: job.id, resolvedAsset: normalized.asset, trace }
    }

    const mustFailRun = generated.failureCode === 'provider_submit_state_unknown' ||
      generated.failureCode === 'provider_receipt_persist_failed'
    const fallback = mustFailRun ? undefined : fallbackAsset({ job, currentAssets: spec.assets })
    if (fallback) {
      const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: prepared.request.prompt,
        input_asset_id: job.input_asset_id,
        input_image_url: inputImageUrl,
        output_asset_id: job.output_asset_id,
        provider_task_id: generated.providerTaskId,
        request_fingerprint: prepared.fingerprint,
        status: 'fallback',
        elapsed_ms: Date.now() - startedAt,
        error: generated.error ?? 'Generation failed; used fallback asset.',
      }
      await reportProgress(job, 'fallback')
      return { fulfilledJob: job.id, resolvedAsset: fallback, trace }
    }

    if (!mustFailRun && job.fallback_kind === 'blank_card') {
      const reason = generated.error ?? 'Generation failed; kept the existing Remotion fallback scene.'
      const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: prepared.request.prompt,
        input_asset_id: job.input_asset_id,
        input_image_url: inputImageUrl,
        output_asset_id: job.output_asset_id,
        provider_task_id: generated.providerTaskId,
        request_fingerprint: prepared.fingerprint,
        status: 'fallback',
        elapsed_ms: Date.now() - startedAt,
        error: reason,
      }
      await reportProgress(job, 'fallback')
      return {
        failedJob: { id: job.id, reason },
        blankCardFallbackJob: job.id,
        trace,
      }
    }

    const reason = generated.error ?? 'Material generation failed.'
    const trace: V2TimelineMaterialResolutionReport['generation_trace'][number] = {
      id: job.id,
      scene_id: job.scene_id,
      type: job.type,
      prompt: prepared.request.prompt,
      input_asset_id: job.input_asset_id,
      input_image_url: inputImageUrl,
      output_asset_id: job.output_asset_id,
      provider_task_id: generated.providerTaskId,
      request_fingerprint: prepared.fingerprint,
      status: 'failed',
      elapsed_ms: Date.now() - startedAt,
      error: reason,
    }
    await reportProgress(job, 'failed')
    return { failedJob: { id: job.id, reason }, trace }
  }

  const outcomes: JobOutcome[] = new Array(spec.material_jobs.length)
  let nextIndex = 0
  const concurrency = Math.min(
    Math.max(1, Math.floor(input.maxConcurrency ?? 3)),
    Math.max(1, spec.material_jobs.length),
  )
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      const job = spec.material_jobs[index]
      if (!job) return
      outcomes[index] = await resolveJob(job)
    }
  }))
  for (const outcome of outcomes) {
    if (outcome.fulfilledJob) fulfilledJobs.push(outcome.fulfilledJob)
    if (outcome.failedJob) failedJobs.push(outcome.failedJob)
    if (outcome.resolvedAsset) resolvedAssets.push(outcome.resolvedAsset)
    if (outcome.trace) generationTrace.push(outcome.trace)
    if (outcome.blankCardFallbackJob) blankCardFallbackJobs.add(outcome.blankCardFallbackJob)
  }

  const mergedAssets = mergeAssets({ existing: spec.assets, resolved: resolvedAssets })
  const nextSpec: RemotionTimelineSpecV1 = {
    ...spec,
    assets: mergedAssets,
    scenes: spec.scenes.map((scene) => {
      const job = spec.material_jobs.find((item) => item.scene_id === scene.id && item.output_asset_id)
      if (job && blankCardFallbackJobs.has(job.id)) {
        return {
          ...scene,
          type: 'remotion_card',
          asset_id: undefined,
          title: scene.creative_intent?.title?.trim() || scene.title?.trim() || '画面待补充',
          body:
            scene.creative_intent?.description?.trim() ||
            scene.body?.trim() ||
            job.prompt?.trim() ||
            '本镜头的生成素材尚未完成。',
        }
      }
      const outputAsset = job?.output_asset_id
        ? assetById(mergedAssets, job.output_asset_id)
        : undefined
      if (!job || !fulfilledJobs.includes(job.id) || !outputAsset) return scene
      return {
        ...scene,
        type: outputAsset.type === 'image'
          ? 'image_motion'
          : job.type === 'generate_video'
            ? 'ai_video'
            : 'user_video',
        asset_id: job.output_asset_id,
      }
    }),
    material_jobs: spec.material_jobs.map((job) => {
      if (blankCardFallbackJobs.has(job.id)) {
        return { ...job, status: 'failed' as const, output_asset_id: undefined }
      }
      return fulfilledJobs.includes(job.id)
        ? {
            ...job,
            status: 'fulfilled' as const,
          }
        : job
    }),
  }
  const plannedGeneratedSceneIds = [...new Set(
    spec.material_jobs
      .filter((job) => job.type === 'generate_video')
      .map((job) => job.scene_id),
  )]
  const resolvedGeneratedSceneIds = new Set<string>()
  for (const job of spec.material_jobs.filter((item) => item.type === 'generate_video')) {
    const trace = generationTrace.find((item) => item.id === job.id)
    if (
      fulfilledJobs.includes(job.id)
      && trace?.status === 'fulfilled'
      && job.output_asset_id
      && assetById(mergedAssets, job.output_asset_id)
    ) {
      resolvedGeneratedSceneIds.add(job.scene_id)
    }
  }
  const fallbackSceneIds = new Set(
    generationTrace
      .filter((item) => item.status === 'fallback')
      .map((item) => item.scene_id),
  )
  const missingGeneratedSceneIds = plannedGeneratedSceneIds.filter(
    (sceneId) => !resolvedGeneratedSceneIds.has(sceneId),
  )
  const deliveryReadiness = {
    ready: failedJobs.length === 0 && missingGeneratedSceneIds.length === 0,
    planned_generated_scene_count: plannedGeneratedSceneIds.length,
    resolved_generated_scene_count: resolvedGeneratedSceneIds.size,
    fallback_scene_count: fallbackSceneIds.size,
    missing_generated_scene_ids: missingGeneratedSceneIds,
  }

  return {
    spec: assertValidRemotionTimelineSpec(nextSpec),
    report: {
      schema_version: 'v2_timeline_material_resolution.v1',
      ok: failedJobs.length === 0,
      fulfilled_jobs: fulfilledJobs,
      failed_jobs: failedJobs,
      resolved_assets: resolvedAssets,
      generation_trace: generationTrace,
      delivery_readiness: deliveryReadiness,
    },
  }
}

export async function standardizeRemotionTimelineVideoAssets(input: {
  spec: RemotionTimelineSpecV1
  outputDir: string
}): Promise<{
  spec: RemotionTimelineSpecV1
  standardized_assets: Array<{
    id: string
    src: string
  }>
}> {
  const spec = assertValidRemotionTimelineSpec(input.spec)
  const standardizedAssets: Array<{ id: string; src: string }> = []
  const assets: RemotionTimelineAsset[] = []

  for (const asset of spec.assets) {
    if (asset.type !== 'video' || asset.src.startsWith('static:')) {
      assets.push(asset)
      continue
    }
    const standardized = await standardizeGeneratedVideoAsset({
      src: asset.src,
      assetId: asset.id,
      outputDir: path.join(input.outputDir, 'timeline-standardized-assets'),
      width: spec.canvas.width,
      height: spec.canvas.height,
      fps: spec.canvas.fps,
    })
    assets.push({
      ...asset,
      src: standardized.src,
    })
    standardizedAssets.push({
      id: asset.id,
      src: standardized.src,
    })
  }

  return {
    spec: assertValidRemotionTimelineSpec({
      ...spec,
      assets,
    }),
    standardized_assets: standardizedAssets,
  }
}
