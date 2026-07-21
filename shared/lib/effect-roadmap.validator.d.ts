import { type EffectRoadmap } from '../types/effect-roadmap.v1.js';
export interface EffectRoadmapValidationError {
    path: string;
    code: 'invalid_schema_version' | 'missing_field' | 'invalid_field' | 'duplicate_atom_id' | 'missing_atom_id' | 'missing_layer_kind' | 'invalid_layer_kind' | 'unknown_binding_atom' | 'motif_atom_mismatch' | 'forbidden_field';
    message: string;
}
export interface EffectRoadmapValidationResult {
    ok: boolean;
    errors: EffectRoadmapValidationError[];
}
export declare function validateEffectRoadmap(candidate: unknown): EffectRoadmapValidationResult;
export declare function assertValidEffectRoadmap(candidate: unknown): EffectRoadmap;
//# sourceMappingURL=effect-roadmap.validator.d.ts.map