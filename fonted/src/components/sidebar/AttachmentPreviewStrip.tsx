import { Film, ImageIcon, Music2, X } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PreviewItemKind = 'sample' | 'material'

export interface AttachmentPreviewItem {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url?: string
  kind: PreviewItemKind
}

const TYPE_ICON = {
  video: Film,
  image: ImageIcon,
  audio: Music2,
} as const

interface AttachmentPreviewStripProps {
  items: AttachmentPreviewItem[]
  onRemove: (id: string, kind: PreviewItemKind) => void
}

function Thumbnail({ item }: { item: AttachmentPreviewItem }) {
  const Icon = TYPE_ICON[item.type]

  if (item.type === 'image' && item.url) {
    return (
      <img
        src={item.url}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    )
  }

  if (item.type === 'video' && item.url?.startsWith('blob:')) {
    return (
      <video
        src={item.url}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center',
        item.kind === 'sample' ? 'bg-violet-950/80' : 'bg-zinc-800',
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5',
          item.kind === 'sample' ? 'text-violet-300' : 'text-zinc-400',
        )}
      />
    </div>
  )
}

export function AttachmentPreviewStrip({
  items,
  onRemove,
}: AttachmentPreviewStripProps) {
  if (!items.length) return null

  return (
    <div className="border-b border-zinc-800/70 px-2 py-2">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <div
            key={`${item.kind}-${item.id}`}
            className={cn(
              'group relative shrink-0 overflow-hidden rounded-xl border',
              item.kind === 'sample'
                ? 'border-violet-500/40 ring-1 ring-violet-500/20'
                : 'border-zinc-700/80',
            )}
          >
            <div className="relative h-14 w-[72px]">
              <Thumbnail item={item} />
              <button
                type="button"
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onRemove(item.id, item.kind)}
                aria-label={`移除 ${item.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            <div
              className={cn(
                'max-w-[72px] truncate px-1 py-0.5 text-center text-[9px]',
                item.kind === 'sample'
                  ? 'bg-violet-500/15 text-violet-200'
                  : 'bg-zinc-900/90 text-zinc-400',
              )}
            >
              {item.kind === 'sample' ? '样例' : item.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
