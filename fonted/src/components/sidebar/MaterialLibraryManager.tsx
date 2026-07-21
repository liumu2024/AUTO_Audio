import {
  ArrowLeft,
  Eye,
  Film,
  ImageIcon,
  Music2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useCreationStore } from '@/stores/creationStore'
import { useEditorStore } from '@/stores/editorStore'
import {
  useMaterialLibraryStore,
  type MaterialType,
  type UserMaterial,
} from '@/stores/materialLibraryStore'

const TYPE_ICON: Record<MaterialType, typeof Film> = {
  video: Film,
  image: ImageIcon,
  audio: Music2,
}

const TYPE_LABEL: Record<MaterialType, string> = {
  video: '视频',
  image: '图片',
  audio: '音频',
}

type MaterialFilter = 'all' | MaterialType

const FILTER_LABEL: Record<MaterialFilter, string> = {
  all: '全部',
  video: '视频',
  image: '图片',
  audio: '音频',
}

function parseTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

function materialMatchesQuery(material: UserMaterial, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    material.name,
    material.type,
    ...material.tags,
    ...(material.analysis?.tags ?? []),
    ...((material.analysis?.segments ?? []).flatMap(
      (segment) => segment.emotion_tags ?? [],
    )),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q)
}

function tagPresetsFor(type: MaterialType): string[] {
  if (type === 'audio') return ['bgm', 'sfx', 'ambient', 'whoosh', 'hit']
  if (type === 'image') {
    return ['source_material', 'reference_material', 'cover', 'product', 'landscape']
  }
  return [
    'source_material',
    'sample_reference',
    'broll',
    'landscape_broll',
    'talking_head',
  ]
}

function MaterialThumbnail({ material }: { material: UserMaterial }) {
  const Icon = TYPE_ICON[material.type]
  const isLocalPreview =
    material.url.startsWith('blob:') || material.url.startsWith('data:')

  if (material.type === 'image' && isLocalPreview) {
    return (
      <img
        src={material.url}
        alt={material.name}
        className="h-full w-full object-contain"
      />
    )
  }

  if (material.type === 'video' && isLocalPreview) {
    return (
      <video
        src={material.url}
        className="h-full w-full object-contain"
        muted
        playsInline
        preload="metadata"
      />
    )
  }

  return <Icon className="h-8 w-8 text-zinc-500" />
}

