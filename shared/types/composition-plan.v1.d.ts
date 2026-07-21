import type { CapabilityLayerKind } from './capability-registry.v1.js';
import type { EffectIntentId } from './effect-intent.v1.js';
export declare const COMPOSITION_PLAN_SCHEMA_VERSION: "composition_plan.v1";
export declare const COMPOSITION_VALIDATION_SCHEMA_VERSION: "composition_validation.v1";
export type CompositionStatusKind = 'complete' | 'auto_repaired' | 'missing_capability' | 'invalid' | 'pending';
export interface PlannedCompositionLayer {
    layer: CapabilityLayerKind | string;
    provides: string;
    plugin_id: string | null;
    preset: string | null;
    optional: boolean;
    match_score: number | null;
    reason: string;
}
export interface SegmentCompositionPlan {
    segment_id: string;
    intent_id: EffectIntentId;
    recipe_id: string;
    planned_layers: PlannedCompositionLayer[];
}
export interface CompositionPlanDocument {
    schema_version: typeof COMPOSITION_PLAN_SCHEMA_VERSION;
    task_id: string;
    segments: SegmentCompositionPlan[];
}
export type CompositionValidationSeverity = 'error' | 'warning' | 'info';
export interface CompositionValidationFinding {
    id: string;
    segment_id: string;
    rule: string;
    severity: CompositionValidationSeverity;
    message: string;
    missing_provides?: string;
    suggested_repair?: string;
}
export type CompositionRepairActionKind = 'add_layer' | 'ask_user' | 'generate_plugin' | 'none';
export interface CompositionRepairAction {
    id: string;
    segment_id: string;
    kind: CompositionRepairActionKind;
    provides: string;
    layer: string;
    plugin_id: string | null;
    reason: string;
    auto_applied: boolean;
    missing_capability?: string;
}
export interface CompositionValidationDocument {
    schema_version: typeof COMPOSITION_VALIDATION_SCHEMA_VERSION;
    task_id: string;
    status: CompositionStatusKind;
    findings: CompositionValidationFinding[];
    repair_actions: CompositionRepairAction[];
}
export interface SceneCompositionStatus {
    segment_id: string;
    intent_id: EffectIntentId;
    intent_label: string;
    recipe_id: string;
    status: CompositionStatusKind;
    status_label: string;
    layers: Array<{
        label: string;
        plugin_id: string;
        preset: string;
        layer_kind: string;
        provides?: string;
    }>;
    missing?: string[];
    repairs?: string[];
    missing_capabilities?: string[];
    suggestions?: string[];
}
//# sourceMappingURL=composition-plan.v1.d.ts.map