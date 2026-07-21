import { AppShellNav } from '@/components/shell/AppShellNav'
import { AssetsShellView } from '@/components/shell/AssetsShellView'
import { DashboardView } from '@/components/shell/DashboardView'
import { V2TimelineView } from '@/components/shell/V2TimelineView'
import { VideoEditorLayout } from '@/components/layout/VideoEditorLayout'
import { useAppShellStore } from '@/stores/appShellStore'

export function AppLayout() {
  const activeView = useAppShellStore((s) => s.activeView)

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950">
      <AppShellNav />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeView === 'dashboard' && <DashboardView />}
        {activeView === 'assets' && <AssetsShellView />}
        {activeView === 'v2timeline' && <V2TimelineView />}
        {activeView === 'editor' && <VideoEditorLayout />}
      </main>
    </div>
  )
}
