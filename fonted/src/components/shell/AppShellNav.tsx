import { cn } from '@/lib/utils'
import {
  useAppShellStore,
  type AppShellView,
} from '@/stores/appShellStore'
import { useEditorStore } from '@/stores/editorStore'

const NAV_ITEMS: {
  view: AppShellView
  icon: string
  label: string
}[] = [
  { view: 'dashboard', icon: '🏠', label: '工作台' },
  { view: 'editor', icon: '🎬', label: '创作' },
  { view: 'assets', icon: '📁', label: '素材库' },
]

export function AppShellNav() {
  const activeView = useAppShellStore((s) => s.activeView)
  const setActiveView = useAppShellStore((s) => s.setActiveView)

  return (
    <nav
      className="flex h-full w-16 shrink-0 flex-col items-center gap-1 border-r border-zinc-800/90 bg-[#0a0a0c] py-3"
      aria-label="全局导航"
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/80 to-fuchsia-600/50 text-xs font-bold text-white shadow-lg shadow-violet-950/40">
        AI
      </div>

      {NAV_ITEMS.map((item) => {
        const active = activeView === item.view
        return (
          <button
            key={item.view}
            type="button"
            title={item.label}
            onClick={() => {
              if (item.view === 'editor') {
                useEditorStore.getState().enterV2Workspace()
              }
              setActiveView(item.view)
            }}
            className={cn(
              'group relative flex w-12 flex-col items-center gap-0.5 rounded-xl px-1 py-2.5 text-[10px] transition-all',
              active
                ? 'bg-zinc-800/90 text-zinc-100 shadow-inner'
                : 'text-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-300',
            )}
          >
            {active && (
              <span
                className="absolute -left-px top-2 bottom-2 w-0.5 rounded-full bg-violet-400"
                aria-hidden
              />
            )}
            <span className="text-lg leading-none" aria-hidden>
              {item.icon}
            </span>
            <span className="max-w-full truncate font-medium leading-tight">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
