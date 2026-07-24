import { create } from 'zustand'

import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

export type SidebarTab = 'config' | 'structure'
export type SidebarSubView = 'main' | 'materials'
export type MaterialLibraryMode = 'manage' | 'pick'
export type TimelineMode = 'sample' | 'generation'

/** 工作台视图：样例拆解 → 生成编辑 → 成片播放 */
export type WorkbenchView = 'sample_breakdown' | 'generation_edit' | 'rendered_output'

interface EditorState {
  projectName: string
  sidebarTab: SidebarTab
  sidebarSubView: SidebarSubView
  materialLibraryMode: MaterialLibraryMode
  timelineMode: TimelineMode
  /** V2 时间线方案已生成，可进入生成编辑视图。 */
  generationEditEnabled: boolean
  setProjectName: (name: string) => void
  enterV2Workspace: () => void
  setSidebarTab: (tab: SidebarTab) => void
  setTimelineMode: (mode: TimelineMode) => void
  setGenerationEditEnabled: (enabled: boolean) => void
  openMaterialLibrary: (mode?: MaterialLibraryMode) => void
  closeMaterialLibrary: () => void
}

export function resolveWorkbenchView(input: {
  timelineMode: TimelineMode
  hasTimelinePlan: boolean
  hasRenderedVideo: boolean
}): WorkbenchView {
  if (input.hasRenderedVideo && input.timelineMode === 'generation') {
    return 'rendered_output'
  }
  if (input.timelineMode === 'generation' && input.hasTimelinePlan) {
    return 'generation_edit'
  }
  return 'sample_breakdown'
}

export const useEditorStore = create<EditorState>((set) => ({
  projectName: '未命名视频项目',
  sidebarTab: 'config',
  sidebarSubView: 'main',
  materialLibraryMode: 'manage',
  timelineMode: 'sample',
  generationEditEnabled: false,
  setProjectName: (projectName) => set({ projectName }),
  enterV2Workspace: () => {
    useDirectorContextStore.getState().reset()
    set({
      timelineMode: 'sample',
      generationEditEnabled: false,
    })
  },
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setTimelineMode: (timelineMode) => {
    if (timelineMode === 'generation') {
      const hasV2Timeline = Boolean(useV2TimelineStore.getState().spec?.scenes.length)
      if (!hasV2Timeline) return
    }
    set({ timelineMode })
  },
  setGenerationEditEnabled: (generationEditEnabled) => set({ generationEditEnabled }),
  openMaterialLibrary: (mode = 'manage') =>
    set({ sidebarSubView: 'materials', materialLibraryMode: mode }),
  closeMaterialLibrary: () => set({ sidebarSubView: 'main' }),
}))
