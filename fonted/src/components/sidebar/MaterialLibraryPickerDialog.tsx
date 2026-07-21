import { Check, Film, ImageIcon, Music2, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { InputAttachment } from '@/stores/creationStore'
import {
  useMaterialLibraryStore,
  type MaterialType,
  type UserMaterial,
} from '@/stores/materialLibraryStore'

type PickerFilter = 'all' | MaterialType

const TYPE_ICON: Record<MaterialType, typeof Film> = {
  video: Film,
  image: ImageIcon,
  audio: Music2,
}

const FILTER_LABEL: Record<PickerFilter, string> = {
  all: '全部',
  video: '视频',
  image: '图片',
  audio: '音频',
}

function matchesQuery(material: UserMaterial, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [material.name, material.type, ...material.tags]
    .join(' ')
    .toLowerCase()
    .includes(q)
}

function toAttachment(material: UserMaterial): InputAttachment {
  return {
    id: `att_lib_${material.id}`,
    name: material.name,
    type: material.type,
    url: material.url,
    source: 'library',
    materialId: material.id,
    tags: material.tags,
  }
}

interface MaterialLibraryPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (items: InputAttachment[]) => void
}

export function MaterialLibraryPickerDialog({
  open,
  onOpenChange,
  onConfirm,
}: MaterialLibraryPickerDialogProps) {
  const materials = useMaterialLibraryStore((s) => s.materials)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<PickerFilter>('all')
  const [query, setQuery] = useState('')

  const counts: Record<PickerFilter, number> = {
    all: materials.length,
    video: materials.filter((m) => m.type === 'video').length,
    image: materials.filter((m) => m.type === 'image').length,
    audio: materials.filter((m) => m.type === 'audio').length,
  }

  const filteredMaterials = useMemo(
    () =>
      materials.filter((material) => {
        if (filter !== 'all' && material.type !== filter) return false
        return matchesQuery(material, query)
      }),
    [filter, materials, query],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    const picked = materials
      .filter((material) => selected.has(material.id))
      .map(toAttachment)
    onConfirm(picked)
    setSelected(new Set())
    onOpenChange(false)
  }

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setSelected(new Set())
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-hidden sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-base">素材库</DialogTitle>
          <DialogDescription className="text-xs">
            从真实素材库选择图片、视频或音频；标签会同步进入解析和生成链路。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as PickerFilter)}
          >
            <TabsList className="w-full">
              {(['all', 'video', 'image', 'audio'] as PickerFilter[]).map(
                (item) => (
                  <TabsTrigger key={item} value={item} className="gap-1 px-2">
                    {FILTER_LABEL[item]}
                    <span className="rounded bg-zinc-950/80 px-1 text-[9px] text-zinc-500">
                      {counts[item]}
                    </span>
                  </TabsTrigger>
                ),
              )}
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / tag / 用途"
              className="h-8 pl-7 pr-8 text-xs"
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid max-h-[48vh] grid-cols-3 gap-2 overflow-y-auto py-1">
          {filteredMaterials.map((item) => {
            const isSelected = selected.has(item.id)
            const Icon = TYPE_ICON[item.type]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                className={cn(
                  'relative flex flex-col overflow-hidden rounded-lg border bg-zinc-900/70 text-left transition-all',
                  isSelected
                    ? 'border-violet-500/60 ring-2 ring-violet-500/30'
                    : 'border-zinc-800 hover:border-zinc-600',
                )}
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-zinc-950">
                  {item.type === 'image' && item.url.startsWith('blob:') ? (
                    <img
                      src={item.url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : item.type === 'video' && item.url.startsWith('blob:') ? (
                    <video
                      src={item.url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <Icon className="h-6 w-6 text-zinc-400/80" />
                  )}
                </div>
                {isSelected ? (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
                <span className="truncate px-1.5 pt-1 text-[10px] text-zinc-300">
                  {item.name}
                </span>
                <span className="truncate px-1.5 pb-1 text-[9px] text-zinc-600">
                  {item.tags.slice(0, 3).join(' · ')}
                </span>
              </button>
            )
          })}
          {filteredMaterials.length === 0 && (
            <div className="col-span-3 flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-xs text-zinc-500">
              当前没有匹配素材
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => close(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="highlight"
            size="sm"
            disabled={selected.size === 0}
            onClick={handleConfirm}
          >
            加入对话 ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
