import type { AssetAnalysisV1 } from '@shared/types/asset-analysis.v1'
import type { DirectorAspectRatio } from '@shared/types/director-context'
import type { PipelineBundle } from '@/types/pipeline'

interface AnalysisCacheMaterialInput {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  tags?: string[]
  analysis?: AssetAnalysisV1
}

export interface AnalysisCacheInput {
  sampleVideoUrl: string
  sampleVideoName?: string
  globalPrompt?: string
  aspectRatio?: DirectorAspectRatio
  durationSec?: number
  styleIntensity?: 'light' | 'medium' | 'strong'
  materials?: AnalysisCacheMaterialInput[]
}

export interface AnalysisCacheRecord {
  key: string
  taskId: string
  createdAt: string
  lastUsedAt: string
  sampleVideoName?: string
  materialCount: number
  promptPreview?: string
}

const STORAGE_KEY = 'dpl304.analysisCache.v1'
const MAX_RECORDS = 24
const TTL_MS = 14 * 24 * 60 * 60 * 1000

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim()
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue((value as Record<string, unknown>)[key])
      return acc
    }, {})
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(input: string | ArrayBuffer): Promise<string> {
  const data =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(digest)
}

async function fingerprintUrl(input: {
  url: string
  name?: string
}): Promise<Record<string, unknown>> {
  const url = normalizeText(input.url)
  const name = normalizeText(input.name)
  if (!url.startsWith('blob:') && !url.startsWith('data:')) {
    return { kind: 'url', url, name }
  }

  try {
    const response = await fetch(url)
    const blob = await response.blob()
    return {
      kind: 'blob',
      name,
      size: blob.size,
      type: blob.type,
      sha256: await sha256(await blob.arrayBuffer()),
    }
  } catch {
    return { kind: 'local-url-unreadable', url, name }
  }
}

async function buildFingerprintPayload(input: AnalysisCacheInput) {
  const materials = await Promise.all(
    (input.materials ?? []).map(async (item, index) => ({
      index,
      id: normalizeText(item.id),
      name: normalizeText(item.name),
      type: item.type,
      media: await fingerprintUrl({ url: item.url, name: item.name }),
      tags: [...(item.tags ?? [])].map(normalizeText).sort(),
      analysis: item.analysis ?? null,
    })),
  )

  return {
    schema: 1,
    sample: await fingerprintUrl({
      url: input.sampleVideoUrl,
      name: input.sampleVideoName ?? 'sample-video.mp4',
    }),
    globalPrompt: normalizeText(input.globalPrompt),
    aspectRatio: input.aspectRatio ?? '9:16',
    durationSec: input.durationSec ?? null,
    styleIntensity: input.styleIntensity ?? 'medium',
    materials,
  }
}

export async function createAnalysisCacheKey(
  input: AnalysisCacheInput,
): Promise<string> {
  const payload = await buildFingerprintPayload(input)
  return `analysis_${await sha256(stableJson(payload))}`
}

function readRecords(): AnalysisCacheRecord[] {
  if (!canUseLocalStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isCacheRecordFresh) : []
  } catch {
    return []
  }
}

function writeRecords(records: AnalysisCacheRecord[]): void {
  if (!canUseLocalStorage()) return
  try {
    const now = Date.now()
    const next = records
      .filter((record) => now - Date.parse(record.createdAt) <= TTL_MS)
      .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt))
      .slice(0, MAX_RECORDS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Cache failures must never block the analysis pipeline.
  }
}

function isCacheRecordFresh(value: unknown): value is AnalysisCacheRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AnalysisCacheRecord>
  if (!record.key || !record.taskId || !record.createdAt || !record.lastUsedAt) return false
  return Date.now() - Date.parse(record.createdAt) <= TTL_MS
}

export function getCachedAnalysisTask(
  key: string,
): AnalysisCacheRecord | undefined {
  const records = readRecords()
  const hit = records.find((record) => record.key === key)
  if (!hit) {
    writeRecords(records)
    return undefined
  }

  const nextHit = { ...hit, lastUsedAt: new Date().toISOString() }
  writeRecords([nextHit, ...records.filter((record) => record.key !== key)])
  return nextHit
}

export function putCachedAnalysisTask(input: {
  key: string
  taskId: string
  source: AnalysisCacheInput
}): void {
  const now = new Date().toISOString()
  const record: AnalysisCacheRecord = {
    key: input.key,
    taskId: input.taskId,
    createdAt: now,
    lastUsedAt: now,
    sampleVideoName: input.source.sampleVideoName,
    materialCount: input.source.materials?.length ?? 0,
    promptPreview: normalizeText(input.source.globalPrompt).slice(0, 80),
  }
  writeRecords([record, ...readRecords().filter((item) => item.key !== input.key)])
}

export function removeCachedAnalysisTask(key: string): void {
  writeRecords(readRecords().filter((record) => record.key !== key))
}

export function isBundleUsableForAnalysisCache(bundle: PipelineBundle): boolean {
  return Boolean(bundle.structure?.semantic_anchors?.length && bundle.outline?.length)
}
