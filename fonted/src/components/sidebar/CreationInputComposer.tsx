import {
  Film,
  FolderOpen,
  ImageIcon,
  Music2,
  Paperclip,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreationStore } from '@/stores/creationStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore'

const TYPE_ICON = {
  video: Film,
  image: ImageIcon,
  audio: Music2,
} as const

export function CreationInputComposer() {
  const sampleUrl = useCreationStore((s) => s.sampleUrl)
  const sampleName = useCreationStore((s) => s.sampleName)
  const inputText = useCreationStore((s) => s.inputText)
  const attachments = useCreationStore((s) => s.attachments)
  const setSampleUrl = useCreationStore((s) => s.setSampleUrl)
  const setInputText = useCreationStore((s) => s.setInputText)
  const addAttachment = useCreationStore((s) => s.addAttachment)
  const removeAttachment = useCreationStore((s) => s.removeAttachment)
  const addFromFile = useMaterialLibraryStore((s) => s.addFromFile)
  const updateMaterial = useMaterialLibraryStore((s) => s.updateMaterial)
  const openMaterialLibrary = useEditorStore((s) => s.openMaterialLibrary)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sampleInputRef = useRef<HTMLInputElement>(null)

  const handleSampleVideo = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const material = addFromFile(file)
    updateMaterial(material.id, {
      tags: [...material.tags, 'sample_reference'],
    })
    setSampleUrl(material.url, file.name)
  }

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const material = addFromFile(file)
      addAttachment({
        id: `att_${material.id}`,
        name: material.name,
        type: material.type,
        url: material.url,
        source: 'upload',
        materialId: material.id,
        tags: material.tags,
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="space-y-2">
        <Label>样例视频（必填）</Label>
        <div
          className={cn(
            'flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3',
          )}
        >
          {sampleUrl ? (
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <Video className="h-4 w-4 shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1 truncate">
                {sampleName || '已选择样例视频'}
              </span>
              <button
                type="button"
                className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                onClick={() => setSampleUrl('', '')}
                aria-label="移除样例视频"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">上传待拆解的样例短视频</p>
          )}
          <input
            ref={sampleInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              handleSampleVideo(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => sampleInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {sampleUrl ? '更换样例视频' : '上传样例视频'}
          </Button>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <Label htmlFor="creation-input">创作指令与参考素材</Label>
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-xl',
          'border border-zinc-800 bg-zinc-900/50 shadow-inner shadow-black/20',
        )}
      >
        <Textarea
          id="creation-input"
          placeholder="输入视频主题、卖点、风格描述… 可附带图片、视频或音频作为参考"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="min-h-[140px] resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-zinc-800/80 px-2 py-2">
            {attachments.map((att) => {
              const Icon = TYPE_ICON[att.type]
              return (
                <span
                  key={att.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-800/80 py-0.5 pl-1.5 pr-1 text-[10px] text-zinc-300"
                >
                  <Icon className="h-3 w-3 shrink-0 text-zinc-500" />
                  <span className="max-w-[88px] truncate">{att.name}</span>
                  <button
                    type="button"
                    className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                    onClick={() => removeAttachment(att.id)}
                    aria-label={`移除 ${att.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-1 border-t border-zinc-800/80 px-2 py-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:text-zinc-100"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-3.5 w-3.5" />
            上传文件
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-zinc-400 hover:text-zinc-100"
            onClick={() => openMaterialLibrary('pick')}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            素材库
          </Button>
        </div>
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-600">
        支持上传图片 / 视频 / 音频，或从素材库选取；素材库可单独管理增删改。
      </p>
      </fieldset>
    </div>
  )
}
