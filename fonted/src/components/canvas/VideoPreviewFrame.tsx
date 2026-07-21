import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25

interface VideoPreviewFrameProps {
  children: ReactNode
  className?: string
}

/** 可缩放预览区：滚轮 + Ctrl 缩放，工具栏 +/- */
export function VideoPreviewFrame({ children, className }: VideoPreviewFrameProps) {
  const [zoom, setZoom] = useState(1)
  const viewportRef = useRef<HTMLDivElement>(null)

  const clampZoom = (z: number) =>
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

  const zoomIn = () => setZoom((z) => clampZoom(z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => clampZoom(z - ZOOM_STEP))
  const resetZoom = () => setZoom(1)

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)))
  }, [])

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-zinc-950/80',
        className,
      )}
    >
      <div
        ref={viewportRef}
        className="scroll-area-y flex min-h-0 flex-1 items-center justify-center overflow-auto p-2"
        onWheel={onWheel}
      >
        <div
          className="origin-center transition-transform duration-150 ease-out"
          style={{
            transform: `scale(${zoom})`,
            width: zoom >= 1 ? '100%' : `${100 / zoom}%`,
            maxWidth: '100%',
          }}
        >
          <div className="aspect-video w-full min-w-[200px]">{children}</div>
        </div>
      </div>

      <div className="absolute bottom-2 right-2 z-20 flex items-center gap-0.5 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-0.5 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={zoomOut}
          title="缩小 (Ctrl+滚轮)"
          aria-label="缩小"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[2.5rem] text-center text-[10px] tabular-nums text-zinc-500">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={zoomIn}
          title="放大 (Ctrl+滚轮)"
          aria-label="放大"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={resetZoom}
          title="重置缩放"
          aria-label="重置缩放"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
