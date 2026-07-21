import { RENDER_PLUGIN_MANIFESTS } from '../../../../shared/lib/render-plugin-manifest.js'
import type { CapabilityPluginManifest } from '../../../../shared/types/capability-registry.v1.js'

export interface RoadmapPluginRegistrySnapshotEntry {
  plugin_id: string
  layerKind: CapabilityPluginManifest['layerKind']
  targetLayer: CapabilityPluginManifest['targetLayer']
  capabilities: string[]
  requiredParams: string[]
  compatibleLayers: CapabilityPluginManifest['layerKind'][]
  boundary?: {
    supports?: CapabilityPluginManifest['boundary'] extends infer B
      ? B extends { supports?: infer S }
        ? S
        : never
      : never
    cannotSupport?: string[]
    forbiddenLayers?: CapabilityPluginManifest['layerKind'][]
  }
}

export interface RoadmapPluginRegistrySnapshot {
  schema_version: 'roadmap_plugin_registry_snapshot.v1'
  note: string
  plugins: RoadmapPluginRegistrySnapshotEntry[]
}

export function buildRoadmapPluginRegistrySnapshot(
  manifests = RENDER_PLUGIN_MANIFESTS,
): RoadmapPluginRegistrySnapshot {
  return {
    schema_version: 'roadmap_plugin_registry_snapshot.v1',
    note:
      'Capability registry for roadmap planning only. Do NOT copy preset or plugin_id into EffectRoadmap output.',
    plugins: manifests.map((plugin) => ({
      plugin_id: plugin.id,
      layerKind: plugin.layerKind,
      targetLayer: plugin.targetLayer,
      capabilities: plugin.capabilities,
      requiredParams: plugin.requiredParams,
      compatibleLayers: plugin.compatibleLayers,
      boundary: plugin.boundary
        ? {
            supports: plugin.boundary.supports,
            cannotSupport: plugin.boundary.cannotSupport,
            forbiddenLayers: plugin.boundary.forbiddenLayers,
          }
        : undefined,
    })),
  }
}
