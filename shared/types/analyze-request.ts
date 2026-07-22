import type { UserMaterialDto } from './pipeline.js'
import type { DirectorUserIntent } from './director-context.js'
import type { ParsedCreativeIntent } from './template-schema.v1.js'

export interface SampleVideoInputDto {
  id?: string
  name?: string
  url: string
}

export interface ReferenceMaterialInputDto {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  tags?: string[]
}

/** Legacy V1 analyze-task payload. The active creation path uses V2 timeline APIs. */
export interface AnalyzeTaskRequest {
  /** v1 payload: 唯一被理解的样例视频 */
  sampleVideo?: SampleVideoInputDto
  /** v1 payload: 只作为 slot-filling 候选，不再当成样例理解对象 */
  referenceMaterials?: ReferenceMaterialInputDto[]
  /** 左侧导演助理解析出的用户创作意图 */
  creativeIntent?: ParsedCreativeIntent
  directorIntent?: DirectorUserIntent
  /** legacy: use sampleVideo.url */
  videoUrl: string
  globalPrompt?: string
  /** legacy: use referenceMaterials/UserMaterialDto bridge */
  materials?: UserMaterialDto[]
}
