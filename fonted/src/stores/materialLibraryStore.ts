import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { analyzeAssetHeuristically } from '@shared/lib/asset-analysis-heuristic'
import type { AssetAnalysisV1 } from '@shared/types/asset-analysis.v1'

export type MaterialType = 'video' | 'image' | 'audio'

export interface UserMaterial {
  id: string
  name: string
  type: MaterialType
  url: string
  tags: string[]
  analysis?: AssetAnalysisV1
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

function baselineTags(type: MaterialType, name: string): string[] {
  const lower = name.toLowerCase()
  const tags =
    type === 'video'
      ? ['video', 'user_material', 'source_material', 'visual_candidate', 'broll']
      : type === 'image'
        ? ['image', 'user_material', 'source_material', 'visual_candidate']
        : ['audio', 'user_material', 'audio_candidate']

  if (type === 'audio') {
    tags.push(
      lower.includes('sfx') || lower.includes('whoosh') || lower.includes('hit')
        ? 'sfx'
        : 'bgm',
    )
  }
  if (/landscape|sea|sunset|forest|sky|mountain|风景|海|日落|森林|天空|山/.test(lower)) {
    tags.push('landscape')
    if (type === 'video') tags.push('landscape_broll')
  }
  if (/cinematic|电影|氛围|dream|calm/.test(lower)) {
    tags.push('cinematic')
  }

  return uniqueTags(tags)
}

function materialTagsFor(
  type: MaterialType,
  name: string,
  tags: string[],
  analysisTags: string[] = [],
): string[] {
  const normalized = uniqueTags([
    ...baselineTags(type, name),
    ...tags,
    ...analysisTags,
  ])
  const scoped = normalized.includes('sample_reference')
    ? normalized.filter((tag) => tag !== 'source_material')
    : normalized
  return scoped.slice(0, 12)
}

interface MaterialLibraryState {
  materials: UserMaterial[]
  addMaterial: (input: Omit<UserMaterial, 'id' | 'createdAt'>) => UserMaterial
  addFromFile: (file: File) => UserMaterial
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
        const analysis = analyzeAssetHeuristically({
          id: `mat_pending_${Date.now()}`,
          type: input.type,
          name: input.name,
          url: input.url,
          tags: input.tags,
        })
        const item: UserMaterial = {
          ...input,
          id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          tags: materialTagsFor(input.type, input.name, input.tags, analysis.tags),
          createdAt: new Date().toISOString(),
        }
        item.analysis = {
          ...analysis,
          asset_id: item.id,
          segments: analysis.segments.map((segment) => ({
            ...segment,
            id: segment.id.replace(analysis.asset_id, item.id),
            asset_id: item.id,
          })),
        }
        set((s) => ({ materials: [item, ...s.materials] }))
        return item
      },

      addFromFile: (file) => {
        const url = URL.createObjectURL(file)
        return get().addMaterial({
          name: file.name,
          type: inferType(file),
          url,
          tags: [],
        })
      },

      updateMaterial: (id, patch) =>
        set((s) => ({
          materials: s.materials.map((m) => {
            if (m.id !== id) return m
            const patched = { ...m, ...patch }
            const next = {
              ...patched,
              tags: materialTagsFor(patched.type, patched.name, patched.tags),
            }
            return {
              ...next,
              analysis: analyzeAssetHeuristically({
                id: next.id,
                type: next.type,
                name: next.name,
                url: next.url,
                tags: next.tags,
              }),
            }
          }),
        })),

      deleteMaterial: (id) =>
        set((s) => ({
          materials: s.materials.filter((m) => m.id !== id),
        })),

      getMaterial: (id) => get().materials.find((m) => m.id === id),
    }),
    { name: 'dpl304-material-library' },
  ),
)
