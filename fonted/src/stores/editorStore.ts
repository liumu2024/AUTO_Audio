import { create } from 'zustand'

import { useDirectorContextStore } from '@/stores/directorContextStore'

export type SidebarTab = 'config' | 'structure'
export type SidebarSubView = 'main' | 'materials'
export type MaterialLibraryMode = 'manage' | 'pick'
interface EditorState {
  projectName: string
  sidebarTab: SidebarTab
  sidebarSubView: SidebarSubView
  materialLibraryMode: MaterialLibraryMode
  setProjectName: (name: string) => void
  enterV2Workspace: () => void
  setSidebarTab: (tab: SidebarTab) => void
  openMaterialLibrary: (mode?: MaterialLibraryMode) => void
  closeMaterialLibrary: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  projectName: '未命名视频项目',
  sidebarTab: 'config',
  sidebarSubView: 'main',
  materialLibraryMode: 'manage',
  setProjectName: (projectName) => set({ projectName }),
  enterV2Workspace: () => {
    useDirectorContextStore.getState().reset()
  },
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  openMaterialLibrary: (mode = 'manage') =>
    set({ sidebarSubView: 'materials', materialLibraryMode: mode }),
  closeMaterialLibrary: () => set({ sidebarSubView: 'main' }),
}))
