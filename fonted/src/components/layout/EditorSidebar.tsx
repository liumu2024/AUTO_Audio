import { Clapperboard } from 'lucide-react'

import { DirectorChatPanel } from '@/components/sidebar/DirectorChatPanel'
import { MaterialLibraryManager } from '@/components/sidebar/MaterialLibraryManager'
import { useEditorStore } from '@/stores/editorStore'

export function EditorSidebar() {
  const sidebarSubView = useEditorStore((s) => s.sidebarSubView)

  if (sidebarSubView === 'materials') {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
        <div className="shrink-0 border-b border-zinc-800 px-3 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            素材库
          </h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          <MaterialLibraryManager />
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
      <div className="shrink-0 border-b border-zinc-800 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
            <Clapperboard className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">AI 导演助理</h2>
            <p className="text-[10px] text-zinc-500">对话式创作 · 结构拆解 · 成片生成</p>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
        <DirectorChatPanel />
      </div>
    </aside>
  )
}
