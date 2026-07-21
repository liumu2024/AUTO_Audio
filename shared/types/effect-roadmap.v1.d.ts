import type { CapabilityLayerKind } from './capability-registry.v1.js';
export declare const EFFECT_ROADMAP_SCHEMA_VERSION: "effect_roadmap.v1";
export declare const EFFECT_MOTIF_FAMILIES: readonly ["color_portal_unlock", "kinetic_orb_reveal", "layout_collage", "cinematic_texture_grade", "beat_sync_montage"];
export type EffectMotifFamily = (typeof EFFECT_MOTIF_FAMILIES)[number] | string;
export declare const EFFECT_LOSS_LEDGER_SEVERITIES: readonly ["high", "medium", "low", "info"];
export type EffectLossLedgerSeverity = (typeof EFFECT_LOSS_LEDGER_SEVERITIES)[number];
/** Cross-stage fidelity record shared with effect debug artifacts. */
export interface LossLedgerEntry {
    id: string;
    source_stage: string;
    reason: string;
    evidence_refs: string[];
    fallback_used: string | null;
    severity: EffectLossLedgerSeverity;
}
export type EffectMotifMustMatchValue = string | number | boolean | string[] | number[];
/** Hard grammar constraints the motif must satisfy, e.g. geometry.panel_count. */
export type EffectMotifMustMatch = Record<string, EffectMotifMustMatchValue>;
/** Dimensions the motif may adapt without breaking family identity. */
export type EffectMotifCanAdapt = string[];
export interface MotifSharedTimelinePhase {
    id: string;
    start_sec: number;
    end_sec: number;
    active_atom_ids: string[];
    sync?: string;
}
export interface MotifSharedTimelineSyncPoint {
    id: string;
    at_sec: number;
    sync: string;
    atom_ids?: string[];
}
/** Segment-local timing coordination for atoms inside a motif. */
export interface MotifSharedTimeline {
    phases?: MotifSharedTimelinePhase[];
    sync_points?: MotifSharedTimelineSyncPoint[];
}
export interface MotifSharedGeometryPoint {
    x_pct: number;
    y_pct: number;
}
/** Shared spatial references consumed by bindings within a motif. */
export interface MotifSharedGeometry {
    effect_group_id?: string;
    origin?: MotifSharedGeometryPoint;
    center_path_ref?: string;
    [key: string]: unknown;
}
export interface EffectMotifLossRisk {
    id?: string;
    reason: string;
    evidence_refs: string[];
    requested_grammar?: string;
    severity?: EffectLossLedgerSeverity;
}
export interface EffectMotif {
    id: string;
    family: EffectMotifFamily;
    evidence_refs: string[];
    confidence: number;
    must_match: EffectMotifMustMatch;
    can_adapt: EffectMotifCanAdapt;
    loss_risk?: EffectMotifLossRisk[];
    shared_timeline?: MotifSharedTimeline;
    shared_geometry?: MotifSharedGeometry;
    atom_ids: string[];
    segment_ids?: string[];
    description?: string;
}
export interface EffectAtomBoundary {
    supports?: Record<string, unknown>;
    cannot_support?: string[];
    forbidden_layers?: CapabilityLayerKind[];
}
/** Atomic executable layer inside a motif (plugin mapping happens in AtomPlan, not here). */
export interface EffectAtom {
    id: string;
    layerKind: CapabilityLayerKind;
    capability_query: string;
    required_params?: string[];
    boundary?: EffectAtomBoundary;
    evidence_refs?: string[];
}
/** Cross-atom parameter wiring, e.g. mask.center_path -> ring.center_path. */
export interface ParamBinding {
    id?: string;
    source: string;
    target: string;
    source_atom_id: string;
    target_atom_id: string;
    transform?: string;
}
export interface EffectRoadmapSegment {
    segment_id: string;
    start_sec?: number;
    end_sec?: number;
    motif: EffectMotif;
    atoms: EffectAtom[];
    bindings: ParamBinding[];
}
export interface EffectRoadmap {
    schema_version: typeof EFFECT_ROADMAP_SCHEMA_VERSION;
    task_id: string;
    segments: EffectRoadmapSegment[];
    loss_ledger?: LossLedgerEntry[];
}
//# sourceMappingURL=effect-roadmap.v1.d.ts.map