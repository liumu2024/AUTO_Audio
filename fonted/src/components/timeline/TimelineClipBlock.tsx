import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Film, Music2, Sparkles, Type } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { TimelineClip } from '@/types/timeline'

interface TimelineClipBlockProps {
  clip: TimelineClip
  pixelsPerSecond: number
}

const TRACK_STYLES = {
  video: {
    bg: 'bg-slate-500/90 hover:bg-slate-400/90 border-slate-400/50',
    selected: 'ring-2 ring-sky-400 border-sky-300/60 bg-slate-400',
    icon: Film,
    text: 'text-slate-50',
  },
  overlay: {
    bg: 'bg-amber-400/90 hover:bg-amber-300/90 border-amber-300/60',
    selected: 'ring-2 ring-amber-200 border-amber-200 bg-amber-300',
    icon: Type,
    text: 'text-amber-950',
  },
  audio: {
    bg: 'bg-violet-600/85 hover:bg-violet-500/85 border-violet-400/50',
    selected: 'ring-2 ring-violet-300 border-violet-300 bg-violet-500',
    icon: Music2,
    text: 'text-violet-50',
  },
  effect: {
    bg: 'bg-fuchsia-600/85 hover:bg-fuchsia-500/85 border-fuchsia-400/50',
    selected: 'ring-2 ring-fuchsia-300 border-fuchsia-300 bg-fuchsia-500',
    icon: Sparkles,
    text: 'text-fuchsia-50',
  },
} as const

export function TimelineClipBlock({ clip, pixelsPerSecond }: TimelineClipBlockProps) {
  const v2SelectedClipId = useV2TimelineStore((s) => s.selectedClipId)
  const selectV2Clip = useV2TimelineStore((s) => s.selectClip)
  const seek = usePlaybackStore((s) => s.seek)
  const isSelected = v2SelectedClipId === clip.id

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: clip.id,
      data: { type: 'clip', clip },
      disabled: true,
    })

  const style = TRACK_STYLES[clip.track_id as keyof typeof TRACK_STYLES] ?? TRACK_STYLES.video
  const Icon = style.icon
  const width = (clip.end_sec - clip.start_sec) * pixelsPerSecond
  const left = clip.start_sec * pixelsPerSecond

  const dragStyle = {
    left,
    width: Math.max(width, 24),
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 20 : isSelected ? 10 : 1,
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={dragStyle}
      className={cn(
        'absolute top-1 bottom-1 flex min-w-[24px] cursor-ew-resize items-start gap-1 overflow-hidden rounded border px-1.5 py-1 text-left transition-shadow',
        style.bg,
        isSelected && style.selected,
        isDragging && 'cursor-ew-resize opacity-90 shadow-lg shadow-black/40',
      )}
      onClick={(e) => {
        e.stopPropagation()
        seek(clip.start_sec)
        selectV2Clip(clip.id)
      }}
      {...listeners}
      {...attributes}
    >
      <Icon className={cn('relative z-10 mt-0.5 h-3 w-3 shrink-0', style.text)} />
      <span
        className={cn(
          'relative z-10 truncate text-[10px] font-medium leading-tight',
          style.text,
        )}
      >
        {clip.label}
      </span>
    </button>
  )
}
