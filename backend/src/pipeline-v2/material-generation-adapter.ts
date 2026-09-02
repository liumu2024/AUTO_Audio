import path from 'node:path'

export interface V2GeneratedMaterialAsset {
  id: string
  type: 'video' | 'image'
  src: string
  source: 'generated_asset' | 'user_asset' | 'fallback_asset'
  duration_sec?: number
}

export interface V2MaterialGenerationRequest {
  jobId: string
  shotId: string
  type: 'generate_image' | 'generate_video'
  durationSec: number
  prompt: string
  inputImageUrl?: string
  outputAssetId: string
}

export interface V2MaterialGenerationResult {
  ok: boolean
  asset?: V2GeneratedMaterialAsset
  providerTaskId?: string
  submissionState?: 'not_submitted' | 'submitted' | 'unknown'
  failureCode?:
    | 'provider_submit_state_unknown'
    | 'provider_receipt_persist_failed'
    | 'provider_task_pending'
    | 'provider_task_terminal'
  metadata?: Record<string, unknown>
  error?: string
}

export interface V2MaterialGenerationAdapter {
  generate(
    input: V2MaterialGenerationRequest,
    options?: {
      onProviderTaskSubmitted?: (providerTaskId: string) => void | Promise<void>
      signal?: AbortSignal
    },
  ): Promise<V2MaterialGenerationResult>
  resume?(
    input: V2MaterialGenerationRequest,
    providerTaskId: string,
    options?: { signal?: AbortSignal },
  ): Promise<V2MaterialGenerationResult>
  getTaskStatus?(providerTaskId: string): Promise<{
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  }>
  cancelTask?(providerTaskId: string): Promise<{
    cancelled: boolean
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
    reason?: string
  }>
}

export function createNoopMaterialGenerationAdapter(): V2MaterialGenerationAdapter {
  return {
    async generate(input) {
      return {
        ok: false,
        submissionState: 'not_submitted',
        error: `No material generation adapter is configured for ${input.type}.`,
      }
    },
  }
}

export function createStaticMaterialGenerationAdapter(input: {
  videoAssetPath?: string
  imageAssetPath?: string
}): V2MaterialGenerationAdapter {
  return {
    async generate(request) {
      const src = request.type === 'generate_video' ? input.videoAssetPath : input.imageAssetPath
      if (!src) {
        return {
          ok: false,
          submissionState: 'not_submitted',
          error: `Static adapter has no asset path for ${request.type}.`,
        }
      }
      return {
        ok: true,
        submissionState: 'not_submitted',
        providerTaskId: `static:${path.basename(src)}`,
        asset: {
          id: request.outputAssetId,
          type: request.type === 'generate_video' ? 'video' : 'image',
          src,
          source: 'generated_asset',
        },
      }
    },
  }
}
