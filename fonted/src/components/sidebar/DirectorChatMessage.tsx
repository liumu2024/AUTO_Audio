import {
  AlertCircle,
  Bot,
  Brain,
  Film,
  ImageIcon,
  Loader2,
  Music2,
  User,
  Video,
} from 'lucide-react'

import { OutlineWidget } from '@/components/sidebar/OutlineWidget'
import { cn } from '@/lib/utils'
import { useCreationStore, type InputAttachment } from '@/stores/creationStore'
import type { DirectorChatMessage } from '@/stores/directorChatStore'

const TYPE_ICON = {
  video: Film,
  image: ImageIcon,
  audio: Music2,
} as const

function AttachmentChips({ items }: { items: InputAttachment[] }) {
  if (!items.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((att) => {
        const Icon = TYPE_ICON[att.type]
        const isSample =
          att.id === 'restored_sample' ||
          att.id === 'sample_video' ||
          att.name.includes('样例')
        return (
          <span
            key={att.id}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-[10px]',
              isSample
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-200'
                : 'border-zinc-700/80 bg-zinc-800/60 text-zinc-300',
            )}
          >
            <Icon className="h-3 w-3 shrink-0 opacity-70" />
            <span className="max-w-[120px] truncate">{att.name}</span>
            {isSample ? (
              <span className="rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">
                样例
              </span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

interface DirectorChatMessageBubbleProps {
  message: DirectorChatMessage
}

export function DirectorChatMessageBubble({
  message,
}: DirectorChatMessageBubbleProps) {
  const setInputText = useCreationStore((s) => s.setInputText)
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
  const isError = message.kind === 'error'
  const isThought = message.kind === 'thought'

  return (
    <div
      className={cn(
        'flex gap-2.5 px-1',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
          isUser
            ? 'bg-zinc-800 ring-zinc-700 text-zinc-300'
            : 'bg-violet-500/15 ring-violet-500/25 text-violet-300',
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div
        className={cn(
          'min-w-0 max-w-[92%] flex-1',
          isUser ? 'flex flex-col items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
            isUser
              ? 'rounded-tr-md bg-blue-600/90 text-white shadow-sm'
              : isThought
                ? 'rounded-tl-md border border-violet-500/25 bg-violet-950/20 text-violet-100'
                : isError
                  ? 'rounded-tl-md border border-red-500/25 bg-red-950/30 text-red-200'
                  : 'rounded-tl-md border border-zinc-800/90 bg-zinc-900/80 text-zinc-200',
          )}
        >
          {isStreaming && !isThought ? (
            <span className="inline-flex items-center gap-2 text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
              {message.content}
            </span>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}

          {isThought && message.thoughts?.length ? (
            <details className="mt-2 rounded-lg border border-violet-500/15 bg-black/20 p-2">
              <summary className="cursor-pointer select-none text-[11px] font-medium text-violet-200/85">
                技术详情
              </summary>
              <div className="mt-2 space-y-1.5">
                {message.thoughts.map((item, index) => (
                  <div
                    key={`${message.id}-${index}`}
                    className="flex gap-2 text-[11px] leading-relaxed text-violet-100/85"
                  >
                    <Brain className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" />
                    <span>{item}</span>
                  </div>
                ))}
                {isStreaming ? (
                  <div className="flex gap-2 text-[11px] text-violet-200/70">
                    <Loader2 className="mt-0.5 h-3 w-3 animate-spin" />
                    <span>继续分析中...</span>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {message.attachments?.length ? (
            <AttachmentChips items={message.attachments} />
          ) : null}

          {message.kind === 'outline' && message.outline?.length ? (
            <OutlineWidget outline={message.outline} className="mt-3" />
          ) : null}

          {message.kind === 'generation' && !isStreaming ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400/90">
              <Video className="h-3.5 w-3.5" />
              成片已更新到右侧预览区
            </div>
          ) : null}

          {isError ? (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-red-400/80">
              <AlertCircle className="h-3 w-3" />
              请检查后端与 worker 状态后重试
            </div>
          ) : null}
          {isError && message.recoverySuggestions?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.recoverySuggestions.map((suggestion) => (
                <button
                  key={`${message.id}-${suggestion.label}`}
                  type="button"
                  className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1 text-[11px] text-red-100 transition hover:border-red-300/50 hover:bg-red-500/20"
                  onClick={() => setInputText(suggestion.prompt)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
