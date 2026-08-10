import { create } from 'zustand'
import type { DirectorAspectRatio, DirectorMaterialContext } from '@shared/types/director-context'

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
  materialsSnapshotAuthoritative: boolean
  sampleSnapshotAuthoritative: boolean
  showSampleInInputTray: boolean
  aspectRatio: DirectorAspectRatio
  aspectRatioExplicit: boolean
  durationSec?: number
  styleIntensity: 'light' | 'medium' | 'strong'
  styleIntensityExplicit: boolean
  isAnalyzing: boolean
  /** 样例视频是否已完成结构拆解（有 pipeline 结果） */
  isSampleParsed: boolean
  setSampleUrl: (url: string, name?: string) => void
  acceptServerSample: (
    sample?: { id: string; url: string; name?: string; parsed?: boolean },
    acknowledgeLocalChanges?: boolean,
  ) => void
  acceptServerMaterials: (materials: DirectorMaterialContext[], acknowledgeLocalChanges?: boolean) => void
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

function materialIdentity(items: Array<Pick<InputAttachment, 'id' | 'materialId' | 'type' | 'url'>>): string[] {
  return items.map((item) => `${item.materialId ?? item.id.replace(/^att_(lib_)?/, '')}\0${item.type}\0${item.url}`).sort()
}

export const useCreationStore = create<CreationState>((set, get) => ({
  sampleUrl: '',
  sampleName: '',
  inputText: '',
  attachments: [],
  pendingAttachmentIds: [],
  materialsSnapshotAuthoritative: false,
  sampleSnapshotAuthoritative: false,
  showSampleInInputTray: false,
  aspectRatio: '9:16',
  aspectRatioExplicit: false,
  durationSec: undefined,
  styleIntensity: 'medium',
  styleIntensityExplicit: false,
  isAnalyzing: false,
  isSampleParsed: false,

  setSampleUrl: (sampleUrl, name) =>
    set((state) => ({
      sampleUrl,
      sampleName: name ?? state.sampleName,
      sampleSnapshotAuthoritative: true,
      showSampleInInputTray: Boolean(sampleUrl),
      isSampleParsed: sampleUrl === state.sampleUrl ? state.isSampleParsed : false,
    })),
  acceptServerSample: (sample, acknowledgeLocalChanges = false) =>
    set((state) => {
      if (
        state.sampleSnapshotAuthoritative
        && (!acknowledgeLocalChanges || state.sampleUrl !== (sample?.url ?? ''))
      ) return state
      return {
        sampleUrl: sample?.url ?? '',
        sampleName: sample?.name ?? '',
        isSampleParsed: sample?.parsed ?? false,
        sampleSnapshotAuthoritative: false,
        showSampleInInputTray: false,
        attachments: sample
          ? state.attachments.filter((item) =>
            attachmentDedupKey(item) !== sample.id && item.url !== sample.url)
          : state.attachments,
        pendingAttachmentIds: state.pendingAttachmentIds.filter((id) => {
          const attachment = state.attachments.find((item) => item.id === id)
          return sample && attachment
            ? attachmentDedupKey(attachment) !== sample.id && attachment.url !== sample.url
            : true
        }),
      }
    }),
  acceptServerMaterials: (materials, acknowledgeLocalChanges = false) =>
    set((state) => {
      const attachments = materials.map((material) => ({
        id: `att_${material.id}`,
        materialId: material.id,
        name: material.name ?? material.id,
        type: material.type,
        url: material.url,
        source: 'library',
        tags: material.tags,
      } satisfies InputAttachment))
      if (
        state.materialsSnapshotAuthoritative
        && (!acknowledgeLocalChanges
          || JSON.stringify(materialIdentity(state.attachments)) !== JSON.stringify(materialIdentity(attachments)))
      ) return state
      return { attachments, pendingAttachmentIds: [], materialsSnapshotAuthoritative: false }
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
        materialsSnapshotAuthoritative: true,
      }))
      return
    }
    set((s) => ({
      attachments: [...s.attachments, item],
      pendingAttachmentIds: [...new Set([...s.pendingAttachmentIds, item.id])],
      materialsSnapshotAuthoritative: true,
    }))
  },
  removeAttachment: (id) =>
    set((s) => ({
      attachments: s.attachments.filter((a) => a.id !== id),
      pendingAttachmentIds: s.pendingAttachmentIds.filter((item) => item !== id),
      materialsSnapshotAuthoritative: true,
    })),
  clearInputTray: () => set({ pendingAttachmentIds: [], showSampleInInputTray: false }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio, aspectRatioExplicit: true }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setStyleIntensity: (styleIntensity) => set({ styleIntensity, styleIntensityExplicit: true }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setSampleParsed: (isSampleParsed) => set({ isSampleParsed }),
  clearSample: () =>
    set({
      sampleUrl: '',
      sampleName: '',
      sampleSnapshotAuthoritative: true,
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
      materialsSnapshotAuthoritative: false,
      sampleSnapshotAuthoritative: false,
      showSampleInInputTray: false,
    }),
}))
