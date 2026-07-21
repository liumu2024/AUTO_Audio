import structure from '../../../shared/mocks/02-analysis-result.v1.2.json'
import ingest from '../../../shared/mocks/01-video-ingest.json'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'

/** v1.2 Truth Source — 与 shared/mocks 同步 */
export const mockProjectData = {
  ...structure,
  version: '1.2' as const,
  source_video: {
    url: ingest.sample_video_url,
    duration: ingest.duration_sec,
  },
  generated_video: {
    url: ingest.sample_video_url,
    duration: ingest.duration_sec,
  },
} as MigrationProtocolV12

/** @deprecated 使用 mockProjectData */
export const mockMigrationProject = mockProjectData
