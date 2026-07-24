import { create } from 'zustand'
import type { DirectorAspectRatio } from '@shared/types/director-context'

export type AttachmentSource = 'upload' | 'library'

export interface InputAttachment {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  source: AttachmentSource
  materialId?: string
  tags?: string[]
}

interface CreationState {
  sampleUrl: string
  sampleName: string
  inputText: string
  attachments: InputAttachment[]
  pendingAttachmentIds: string[]
  showSampleInInputTray: boolean
  aspectRatio: DirectorAspectRatio
  durationSec?: number
  styleIntensity: 'light' | 'medium' | 'strong'
  isAnalyzing: boolean
  /** 样例视频是否已完成结构拆解（有 pipeline 结果） */
  isSampleParsed: boolean
  setSampleUrl: (url: string, name?: string) => void
  setInputText: (text: string) => void
  addAttachment: (item: InputAttachment) => void
  removeAttachment: (id: string) => void
  clearInputTray: () => void
  setAspectRatio: (aspectRatio: DirectorAspectRatio) => void
  setDurationSec: (durationSec?: number) => void
  setStyleIntensity: (styleIntensity: 'light' | 'medium' | 'strong') => void
  setAnalyzing: (v: boolean) => void
  setSampleParsed: (v: boolean) => void
  clearSample: () => void
  restoreFromServer: (input: {
    sampleUrl: string
    sampleName?: string
    inputText?: string
    isSampleParsed?: boolean
  }) => void
}

function attachmentDedupKey(item: InputAttachment): string {
  return item.materialId ?? item.id.replace(/^att_(lib_)?/, '')
}

export const useCreationStore = create<CreationState>((set, get) => ({
  sampleUrl: '',
  sampleName: '',
  inputText: '',
  attachments: [],
  pendingAttachmentIds: [],
  showSampleInInputTray: false,
  aspectRatio: '9:16',
  durationSec: undefined,
  styleIntensity: 'medium',
  isAnalyzing: false,
  isSampleParsed: false,

  setSampleUrl: (sampleUrl, name) =>
    set({
      sampleUrl,
      sampleName: name ?? get().sampleName,
      showSampleInInputTray: Boolean(sampleUrl),
    }),
  setInputText: (inputText) => set({ inputText }),
  addAttachment: (item) => {
    const existing = get().attachments.find((a) => attachmentDedupKey(a) === attachmentDedupKey(item))
    if (existing) {
      set((s) => ({
        attachments: s.attachments.map((attachment) =>
          attachment.id === existing.id
            ? {
                ...attachment,
                name: item.name,
                type: item.type,
                url: item.url,
                source: item.source,
                materialId: item.materialId,
                tags: item.tags,
              }
            : attachment,
        ),
        pendingAttachmentIds: [...new Set([...s.pendingAttachmentIds, existing.id])],
      }))
      return
    }
    set((s) => ({
      attachments: [...s.attachments, item],
      pendingAttachmentIds: [...new Set([...s.pendingAttachmentIds, item.id])],
    }))
  },
  removeAttachment: (id) =>
    set((s) => ({
      attachments: s.attachments.filter((a) => a.id !== id),
      pendingAttachmentIds: s.pendingAttachmentIds.filter((item) => item !== id),
    })),
  clearInputTray: () => set({ pendingAttachmentIds: [], showSampleInInputTray: false }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setStyleIntensity: (styleIntensity) => set({ styleIntensity }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setSampleParsed: (isSampleParsed) => set({ isSampleParsed }),
  clearSample: () =>
    set({
      sampleUrl: '',
      sampleName: '',
      showSampleInInputTray: false,
      isSampleParsed: false,
    }),
  restoreFromServer: ({ sampleUrl, sampleName, inputText, isSampleParsed }) =>
    set({
      sampleUrl,
      sampleName: sampleName ?? '',
      inputText: inputText ?? '',
      isSampleParsed: isSampleParsed ?? false,
      pendingAttachmentIds: [],
      showSampleInInputTray: false,
    }),
}))
