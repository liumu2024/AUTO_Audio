import type { CapabilityLayerKind, CapabilityPluginManifest } from '../../types/capability-registry.v1.js';
export type RenderPluginLayerBucket = {
    layerKind: CapabilityLayerKind;
    directory: string;
    plugins: CapabilityPluginManifest[];
};
export declare const RENDER_PLUGIN_LAYER_BUCKETS: RenderPluginLayerBucket[];
export declare const LAYERED_RENDER_PLUGIN_MANIFESTS: CapabilityPluginManifest[];
//# sourceMappingURL=index.d.ts.map