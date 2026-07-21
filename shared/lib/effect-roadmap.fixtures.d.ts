import type { EffectRoadmap } from '../types/effect-roadmap.v1.js';
export declare const validKineticOrbRevealRoadmapFixture: EffectRoadmap;
export declare const validColorPortalUnlockRoadmapFixture: EffectRoadmap;
export declare const validLayoutCollageRoadmapFixture: EffectRoadmap;
export declare const invalidMissingAtomIdFixture: {
    schema_version: string;
    task_id: string;
    segments: {
        segment_id: string;
        motif: {
            id: string;
            family: string;
            evidence_refs: string[];
            confidence: number;
            must_match: {};
            can_adapt: never[];
            atom_ids: string[];
        };
        atoms: {
            layerKind: string;
            capability_query: string;
        }[];
        bindings: never[];
    }[];
};
export declare const invalidMissingLayerKindFixture: {
    schema_version: string;
    task_id: string;
    segments: {
        segment_id: string;
        motif: {
            id: string;
            family: string;
            evidence_refs: string[];
            confidence: number;
            must_match: {};
            can_adapt: never[];
            atom_ids: string[];
        };
        atoms: {
            id: string;
            capability_query: string;
        }[];
        bindings: never[];
    }[];
};
export declare const invalidForbiddenPluginFieldFixture: {
    schema_version: string;
    task_id: string;
    segments: {
        segment_id: string;
        motif: {
            id: string;
            family: string;
            evidence_refs: string[];
            confidence: number;
            must_match: {};
            can_adapt: never[];
            atom_ids: string[];
        };
        atoms: {
            id: string;
            layerKind: string;
            capability_query: string;
            preset: string;
        }[];
        bindings: never[];
    }[];
};
export declare const invalidBindingTargetFixture: {
    schema_version: string;
    task_id: string;
    segments: {
        segment_id: string;
        motif: {
            id: string;
            family: string;
            evidence_refs: string[];
            confidence: number;
            must_match: {
                'geometry.mask_shape': string;
            };
            can_adapt: string[];
            atom_ids: string[];
        };
        atoms: {
            id: string;
            layerKind: string;
            capability_query: string;
        }[];
        bindings: {
            source: string;
            target: string;
            source_atom_id: string;
            target_atom_id: string;
        }[];
    }[];
};
//# sourceMappingURL=effect-roadmap.fixtures.d.ts.map