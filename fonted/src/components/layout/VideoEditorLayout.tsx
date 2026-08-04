import { ProgressOverlay } from '@/components/ai/ProgressOverlay'
import { EditorHeader } from '@/components/layout/EditorHeader'
import { EditorSidebar } from '@/components/layout/EditorSidebar'
import { MainCanvas } from '@/components/layout/MainCanvas'
import { PropertyEditorPanel } from '@/components/layout/PropertyEditorPanel'
import { TimelinePanel } from '@/components/layout/TimelinePanel'
import { usePipelineBootstrap } from '@/hooks/usePipelineBootstrap'

/**
 * AI 视频编辑器主布局
 *
 * Grid：顶栏 auto + 主区域 minmax(0,1fr)，保证 flex 子项可正确撑满高度
 */
export function VideoEditorLayout() {
  usePipelineBootstrap()

  return (
    <div className="relative grid h-full w-full grid-cols-[320px_1fr_300px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="col-span-3 row-start-1 shrink-0">
        <EditorHeader />
      </div>

      <div className="row-start-2 flex h-full min-h-0 flex-col overflow-hidden">
        <EditorSidebar />
      </div>

      <div className="col-start-2 row-start-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <MainCanvas />
        </div>
        <div className="h-72 shrink-0 overflow-hidden border-t border-zinc-800">
          <TimelinePanel />
        </div>
      </div>

      <div className="col-start-3 row-start-2 flex h-full min-h-0 flex-col overflow-hidden">
        <PropertyEditorPanel />
      </div>

      <ProgressOverlay />
    </div>
  )
}
