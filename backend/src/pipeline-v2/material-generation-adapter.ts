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
  prompt: string
  inputImageUrl?: string
  outputAssetId: string
}

export interface V2MaterialGenerationResult {
  ok: boolean
  asset?: V2GeneratedMaterialAsset
  providerTaskId?: string
  metadata?: Record<string, unknown>
  error?: string
}

export interface V2MaterialGenerationAdapter {
  generate(input: V2MaterialGenerationRequest): Promise<V2MaterialGenerationResult>
}

export function createNoopMaterialGenerationAdapter(): V2MaterialGenerationAdapter {
  return {
    async generate(input) {
      return {
        ok: false,
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
          error: `Static adapter has no asset path for ${request.type}.`,
        }
      }
      return {
        ok: true,
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
