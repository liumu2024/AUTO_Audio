import { ArrowUp, FolderOpen, Paperclip, Square } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import {
  AttachmentPreviewStrip,
  type AttachmentPreviewItem,
  type PreviewItemKind,
} from '@/components/sidebar/AttachmentPreviewStrip'
import { MaterialLibraryPickerDialog } from '@/components/sidebar/MaterialLibraryPickerDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { InputAttachment } from '@/stores/creationStore'
import { useCreationStore } from '@/stores/creationStore'
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'

interface ChatInputProps {
  disabled?: boolean
  busyLabel?: string
  onCancel?: () => void
  onSend: (text: string) => void | Promise<void>
}

export function ChatInput({
  disabled,
  busyLabel = '处理中...',
  onCancel,
  onSend,
}: ChatInputProps) {
  const sampleUrl = useCreationStore((s) => s.sampleUrl)
  const sampleName = useCreationStore((s) => s.sampleName)
  const attachments = useCreationStore((s) => s.attachments)
  const isSampleParsed = useCreationStore((s) => s.isSampleParsed)
  const aspectRatio = useCreationStore((s) => s.aspectRatio)
  const styleIntensity = useCreationStore((s) => s.styleIntensity)
  const setSampleUrl = useCreationStore((s) => s.setSampleUrl)
  const setAspectRatio = useCreationStore((s) => s.setAspectRatio)
  const setStyleIntensity = useCreationStore((s) => s.setStyleIntensity)
  const clearSample = useCreationStore((s) => s.clearSample)
  const addAttachment = useCreationStore((s) => s.addAttachment)
  const removeAttachment = useCreationStore((s) => s.removeAttachment)
  const addFromFile = useMaterialLibraryStore((s) => s.addFromFile)
  const updateMaterial = useMaterialLibraryStore((s) => s.updateMaterial)
  const setRenderPlanAspectRatio = useRenderPlanStore((s) => s.setAspectRatio)

  const [draft, setDraft] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const placeholder = isSampleParsed
    ? '继续补充创作意图，或上传图片 / 视频 / 音频作为参考素材...'
    : '上传 1 个样例视频，并写下你想生成的新主题 / 风格方向...'

  const ingestFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files?.length) return
      for (const file of Array.from(files)) {
        const mime = file.type
        let type: 'video' | 'image' | 'audio' = 'image'
        if (mime.startsWith('video/')) type = 'video'
        else if (mime.startsWith('audio/')) type = 'audio'
        else if (!mime.startsWith('image/')) continue

        const material = addFromFile(file)
        if (type === 'video' && !isSampleParsed && !sampleUrl) {
          updateMaterial(material.id, {
            tags: [...material.tags, 'sample_reference'],
          })
          setSampleUrl(material.url, file.name)
          continue
        }

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
    },
    [
      addAttachment,
      addFromFile,
      isSampleParsed,
      sampleUrl,
      setSampleUrl,
      updateMaterial,
    ],
  )

  const previewItems: AttachmentPreviewItem[] = useMemo(() => {
    const items: AttachmentPreviewItem[] = []
    if (sampleUrl) {
      items.push({
        id: '__sample__',
        name: sampleName || '样例视频',
        type: 'video',
        url: sampleUrl,
        kind: 'sample',
      })
    }
    for (const att of attachments) {
      items.push({
        id: att.id,
        name: att.name,
        type: att.type,
        url: att.url,
        kind: 'material',
      })
    }
    return items
  }, [attachments, sampleName, sampleUrl])

  const handleRemove = (id: string, kind: PreviewItemKind) => {
    if (kind === 'sample') clearSample()
    else removeAttachment(id)
  }

  const handleLibraryConfirm = (picked: InputAttachment[]) => {
    for (const item of picked) addAttachment(item)
  }

  const sendText = (text: string) => {
    if (disabled) return
    void onSend(text)
    setDraft('')
  }

  const handleSend = () => {
    const text = draft.trim()
    if (disabled) return
    if (!text && !sampleUrl && attachments.length === 0) return
    sendText(text)
  }

  const handleQuickAction = (
    type: 'rewrite_plan' | 'rerender' | 'revise_and_render',
  ) => {
    if (type === 'rewrite_plan') {
      sendText('重新生成方案：根据当前样例解析和素材重排时间线方案，不要直接渲染。')
      return
    }
    if (type === 'rerender') {
      sendText('按当前右侧时间线方案重新渲染，直接输出新的 mp4。')
      return
    }
    sendText(`先修改当前时间线方案，再重新渲染：${draft.trim() || '按当前输入框的修改要求'}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/80 px-2 py-2.5 backdrop-blur-sm">
        <div
          className={cn(
            'flex flex-col overflow-hidden rounded-2xl border border-zinc-800',
            'bg-zinc-900/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
          )}
        >
          <AttachmentPreviewStrip items={previewItems} onRemove={handleRemove} />

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            rows={3}
            className={cn(
              'max-h-36 min-h-[72px] w-full resize-none bg-transparent px-3 py-2.5',
              'text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600',
              'focus:outline-none disabled:opacity-50',
            )}
          />

          {isSampleParsed ? (
            <div className="flex flex-wrap gap-1.5 border-t border-zinc-800/60 px-2 py-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={disabled}
                onClick={() => handleQuickAction('rewrite_plan')}
              >
                重新生成方案
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={disabled}
                onClick={() => handleQuickAction('rerender')}
              >
                重新渲染
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={disabled}
                onClick={() => handleQuickAction('revise_and_render')}
              >
                按提示修改后渲染
              </Button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800/60 px-2 py-1.5">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  ingestFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-100"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                aria-label="上传本地文件"
                title="上传样例视频或参考素材"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-[11px] text-zinc-500 hover:text-zinc-200"
                onClick={() => setLibraryOpen(true)}
                disabled={disabled}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                素材库
              </Button>
              <select
                className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-300 outline-none"
                value={aspectRatio}
                onChange={(e) => {
                  const nextAspectRatio = e.target.value as typeof aspectRatio
                  setAspectRatio(nextAspectRatio)
                  setRenderPlanAspectRatio(nextAspectRatio)
                }}
                title="成片比例"
              >
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="1:1">1:1</option>
              </select>
              <select
                className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-300 outline-none"
                value={styleIntensity}
                onChange={(e) =>
                  setStyleIntensity(e.target.value as typeof styleIntensity)
                }
                title="风格强度"
              >
                <option value="light">轻</option>
                <option value="medium">中</option>
                <option value="strong">强</option>
              </select>
            </div>

            <Button
              type="button"
              variant={disabled && onCancel ? 'secondary' : 'highlight'}
              size="sm"
              className={cn(
                'h-8 w-8 rounded-full p-0',
                disabled &&
                  onCancel &&
                  'border-red-500/30 bg-red-500/15 text-red-200 hover:bg-red-500/25',
              )}
              disabled={
                disabled && onCancel
                  ? false
                  : disabled ||
                    (!draft.trim() && !sampleUrl && attachments.length === 0)
              }
              onClick={disabled && onCancel ? onCancel : handleSend}
              aria-label={disabled && onCancel ? '中止' : '发送'}
              title={disabled && onCancel ? busyLabel : '发送'}
            >
              {disabled && onCancel ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <p className="mt-1.5 px-1 text-[10px] text-zinc-600">
          {isSampleParsed
            ? 'Enter 发送。样例只提供结构和风格，附件作为成片候选素材。'
            : 'Enter 发送。第一个视频是样例，其它附件是参考素材。'}
        </p>
      </div>

      <MaterialLibraryPickerDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        onConfirm={handleLibraryConfirm}
      />
    </>
  )
}
