import type { CapabilityLayerKind, CapabilityPluginManifest } from '../types/capability-registry.v1.js'
import { RENDER_PLUGIN_MANIFESTS } from './render-plugin-manifest.js'

export const CAPABILITY_GRAPH_SCHEMA_VERSION = 'capability_graph.v1' as const

export interface CapabilityGraphNode {
  plugin_id: string
  layer: CapabilityLayerKind
  provides: string[]
  requires: string[]
  conflicts: string[]
  params_schema: Record<string, unknown>
  quality_score: Record<string, number>
  fallback_preset: string | null
  label: string
}

export interface CapabilityGraph {
  schema_version: typeof CAPABILITY_GRAPH_SCHEMA_VERSION
  nodes: CapabilityGraphNode[]
}

const INTENT_QUALITY_HINTS: Record<string, Record<string, number>> = {
  grayscale_color_unlock: {
    beat_color_unlock_reveal: 0.96,
    grayscale_to_color_transform: 0.92,
    circle_mask_reveal: 0.9,
    color_hint_square_overlay: 0.84,
    portal_ring_overlay: 0.86,
    beat_cut_driver: 0.78,
    scenic_film_grade: 0.78,
    cinematic_texture_grade: 0.72,
  },
  orb_driven_color_wave: {
    grayscale_to_color_transform: 0.9,
    directional_wave_reveal: 0.91,
    orb_motion_driver: 0.93,
    orb_ring_follow_overlay: 0.84,
    beat_cut_driver: 0.76,
  },
  layout_collage: {
    split_collage_layout: 0.88,
    radial_triangle_prism_collage: 0.94,
  },
  next_asset_reveal: {
    crystal_lens_reveal_transition: 0.92,
    circle_mask_reveal: 0.74,
  },
}

function expandProvides(manifest: CapabilityPluginManifest): string[] {
  const provides = new Set<string>(manifest.capabilities)
  provides.add(manifest.layerKind)
  provides.add(manifest.family ?? manifest.id)

  for (const [key, value] of Object.entries(manifest.boundary?.supports ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) provides.add(`${key}=${String(item)}`)
    } else {
      provides.add(`${key}=${String(value)}`)
    }
  }

  if (manifest.id.includes('mask')) {
    provides.add('localized_color_reveal')
    provides.add('color_reveal')
  }
  if (manifest.id.includes('color_transform') || manifest.id.includes('grayscale')) {
    provides.add('grayscale_base')
    provides.add('color_transform_base')
  }
  if (manifest.id.includes('orb_motion')) {
    provides.add('orb_motion')
    provides.add('motion_subject_orb')
  }
  if (manifest.id.includes('wave')) {
    provides.add('directional_wave_reveal')
    provides.add('directional_wave')
  }
  if (manifest.id.includes('ring')) {
    provides.add('ring_overlay')
    provides.add('ring_motion')
  }
  if (manifest.id.includes('beat')) {
    provides.add('beat_sync')
    provides.add('audio_driver')
  }
  if (manifest.id.includes('color_unlock')) {
    provides.add('color_reveal')
    provides.add('localized_color_reveal')
    provides.add('grayscale_base')
    provides.add('grayscale_to_color_transform')
  }
  if (manifest.id.includes('color_hint')) {
    provides.add('color_hint_overlay')
    provides.add('swatch_label_overlay')
  }
  if (manifest.id.includes('fade_overlay')) {
    provides.add('fade_to_black')
    provides.add('segment_fade')
  }
  if (manifest.id.includes('transition_accent')) {
    provides.add('transition_accent')
    provides.add('light_leak_transition')
    provides.add('flash_transition')
  }
  if (manifest.id.includes('font')) {
    provides.add('text_style')
    provides.add('typography')
  }
  if (manifest.id.includes('collage')) {
    provides.add('collage_layout')
    provides.add('layout_collage')
  }

  return [...provides]
}

function expandRequires(manifest: CapabilityPluginManifest): string[] {
  const requires = new Set<string>(manifest.requiredParams)
  for (const item of manifest.boundary?.requiresCompositionFor ?? []) {
    requires.add(item)
  }
  if (manifest.layerKind === 'mask_reveal') requires.add('color_transform_base')
  if (manifest.id.includes('ring')) {
    requires.add('mask_reveal')
    requires.add('color_unlock')
  }
  if (manifest.id.includes('orb_ring')) requires.add('orb_motion')
  return [...requires]
}

function expandConflicts(manifest: CapabilityPluginManifest): string[] {
  const conflicts = new Set<string>([
    ...(manifest.boundary?.cannotSupport ?? []),
    ...(manifest.boundary?.forbiddenLayers ?? []).map((layer) => `forbidden_layer:${layer}`),
    ...(manifest.negativeKeywords ?? []).map((keyword) => `negative:${keyword}`),
  ])
  return [...conflicts]
}

function qualityScoresForPlugin(pluginId: string): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const [intentId, hints] of Object.entries(INTENT_QUALITY_HINTS)) {
    if (pluginId in hints) scores[intentId] = hints[pluginId]!
  }
  return scores
}

export function buildCapabilityGraph(
  manifests: CapabilityPluginManifest[] = RENDER_PLUGIN_MANIFESTS,
): CapabilityGraph {
  return {
    schema_version: CAPABILITY_GRAPH_SCHEMA_VERSION,
    nodes: manifests.map((manifest) => ({
      plugin_id: manifest.id,
      layer: manifest.layerKind,
      provides: expandProvides(manifest),
      requires: expandRequires(manifest),
      conflicts: expandConflicts(manifest),
      params_schema: manifest.defaultParams ?? {},
      quality_score: qualityScoresForPlugin(manifest.id),
      fallback_preset: manifest.fallbackPreset ?? null,
      label: manifest.label,
    })),
  }
}

export function findGraphNodesProviding(
  graph: CapabilityGraph,
  provides: string,
  intentId?: string,
): CapabilityGraphNode[] {
  const normalized = provides.toLowerCase()
  return graph.nodes
    .filter((node) =>
      node.provides.some(
        (item) =>
          item.toLowerCase() === normalized ||
          item.toLowerCase().includes(normalized) ||
          normalized.includes(item.toLowerCase()),
      ),
    )
    .sort((left, right) => {
      const leftScore = intentId ? (left.quality_score[intentId] ?? 0) : 0
      const rightScore = intentId ? (right.quality_score[intentId] ?? 0) : 0
      return rightScore - leftScore || left.plugin_id.localeCompare(right.plugin_id)
    })
}

export function graphNodeViolatesIntentGeometry(
  node: CapabilityGraphNode,
  geometry: Record<string, string | number | boolean | string[] | undefined> | undefined,
): string | null {
  if (!geometry) return null
  const cellShape = geometry['geometry.cell_shape'] ?? geometry.cell_shape
  if (cellShape === 'triangle') {
    if (node.conflicts.some((c) => c.includes('triangle') || c.includes('negative:triangle'))) {
      return `${node.plugin_id} conflicts with triangle geometry`
    }
    if (node.plugin_id === 'split_collage_layout') {
      return `${node.plugin_id} only supports rectangle collage`
    }
  }
  return null
}
