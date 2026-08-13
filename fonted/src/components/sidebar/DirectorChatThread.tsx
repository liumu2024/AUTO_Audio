import { useEffect, useRef } from 'react'

import { DirectorChatMessageBubble } from '@/components/sidebar/DirectorChatMessage'
import { useDirectorChatStore } from '@/stores/directorChatStore'

export function DirectorChatThread({
  onRevisionDecision,
}: {
  onRevisionDecision?: (input: { confirmationId: string; action: 'confirm' | 'reject' }) => void
}) {
  const messages = useDirectorChatStore((s) => s.messages)
  const ensureWelcome = useDirectorChatStore((s) => s.ensureWelcome)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ensureWelcome()
  }, [ensureWelcome])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="scroll-area-y flex min-h-0 flex-1 flex-col gap-4 px-1 py-3">
      {messages.map((message) => (
        <DirectorChatMessageBubble key={message.id} message={message} onRevisionDecision={onRevisionDecision} />
      ))}
      <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
    </div>
  )
}
