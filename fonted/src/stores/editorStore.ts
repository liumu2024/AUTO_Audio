import { create } from 'zustand'

import { useRenderPlanStore } from '@/stores/renderPlanStore'

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
  /** RenderPlan 已生成，可进入生成编辑视图 */
  generationEditEnabled: boolean
  setProjectName: (name: string) => void
  setSidebarTab: (tab: SidebarTab) => void
  setTimelineMode: (mode: TimelineMode) => void
  setGenerationEditEnabled: (enabled: boolean) => void
  openMaterialLibrary: (mode?: MaterialLibraryMode) => void
  closeMaterialLibrary: () => void
}

export function resolveWorkbenchView(input: {
  timelineMode: TimelineMode
  hasRenderPlan: boolean
  hasRenderedVideo: boolean
}): WorkbenchView {
  if (input.hasRenderedVideo && input.timelineMode === 'generation') {
    return 'rendered_output'
  }
  if (input.timelineMode === 'generation' && input.hasRenderPlan) {
    return 'generation_edit'
  }
  return 'sample_breakdown'
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectName: '未命名视频项目',
  sidebarTab: 'config',
  sidebarSubView: 'main',
  materialLibraryMode: 'manage',
  timelineMode: 'sample',
  generationEditEnabled: false,
  setProjectName: (projectName) => set({ projectName }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setTimelineMode: (timelineMode) => {
    if (timelineMode === 'generation') {
      const hasPlan = Boolean(useRenderPlanStore.getState().plan?.scenes.length)
      if (!get().generationEditEnabled && !hasPlan) return
    }
    set({ timelineMode })
  },
  setGenerationEditEnabled: (generationEditEnabled) => set({ generationEditEnabled }),
  openMaterialLibrary: (mode = 'manage') =>
    set({ sidebarSubView: 'materials', materialLibraryMode: mode }),
  closeMaterialLibrary: () => set({ sidebarSubView: 'main' }),
}))
