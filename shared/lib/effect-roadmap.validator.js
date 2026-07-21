import { CAPABILITY_LAYER_KINDS } from '../types/capability-registry.v1.js';
import { EFFECT_ROADMAP_SCHEMA_VERSION, } from '../types/effect-roadmap.v1.js';
const FORBIDDEN_ATOM_FIELDS = [
    'preset',
    'plugin_id',
    'effect_id',
    'fallbackPreset',
    'params',
];
const LAYER_KIND_SET = new Set(CAPABILITY_LAYER_KINDS);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pushError(errors, input) {
    errors.push({
        message: input.message ?? input.code,
        code: input.code,
        path: input.path,
    });
}
function validateAtom(atom, index, errors) {
    const basePath = `segments[].atoms[${index}]`;
    if (!isRecord(atom)) {
        pushError(errors, {
            path: basePath,
            code: 'invalid_field',
            message: 'atom must be an object',
        });
        return;
    }
    if (typeof atom.id !== 'string' || !atom.id.trim()) {
        pushError(errors, {
            path: `${basePath}.id`,
            code: 'missing_atom_id',
            message: 'atom.id is required',
        });
    }
    if (typeof atom.layerKind !== 'string' || !atom.layerKind.trim()) {
        pushError(errors, {
            path: `${basePath}.layerKind`,
            code: 'missing_layer_kind',
            message: 'atom.layerKind is required',
        });
    }
    else if (!LAYER_KIND_SET.has(atom.layerKind)) {
        pushError(errors, {
            path: `${basePath}.layerKind`,
            code: 'invalid_layer_kind',
            message: `atom.layerKind must be one of: ${CAPABILITY_LAYER_KINDS.join(', ')}`,
        });
    }
    if (typeof atom.capability_query !== 'string' || !atom.capability_query.trim()) {
        pushError(errors, {
            path: `${basePath}.capability_query`,
            code: 'missing_field',
            message: 'atom.capability_query is required',
        });
    }
    for (const field of FORBIDDEN_ATOM_FIELDS) {
        if (field in atom) {
            pushError(errors, {
                path: `${basePath}.${field}`,
                code: 'forbidden_field',
                message: `atom must not include ${field}; plugin mapping belongs in AtomPlan / mapping decisions`,
            });
        }
    }
}
function validateBindings(bindings, segmentPath, atomIds, errors) {
    bindings.forEach((binding, index) => {
        const basePath = `${segmentPath}.bindings[${index}]`;
        if (!isRecord(binding)) {
            pushError(errors, {
                path: basePath,
                code: 'invalid_field',
                message: 'binding must be an object',
            });
            return;
        }
        if (typeof binding.source !== 'string' || !binding.source.trim()) {
            pushError(errors, {
                path: `${basePath}.source`,
                code: 'missing_field',
                message: 'binding.source is required',
            });
        }
        if (typeof binding.target !== 'string' || !binding.target.trim()) {
            pushError(errors, {
                path: `${basePath}.target`,
                code: 'missing_field',
                message: 'binding.target is required',
            });
        }
        if (typeof binding.source_atom_id !== 'string' || !atomIds.has(binding.source_atom_id)) {
            pushError(errors, {
                path: `${basePath}.source_atom_id`,
                code: 'unknown_binding_atom',
                message: `binding source_atom_id "${String(binding.source_atom_id)}" does not exist in segment atoms`,
            });
        }
        if (typeof binding.target_atom_id !== 'string' || !atomIds.has(binding.target_atom_id)) {
            pushError(errors, {
                path: `${basePath}.target_atom_id`,
                code: 'unknown_binding_atom',
                message: `binding target_atom_id "${String(binding.target_atom_id)}" does not exist in segment atoms`,
            });
        }
    });
}
function validateSegment(segment, segmentIndex, errors) {
    const segmentPath = `segments[${segmentIndex}]`;
    if (!isRecord(segment)) {
        pushError(errors, {
            path: segmentPath,
            code: 'invalid_field',
            message: 'segment must be an object',
        });
        return;
    }
    if (typeof segment.segment_id !== 'string' || !segment.segment_id.trim()) {
        pushError(errors, {
            path: `${segmentPath}.segment_id`,
            code: 'missing_field',
            message: 'segment.segment_id is required',
        });
    }
    if (!isRecord(segment.motif)) {
        pushError(errors, {
            path: `${segmentPath}.motif`,
            code: 'missing_field',
            message: 'segment.motif is required',
        });
        return;
    }
    if (typeof segment.motif.id !== 'string' || !segment.motif.id.trim()) {
        pushError(errors, {
            path: `${segmentPath}.motif.id`,
            code: 'missing_field',
            message: 'motif.id is required',
        });
    }
    if (typeof segment.motif.family !== 'string' || !segment.motif.family.trim()) {
        pushError(errors, {
            path: `${segmentPath}.motif.family`,
            code: 'missing_field',
            message: 'motif.family is required',
        });
    }
    if (!Array.isArray(segment.motif.evidence_refs)) {
        pushError(errors, {
            path: `${segmentPath}.motif.evidence_refs`,
            code: 'missing_field',
            message: 'motif.evidence_refs must be an array',
        });
    }
    else if (segment.motif.evidence_refs.length === 0) {
        pushError(errors, {
            path: `${segmentPath}.motif.evidence_refs`,
            code: 'missing_field',
            message: 'motif.evidence_refs must not be empty',
        });
    }
    if (typeof segment.motif.confidence !== 'number' || !Number.isFinite(segment.motif.confidence)) {
        pushError(errors, {
            path: `${segmentPath}.motif.confidence`,
            code: 'missing_field',
            message: 'motif.confidence must be a number between 0 and 1',
        });
    }
    else if (segment.motif.confidence < 0 || segment.motif.confidence > 1) {
        pushError(errors, {
            path: `${segmentPath}.motif.confidence`,
            code: 'invalid_field',
            message: 'motif.confidence must be between 0 and 1',
        });
    }
    if (!isRecord(segment.motif.must_match)) {
        pushError(errors, {
            path: `${segmentPath}.motif.must_match`,
            code: 'missing_field',
            message: 'motif.must_match must be an object',
        });
    }
    if (!Array.isArray(segment.motif.can_adapt)) {
        pushError(errors, {
            path: `${segmentPath}.motif.can_adapt`,
            code: 'missing_field',
            message: 'motif.can_adapt must be an array',
        });
    }
    if (Array.isArray(segment.motif.loss_risk)) {
        segment.motif.loss_risk.forEach((risk, index) => {
            const riskPath = `${segmentPath}.motif.loss_risk[${index}]`;
            if (!isRecord(risk)) {
                pushError(errors, {
                    path: riskPath,
                    code: 'invalid_field',
                    message: 'loss_risk item must be an object',
                });
                return;
            }
            if (typeof risk.reason !== 'string' || !risk.reason.trim()) {
                pushError(errors, {
                    path: `${riskPath}.reason`,
                    code: 'missing_field',
                    message: 'loss_risk.reason is required',
                });
            }
            if (!Array.isArray(risk.evidence_refs)) {
                pushError(errors, {
                    path: `${riskPath}.evidence_refs`,
                    code: 'missing_field',
                    message: 'loss_risk.evidence_refs must be an array',
                });
            }
        });
    }
    const atoms = Array.isArray(segment.atoms) ? segment.atoms : [];
    if (!Array.isArray(segment.atoms)) {
        pushError(errors, {
            path: `${segmentPath}.atoms`,
            code: 'missing_field',
            message: 'segment.atoms must be an array',
        });
    }
    atoms.forEach((atom, index) => validateAtom(atom, index, errors));
    const atomIds = new Set();
    for (const atom of atoms) {
        if (!isRecord(atom) || typeof atom.id !== 'string')
            continue;
        if (atomIds.has(atom.id)) {
            pushError(errors, {
                path: `${segmentPath}.atoms`,
                code: 'duplicate_atom_id',
                message: `duplicate atom id "${atom.id}"`,
            });
        }
        atomIds.add(atom.id);
    }
    const motifAtomIds = Array.isArray(segment.motif.atom_ids) ? segment.motif.atom_ids : [];
    if (!Array.isArray(segment.motif.atom_ids)) {
        pushError(errors, {
            path: `${segmentPath}.motif.atom_ids`,
            code: 'missing_field',
            message: 'motif.atom_ids must be an array',
        });
    }
    for (const motifAtomId of motifAtomIds) {
        if (typeof motifAtomId !== 'string' || !atomIds.has(motifAtomId)) {
            pushError(errors, {
                path: `${segmentPath}.motif.atom_ids`,
                code: 'motif_atom_mismatch',
                message: `motif.atom_ids references missing atom "${String(motifAtomId)}"`,
            });
        }
    }
    const bindings = Array.isArray(segment.bindings) ? segment.bindings : [];
    if (!Array.isArray(segment.bindings)) {
        pushError(errors, {
            path: `${segmentPath}.bindings`,
            code: 'missing_field',
            message: 'segment.bindings must be an array',
        });
        return;
    }
    validateBindings(bindings, segmentPath, atomIds, errors);
}
export function validateEffectRoadmap(candidate) {
    const errors = [];
    if (!isRecord(candidate)) {
        return {
            ok: false,
            errors: [
                {
                    path: '$',
                    code: 'invalid_field',
                    message: 'roadmap must be an object',
                },
            ],
        };
    }
    if (candidate.schema_version !== EFFECT_ROADMAP_SCHEMA_VERSION) {
        pushError(errors, {
            path: 'schema_version',
            code: 'invalid_schema_version',
            message: `schema_version must be "${EFFECT_ROADMAP_SCHEMA_VERSION}"`,
        });
    }
    if (typeof candidate.task_id !== 'string' || !candidate.task_id.trim()) {
        pushError(errors, {
            path: 'task_id',
            code: 'missing_field',
            message: 'task_id is required',
        });
    }
    if (!Array.isArray(candidate.segments)) {
        pushError(errors, {
            path: 'segments',
            code: 'missing_field',
            message: 'segments must be an array',
        });
        return { ok: false, errors };
    }
    candidate.segments.forEach((segment, index) => validateSegment(segment, index, errors));
    return {
        ok: errors.length === 0,
        errors,
    };
}
export function assertValidEffectRoadmap(candidate) {
    const result = validateEffectRoadmap(candidate);
    if (!result.ok) {
        const summary = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
        throw new Error(`Invalid EffectRoadmap: ${summary}`);
    }
    return candidate;
}
//# sourceMappingURL=effect-roadmap.validator.js.map