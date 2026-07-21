import { buildTimelineFromStructure } from '../../../shared/lib/pipeline-builder'

import { mockProjectData } from '@/data/mockMigrationProject'
import type { TimelineProject } from '@/types/timeline'

/** 由 structure 推导，与 shared/lib/pipeline-builder 一致 */
export const mockTimelineProject: TimelineProject =
  buildTimelineFromStructure(mockProjectData)
