import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { uploadFile } from '@/lib/api'

export type MaterialType = 'video' | 'image' | 'audio'

export interface UserMaterial {
  id: string
  name: string
  type: MaterialType
  url: string
  tags: string[]
  /** False only for legacy tags whose user/heuristic provenance cannot be separated. */
  tagsAreUserManaged?: boolean
  fingerprint?: string
  createdAt: string
}

const SEED_MATERIALS: UserMaterial[] = []

function inferType(file: File): MaterialType {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'image'
}

function uniqueTags(tags: Array<string | undefined>): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag?.trim().toLowerCase())
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ]
}

function materialTagsFor(
  tags: string[],
): string[] {
  return uniqueTags(tags).slice(0, 12)
}

export function directorTagsForMaterial(
  material: Pick<UserMaterial, 'tags' | 'tagsAreUserManaged'>,
): string[] {
  return material.tagsAreUserManaged === false ? [] : material.tags
}

function migrateMaterialLibraryState(persistedState: unknown): unknown {
  if (!persistedState || typeof persistedState !== 'object') return persistedState
  const state = persistedState as { materials?: unknown[] }
  if (!Array.isArray(state.materials)) return persistedState
  return {
    ...state,
    materials: state.materials.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const record = entry as Record<string, unknown>
      const { analysis: _legacyAnalysis, ...material } = record
      return {
        ...material,
        tagsAreUserManaged: !Object.prototype.hasOwnProperty.call(record, 'analysis'),
      }
    }),
  }
}

function fileFingerprint(file: File): string {
  return [file.name, file.type, file.size, file.lastModified].join('|')
}

function refreshFileBackedMaterial(
  material: UserMaterial,
  file: File,
  fingerprint: string,
  url: string,
): UserMaterial {
  return {
    ...material,
    name: file.name || material.name,
    type: inferType(file),
    url,
    fingerprint,
  }
}

function isPersistedMaterialUrl(url: string): boolean {
  return !url.startsWith('blob:') && !url.startsWith('data:')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function contentFingerprint(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) return `file:${fileFingerprint(file)}`
  const hash = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return `sha256:${bytesToHex(new Uint8Array(hash))}|${file.type}|${file.size}`
}

interface MaterialLibraryState {
  materials: UserMaterial[]
  addMaterial: (input: Omit<UserMaterial, 'id' | 'createdAt'>) => UserMaterial
  addFromFileWithHash: (file: File) => Promise<UserMaterial>
  updateMaterial: (
    id: string,
    patch: Partial<Pick<UserMaterial, 'name' | 'tags' | 'url'>>,
  ) => void
  deleteMaterial: (id: string) => void
  getMaterial: (id: string) => UserMaterial | undefined
}

export const useMaterialLibraryStore = create<MaterialLibraryState>()(
  persist(
    (set, get) => ({
      materials: SEED_MATERIALS,

      addMaterial: (input) => {
        if (input.fingerprint) {
          const existing = get().materials.find((item) => item.fingerprint === input.fingerprint)
          if (existing) return existing
        }
        const item: UserMaterial = {
          ...input,
          id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          tags: materialTagsFor(input.tags),
          tagsAreUserManaged: true,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ materials: [item, ...s.materials] }))
        return item
      },

      addFromFileWithHash: async (file) => {
        const legacyFingerprint = fileFingerprint(file)
        const legacyExisting = get().materials.find((item) => item.fingerprint === legacyFingerprint)
        if (legacyExisting && isPersistedMaterialUrl(legacyExisting.url)) return legacyExisting
        const fingerprint = await contentFingerprint(file)
        const existing = get().materials.find((item) => item.fingerprint === fingerprint)
        if (existing && isPersistedMaterialUrl(existing.url)) return existing

        const uploaded = await uploadFile(file)
        const url = uploaded.publication?.externallyReachable
          ? uploaded.publicUrl ?? uploaded.url
          : uploaded.localUrl ?? uploaded.url
        const matched = existing ?? legacyExisting
        if (matched) {
          const refreshed = refreshFileBackedMaterial(matched, file, fingerprint, url)
          set((s) => ({
            materials: s.materials.map((item) => (item.id === matched.id ? refreshed : item)),
          }))
          return refreshed
        }
        return get().addMaterial({
          name: file.name,
          type: inferType(file),
          url,
          tags: [],
          fingerprint,
        })
      },

      updateMaterial: (id, patch) =>
        set((s) => ({
          materials: s.materials.map((m) => {
            if (m.id !== id) return m
            const patched = { ...m, ...patch }
            return {
              ...patched,
              tags: materialTagsFor(patched.tags),
              tagsAreUserManaged: patch.tags ? true : patched.tagsAreUserManaged,
            }
          }),
        })),

      deleteMaterial: (id) =>
        set((s) => ({
          materials: s.materials.filter((m) => m.id !== id),
        })),

      getMaterial: (id) => get().materials.find((m) => m.id === id),
    }),
    { name: 'dpl304-material-library', version: 2, migrate: migrateMaterialLibraryState },
  ),
)
