import { create } from 'zustand'

import type { InputAttachment } from '@/stores/creationStore'
import type { OutlineSegment } from '@/types/pipeline'

export type DirectorMessageKind =
  | 'text'
  | 'thought'
  | 'outline'
  | 'progress'
  | 'error'
  | 'generation'

export type DirectorMessageStatus = 'pending' | 'streaming' | 'done' | 'error'

export interface DirectorChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  kind: DirectorMessageKind
  attachments?: InputAttachment[]
  outline?: OutlineSegment[]
  thoughts?: string[]
  recoverySuggestions?: Array<{ label: string; prompt: string }>
  createdAt: number
  status?: DirectorMessageStatus
}

let messageCounter = 0

function nextId(prefix: string): string {
  messageCounter += 1
  return `${prefix}_${Date.now()}_${messageCounter}`
}

const WELCOME_MESSAGE: DirectorChatMessage = {
  id: 'welcome',
  role: 'assistant',
  kind: 'text',
  content:
    '你好，我是 AI 导演助理。你可以先和我聊想做什么、让我拆解样例、讨论风格方案，或者直接上传视频/图片开始执行；需要真正生成或渲染时，我再提醒你补齐必要素材。',
  createdAt: 0,
  status: 'done',
}

interface DirectorChatState {
  messages: DirectorChatMessage[]
  isSending: boolean
  addUserMessage: (input: {
    content: string
    attachments?: InputAttachment[]
  }) => string
  addAssistantMessage: (input: {
    content: string
    kind?: DirectorMessageKind
    outline?: OutlineSegment[]
    status?: DirectorMessageStatus
  }) => string
  addProgressMessage: (content: string) => string
  addThoughtMessage: (input: {
    content: string
    thoughts: string[]
    status?: DirectorMessageStatus
  }) => string
  appendThought: (id: string, thought: string) => void
  updateMessage: (id: string, patch: Partial<DirectorChatMessage>) => void
  setSending: (v: boolean) => void
  ensureWelcome: () => void
  pushOutlineResult: (outline: OutlineSegment[], intro?: string) => void
  pushGenerationResult: (content: string) => void
  pushError: (
    content: string,
    recoverySuggestions?: Array<{ label: string; prompt: string }>,
  ) => void
  restoreSession: (input: {
    sampleName?: string
    globalPrompt?: string
    outline?: OutlineSegment[]
  }) => void
  reset: () => void
}

export const useDirectorChatStore = create<DirectorChatState>((set, get) => ({
  messages: [],
  isSending: false,

  addUserMessage: ({ content, attachments }) => {
    const id = nextId('user')
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'user',
          kind: 'text',
          content,
          attachments,
          createdAt: Date.now(),
          status: 'done',
        },
      ],
    }))
    return id
  },

  addAssistantMessage: ({
    content,
    kind = 'text',
    outline,
    status = 'done',
  }) => {
    const id = nextId('assistant')
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'assistant',
          kind,
          content,
          outline,
          createdAt: Date.now(),
          status,
        },
      ],
    }))
    return id
  },

  addProgressMessage: (content) => {
    const id = nextId('progress')
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'assistant',
          kind: 'progress',
          content,
          createdAt: Date.now(),
          status: 'streaming',
        },
      ],
    }))
    return id
  },

  addThoughtMessage: ({ content, thoughts, status = 'done' }) => {
    const id = nextId('thought')
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role: 'assistant',
          kind: 'thought',
          content,
          thoughts,
          createdAt: Date.now(),
          status,
        },
      ],
    }))
    return id
  },

  appendThought: (id, thought) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              thoughts: [...(m.thoughts ?? []), thought],
            }
          : m,
      ),
    })),

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  setSending: (isSending) => set({ isSending }),

  ensureWelcome: () => {
    const { messages } = get()
    if (messages.length === 0) set({ messages: [WELCOME_MESSAGE] })
  },

  pushOutlineResult: (outline, intro) => {
    get().addAssistantMessage({
      content:
        intro ??
        `已完成样例视频的结构拆解，共识别 ${outline.length} 个语义段落。你可以在时间线微调，或继续告诉我如何生成成片。`,
      kind: 'outline',
      outline,
    })
  },

  pushGenerationResult: (content) => {
    get().addAssistantMessage({ content, kind: 'generation' })
  },

  pushError: (content, recoverySuggestions) => {
    get().addAssistantMessage({
      content,
      kind: 'error',
      status: 'error',
    })
    if (recoverySuggestions?.length) {
      set((s) => ({
        messages: s.messages.map((message, index) =>
          index === s.messages.length - 1
            ? { ...message, recoverySuggestions }
            : message,
        ),
      }))
    }
  },

  restoreSession: ({ sampleName, globalPrompt, outline }) => {
    const msgs: DirectorChatMessage[] = [WELCOME_MESSAGE]

    if (sampleName || globalPrompt) {
      msgs.push({
        id: nextId('restored_user'),
        role: 'user',
        kind: 'text',
        content: globalPrompt?.trim() || '继续上次的创作任务',
        attachments: sampleName
          ? [
              {
                id: 'restored_sample',
                name: sampleName,
                type: 'video',
                url: '',
                source: 'upload',
              },
            ]
          : undefined,
        createdAt: Date.now() - 1000,
        status: 'done',
      })
    }

    if (outline?.length) {
      msgs.push({
        id: nextId('restored_outline'),
        role: 'assistant',
        kind: 'outline',
        content: `已恢复上次任务的拆解大纲：${outline.length} 段。`,
        outline,
        createdAt: Date.now(),
        status: 'done',
      })
    }

    set({ messages: msgs })
  },

  reset: () => set({ messages: [], isSending: false }),
}))
