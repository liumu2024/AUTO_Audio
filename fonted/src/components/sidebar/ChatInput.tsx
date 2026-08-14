import { ArrowUp, FolderOpen, Paperclip, Square } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import {
  AttachmentPreviewStrip,
  type AttachmentPreviewItem,
  type PreviewItemKind,
} from '@/components/sidebar/AttachmentPreviewStrip'
import { MaterialLibraryPickerDialog } from '@/components/sidebar/MaterialLibraryPickerDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ingestAttachmentFiles, retryAttachmentFileUpload } from '@/services/director/attachmentUploads'
import type { InputAttachment } from '@/stores/creationStore'
import { useCreationStore } from '@/stores/creationStore'

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
  const attachmentUploads = useCreationStore((s) => s.attachmentUploads)
  const pendingAttachmentIds = useCreationStore((s) => s.pendingAttachmentIds)
  const showSampleInInputTray = useCreationStore((s) => s.showSampleInInputTray)
  const isSampleParsed = useCreationStore((s) => s.isSampleParsed)
  const aspectRatio = useCreationStore((s) => s.aspectRatio)
  const styleIntensity = useCreationStore((s) => s.styleIntensity)
  const setAspectRatio = useCreationStore((s) => s.setAspectRatio)
  const setStyleIntensity = useCreationStore((s) => s.setStyleIntensity)
  const clearSample = useCreationStore((s) => s.clearSample)
  const addAttachment = useCreationStore((s) => s.addAttachment)
  const removeAttachmentUpload = useCreationStore((s) => s.removeAttachmentUpload)
  const removeAttachment = useCreationStore((s) => s.removeAttachment)

  const draft = useCreationStore((s) => s.inputText)
  const setDraft = useCreationStore((s) => s.setInputText)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const placeholder =
    '描述想生成的视频；可选上传样例作风格参考，或上传图片 / 视频 / 音频作创作素材...'

  const previewItems: AttachmentPreviewItem[] = useMemo(() => {
    const items: AttachmentPreviewItem[] = []
    if (sampleUrl && showSampleInInputTray) {
      items.push({
        id: '__sample__',
        name: sampleName || '样例视频',
        type: 'video',
        url: sampleUrl,
        kind: 'sample',
      })
    }
    for (const att of attachments.filter((item) => pendingAttachmentIds.includes(item.id))) {
      items.push({
        id: att.id,
        name: att.name,
        type: att.type,
        url: att.url,
        kind: 'material',
      })
    }
    return items
  }, [attachments, pendingAttachmentIds, sampleName, sampleUrl, showSampleInInputTray])

  const handleRemove = (id: string, kind: PreviewItemKind) => {
    if (kind === 'sample') clearSample()
    else removeAttachment(id)
  }

  const handleLibraryConfirm = (picked: InputAttachment[]) => {
    for (const item of picked) addAttachment(item)
  }

  const sendText = (text: string) => {
    if (disabled || attachmentUploads.length > 0) return
    void onSend(text)
    setDraft('')
  }

  const handleSend = () => {
    const text = draft.trim()
    if (disabled || attachmentUploads.length > 0) return
    if (!text && previewItems.length === 0) return
    sendText(text)
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
          {attachmentUploads.length ? (
            <div className="space-y-1 border-b border-zinc-800/60 px-3 py-2 text-[11px]">
              {attachmentUploads.map((upload) => (
                <div key={upload.id} className="flex items-center justify-between gap-2 text-zinc-400">
                  <span className="min-w-0 truncate">
                    {upload.name} · {upload.status === 'uploading' ? '上传中' : `上传失败${upload.error ? `：${upload.error}` : ''}`}
                  </span>
                  {upload.status === 'failed' ? (
                    <span className="flex shrink-0 gap-2">
                      <button type="button" className="text-violet-300 hover:text-violet-200" onClick={() => retryAttachmentFileUpload(upload)}>重试</button>
                      <button type="button" className="text-zinc-500 hover:text-zinc-300" onClick={() => removeAttachmentUpload(upload.id)}>移除</button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

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

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800/60 px-2 py-1.5">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  ingestAttachmentFiles(e.target.files)
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
                    attachmentUploads.length > 0 ||
                    (!draft.trim() && previewItems.length === 0)
              }
              onClick={disabled && onCancel ? onCancel : handleSend}
              aria-label={disabled && onCancel ? '停止等待' : '发送'}
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
            ? 'Enter 发送。样例只提供结构和风格；附件作为成片候选素材。'
            : 'Enter 发送。附件默认作为创作素材；明确要求解析或复刻时，才会把视频作为样例。'}
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
