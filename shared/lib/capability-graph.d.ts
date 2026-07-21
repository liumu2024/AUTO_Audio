import type { CapabilityLayerKind, CapabilityPluginManifest } from '../types/capability-registry.v1.js';
export declare const CAPABILITY_GRAPH_SCHEMA_VERSION: "capability_graph.v1";
export interface CapabilityGraphNode {
    plugin_id: string;
    layer: CapabilityLayerKind;
    provides: string[];
    requires: string[];
    conflicts: string[];
    params_schema: Record<string, unknown>;
    quality_score: Record<string, number>;
    fallback_preset: string | null;
    label: string;
}
export interface CapabilityGraph {
    schema_version: typeof CAPABILITY_GRAPH_SCHEMA_VERSION;
    nodes: CapabilityGraphNode[];
}
export declare function buildCapabilityGraph(manifests?: CapabilityPluginManifest[]): CapabilityGraph;
export declare function findGraphNodesProviding(graph: CapabilityGraph, provides: string, intentId?: string): CapabilityGraphNode[];
export declare function graphNodeViolatesIntentGeometry(node: CapabilityGraphNode, geometry: Record<string, string | number | boolean | string[] | undefined> | undefined): string | null;
//# sourceMappingURL=capability-graph.d.ts.map