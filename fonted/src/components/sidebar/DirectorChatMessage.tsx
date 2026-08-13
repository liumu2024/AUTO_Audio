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
  onRevisionDecision?: (input: { confirmationId: string; action: 'confirm' | 'reject' }) => void
}

export function DirectorChatMessageBubble({
  message,
  onRevisionDecision,
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

          {message.revisionIntent && !message.revisionReceipt ? (
            <div className="mt-2 space-y-1.5 rounded-lg border border-violet-500/20 bg-black/20 p-2 text-[11px] text-zinc-300">
              <p><span className="text-zinc-500">原始要求：</span>{message.revisionIntent.originalRequest}</p>
              <p><span className="text-zinc-500">范围：</span>{message.revisionIntent.scope}</p>
              <p><span className="text-zinc-500">目标：</span>{message.revisionIntent.targetIds.join('、') || '全片'}</p>
              <p><span className="text-zinc-500">修改指令：</span>{message.revisionIntent.instruction}</p>
              <p><span className="text-zinc-500">预计影响：</span>{message.revisionIntent.expectedImpact}</p>
              <p><span className="text-zinc-500">保护边界：</span>{message.revisionIntent.protectedBoundary}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={message.revisionDecisionStatus === 'confirming'}
                  className="rounded border border-emerald-400/30 px-2 py-1 text-emerald-200 disabled:opacity-50"
                  onClick={() => onRevisionDecision?.({ confirmationId: message.revisionConfirmationId ?? message.revisionIntent!.callId, action: 'confirm' })}>
                  确认执行
                </button>
                <button type="button" disabled={message.revisionDecisionStatus === 'confirming'}
                  className="rounded border border-zinc-500/30 px-2 py-1 text-zinc-300 disabled:opacity-50"
                  onClick={() => onRevisionDecision?.({ confirmationId: message.revisionConfirmationId ?? message.revisionIntent!.callId, action: 'reject' })}>
                  取消提案
                </button>
                <button type="button" className="rounded border border-violet-400/25 px-2 py-1 text-violet-200"
                  onClick={() => setInputText(`请重新理解这次修改。原要求：${message.revisionIntent!.originalRequest}`)}>
                  纠正后重提
                </button>
              </div>
            </div>
          ) : null}

          {message.revisionReceipt ? (
            <div className="mt-2 space-y-1.5 rounded-lg border border-violet-500/20 bg-black/20 p-2 text-[11px] text-zinc-300">
              <p><span className="text-zinc-500">原始要求：</span>{message.revisionReceipt.originalRequest}</p>
              <p><span className="text-zinc-500">范围：</span>{message.revisionReceipt.scope}</p>
              <p><span className="text-zinc-500">目标：</span>{message.revisionReceipt.targetIds.join('、') || '全片'}</p>
              <p><span className="text-zinc-500">修改指令：</span>{message.revisionReceipt.instruction}</p>
              <p><span className="text-zinc-500">预计影响：</span>{message.revisionReceipt.expectedImpact}</p>
              <p><span className="text-zinc-500">保护边界：</span>{message.revisionReceipt.protectedBoundary}</p>
              <p><span className="text-zinc-500">执行回执：</span>{message.revisionReceipt.summary}</p>
              {message.revisionReceipt.actualDiff ? (
                <details>
                  <summary className="cursor-pointer text-violet-200">实际变化</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-400">
                    {[
                      ...message.revisionReceipt.actualDiff.scenes,
                      ...message.revisionReceipt.actualDiff.visibleText,
                      ...message.revisionReceipt.actualDiff.transitions,
                      ...message.revisionReceipt.actualDiff.audio,
                      ...message.revisionReceipt.actualDiff.other,
                    ].map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </details>
              ) : null}
              <button
                type="button"
                className="rounded border border-violet-400/25 px-2 py-1 text-violet-200 hover:bg-violet-500/10"
                onClick={() => setInputText(`请纠正刚才的修改理解。原要求：${message.revisionReceipt!.originalRequest}`)}
              >
                纠正修改理解
              </button>
            </div>
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