function MaterialPreviewBody({ material }: { material: UserMaterial }) {
  const isLocalPreview =
    material.url.startsWith('blob:') || material.url.startsWith('data:')

  if (material.type === 'image') {
    return (
      <div className="flex max-h-[50vh] items-center justify-center rounded-lg bg-zinc-900 p-2">
        {isLocalPreview ? (
          <img
            src={material.url}
            alt={material.name}
            className="max-h-[48vh] max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-zinc-500">
            <ImageIcon className="h-12 w-12" />
            <p className="text-xs">远程图片暂无法预览（Mock URL）</p>
          </div>
        )}
      </div>
    )
  }

  if (material.type === 'video') {
    return (
      <div className="overflow-hidden rounded-lg bg-black">
        <video
          src={material.url}
          className="aspect-video w-full object-contain"
          controls
          playsInline
          preload="metadata"
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-zinc-900 p-4">
      <audio src={material.url} className="w-full" controls preload="metadata" />
    </div>
  )
}

export function MaterialLibraryManager({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const materials = useMaterialLibraryStore((s) => s.materials)
  const addFromFile = useMaterialLibraryStore((s) => s.addFromFile)
  const updateMaterial = useMaterialLibraryStore((s) => s.updateMaterial)
  const deleteMaterial = useMaterialLibraryStore((s) => s.deleteMaterial)

  const materialLibraryMode = useEditorStore((s) => s.materialLibraryMode)
  const closeMaterialLibrary = useEditorStore((s) => s.closeMaterialLibrary)
  const addAttachment = useCreationStore((s) => s.addAttachment)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<UserMaterial | null>(null)
  const [previewing, setPreviewing] = useState<UserMaterial | null>(null)
  const [editName, setEditName] = useState('')
  const [editTags, setEditTags] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<UserMaterial | null>(null)
  const [filter, setFilter] = useState<MaterialFilter>('all')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  const isPickMode = materialLibraryMode === 'pick'
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of materials) {
      for (const tag of material.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
  }, [materials])
  const filteredMaterials = materials.filter((m) => {
    if (filter !== 'all' && m.type !== filter) return false
    if (tagFilter && !m.tags.includes(tagFilter)) return false
    return materialMatchesQuery(m, query)
  })
  const counts: Record<MaterialFilter, number> = {
    all: materials.length,
    video: materials.filter((m) => m.type === 'video').length,
    image: materials.filter((m) => m.type === 'image').length,
    audio: materials.filter((m) => m.type === 'audio').length,
  }

  const openEdit = (m: UserMaterial) => {
    setEditing(m)
    setEditName(m.name)
    setEditTags(m.tags.join(', '))
  }

  const saveEdit = () => {
    if (!editing) return
    updateMaterial(editing.id, {
      name: editName.trim() || editing.name,
      tags: parseTagInput(editTags),
    })
    setEditing(null)
  }

  const toggleEditTag = (tag: string) => {
    const tags = new Set(parseTagInput(editTags))
    if (tags.has(tag)) tags.delete(tag)
    else tags.add(tag)
    setEditTags([...tags].join(', '))
  }

  const handlePick = (m: UserMaterial) => {
    addAttachment({
      id: `att_lib_${m.id}`,
      name: m.name,
      type: m.type,
      url: m.url,
      source: 'library',
      materialId: m.id,
      tags: m.tags,
    })
    closeMaterialLibrary()
  }

  const handleDelete = (m: UserMaterial) => {
    if (m.url.startsWith('blob:')) {
      URL.revokeObjectURL(m.url)
    }
    deleteMaterial(m.id)
    useCreationStore.getState().removeAttachment(`att_lib_${m.id}`)
    useCreationStore.getState().removeAttachment(`att_${m.id}`)
    useCreationStore.getState().removeAttachment(`att_${m.id.replace(/^mat_/, '')}`)
    if (previewing?.id === m.id) setPreviewing(null)
    if (editing?.id === m.id) setEditing(null)
    setDeleteTarget(null)
  }

  const handleUpload = (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      addFromFile(file)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-2 border-b border-zinc-800 pb-3">
        {!embedded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={closeMaterialLibrary}
            aria-label="返回"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-zinc-100">用户素材库</h3>
          <p className="text-[10px] text-zinc-500">
            {isPickMode ? '点击素材添加到创作指令' : '点击查看 · 可编辑删除'}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          上传
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <Tabs
        value={filter}
        onValueChange={(value) => {
          setFilter(value as MaterialFilter)
          setTagFilter(null)
        }}
        className="mb-3 shrink-0"
      >
        <TabsList className="w-full">
          {(['all', 'video', 'image', 'audio'] as MaterialFilter[]).map((item) => (
            <TabsTrigger key={item} value={item} className="gap-1 px-2">
              {FILTER_LABEL[item]}
              <span className="rounded bg-zinc-950/80 px-1 text-[9px] text-zinc-500">
                {counts[item]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mb-3 shrink-0 space-y-2">
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
        {popularTags.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {popularTags.map(([tag, count]) => {
              const active = tagFilter === tag
              return (
                <button
                  key={tag}
                  type="button"
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-1 text-[10px] transition-colors',
                    active
                      ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                      : 'border-zinc-800 bg-zinc-950/60 text-zinc-500 hover:text-zinc-300',
                  )}
                  onClick={() => setTagFilter(active ? null : tag)}
                >
                  {tag}
                  <span className="ml-1 text-zinc-600">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {materials.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 py-12 text-center">
          <Plus className="h-8 w-8 text-zinc-600" />
          <p className="text-xs text-zinc-500">暂无素材，点击上传添加</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            上传第一个素材
          </Button>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 py-12 text-center">
          <p className="text-xs text-zinc-500">当前筛选暂无素材</p>
          {(query || tagFilter) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('')
                setTagFilter(null)
              }}
            >
              清空筛选
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            上传素材
          </Button>
        </div>
      ) : (
        <ul className="scroll-area-y grid flex-1 grid-cols-2 gap-2 content-start pr-1">
          {filteredMaterials.map((m) => (
            <li
              key={m.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-2 transition-colors',
                'border-zinc-800 bg-zinc-900/60',
                isPickMode &&
                  'cursor-pointer hover:border-blue-500/50 hover:bg-zinc-900',
              )}
            >
              <button
                type="button"
                className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-zinc-800/80"
                onClick={() =>
                  isPickMode ? handlePick(m) : setPreviewing(m)
                }
              >
                <MaterialThumbnail material={m} />
                <span className="absolute left-1 top-1 rounded bg-zinc-950/80 px-1 py-0.5 text-[9px] text-zinc-400">
                  {TYPE_LABEL[m.type]}
                </span>
              </button>

              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-zinc-200">
                  {m.name}
                </p>
                {m.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="max-w-full truncate rounded bg-zinc-950/70 px-1.5 py-0.5 text-[9px] text-zinc-500"
                      >
                        {tag}
                      </span>
                    ))}
                    {m.tags.length > 4 && (
                      <span className="rounded bg-zinc-950/70 px-1.5 py-0.5 text-[9px] text-zinc-600">
                        +{m.tags.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!isPickMode && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 flex-1 gap-1 px-1 text-[10px] text-zinc-400"
                    onClick={() => setPreviewing(m)}
                  >
                    <Eye className="h-3 w-3" />
                    查看
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 flex-1 gap-1 px-1 text-[10px] text-zinc-400"
                    onClick={() => openEdit(m)}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 flex-1 gap-1 px-1 text-[10px] text-red-400/80 hover:text-red-400"
                    onClick={() => setDeleteTarget(m)}
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isPickMode && (
        <div className="mt-3 shrink-0 border-t border-zinc-800 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-xs text-zinc-500"
            onClick={() => useEditorStore.getState().openMaterialLibrary('pick')}
          >
            进入选取模式（添加到创作指令）
          </Button>
        </div>
      )}

      <Dialog
        open={!!previewing}
        onOpenChange={(o) => !o && setPreviewing(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{previewing?.name}</DialogTitle>
          </DialogHeader>
          {previewing && (
            <div className="space-y-3">
              <MaterialPreviewBody material={previewing} />
              <div className="space-y-1 text-xs text-zinc-500">
                <p>类型：{TYPE_LABEL[previewing.type]}</p>
                {previewing.tags.length > 0 && (
                  <p>标签：{previewing.tags.join(', ')}</p>
                )}
                <p className="break-all font-mono text-[10px] text-zinc-600">
                  {previewing.url}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPreviewing(null)}
            >
              关闭
            </Button>
            {previewing && !isPickMode && (
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 hover:bg-red-500"
                onClick={() => {
                  setDeleteTarget(previewing)
                  setPreviewing(null)
                }}
              >
                删除
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑素材</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">名称</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tags">标签（逗号分隔）</Label>
              <Input
                id="edit-tags"
                value={editTags}
                placeholder="hook, product, broll"
                onChange={(e) => setEditTags(e.target.value)}
              />
              {editing && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {tagPresetsFor(editing.type).map((tag) => {
                    const active = parseTagInput(editTags).includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={cn(
                          'rounded-full border px-2 py-1 text-[10px] transition-colors',
                          active
                            ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                            : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
                        )}
                        onClick={() => toggleEditTag(tag)}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button type="button" variant="primary" onClick={saveEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除素材</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            确定删除「{deleteTarget?.name}」？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-red-600 hover:bg-red-500"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
