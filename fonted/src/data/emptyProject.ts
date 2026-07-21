import type { MigrationProtocolV12 } from '@/types/migration-protocol'
import type { TimelineProject } from '@/types/timeline'

/** 解析完成前的空工程，避免前端加载 shared/mocks。 */
export const emptyMigrationProject: MigrationProtocolV12 = {
  version: '1.2',
  metadata: {
    video_id: '',
    duration_sec: 0,
  },
  source_video: { url: '', duration: 0 },
  generated_video: { url: '', duration: 0 },
  semantic_anchors: [],
}

export const emptyTimelineProject: TimelineProject = {
  duration_sec: 0,
  tracks: [
    { id: 'video', label: '画面轨', sublabel: '镜头 / 素材 / 画面段落' },
    { id: 'audio', label: '音乐轨', sublabel: '配乐 / 节拍 / 音频参考' },
  ],
  clips: [],
}
