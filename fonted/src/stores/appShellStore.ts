import { create } from 'zustand'

export type AppShellView = 'dashboard' | 'editor' | 'assets' | 'preferences'

interface AppShellState {
  activeView: AppShellView
  setActiveView: (view: AppShellView) => void
}

export const useAppShellStore = create<AppShellState>((set) => ({
  activeView: 'editor',
  setActiveView: (activeView) => set({ activeView }),
}))
