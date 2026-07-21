import { isMarketingContentDomain, } from '../types/director-grounding.v1.js';
/**
 * TemplateSchemaV1 → MigrationProtocolV12（编辑器 / 时间线兼容层）
 *
 * 样例理解层产出导演脚本模板；主链路仍消费 v1.2 semantic_anchors。
 */
export function templateToMigrationProtocolV12(template, input) {
    const slotById = new Map(template.slots.map((s) => [s.id, s]));
    return {
        version: '1.2',
        metadata: {
            video_id: template.source_video_id ?? input.taskId,
            duration_sec: template.duration,
            content_domain: template.content_domain,
        },
        source_video: {
            url: input.videoUrl,
            duration: template.duration,
        },
        generated_video: {
            url: '',
            duration: template.duration,
        },
        semantic_anchors: template.structure.map((seg) => {
            const slot = slotById.get(seg.slot);
            const creativeRole = seg.creative_role ?? seg.name;
            const role = resolveLogicRole(creativeRole, template.content_domain);
            const material = findMaterialForSlot(slot, input.materials);
            const matchStatus = material ? 'matched' : slot?.required ? 'gap' : 'pending';
            return {
                anchor_id: seg.id,
                start_sec: seg.start,
                end_sec: seg.end,
                sequence: seg.sequence,
                logic_intent: {
                    marketing_role: role,
                    creative_role: creativeRole,
                    emotion_vibe: seg.emotion ?? 'warm',
                    evidence_refs: seg.evidence_refs,
                    confidence: seg.confidence,
                },
                match: {
                    status: matchStatus,
                    asset_name: material?.label ?? (slot ? `[槽位待填] ${slot.id}` : null),
                    asset_id: material?.id ?? slot?.default_material_id ?? slot?.id,
                },
                replication_instructions: {
                    visual_generation_prompt: buildVisualPrompt(seg, slot),
                    overlay_rewrite_instruction: seg.subtitle ?? seg.purpose,
                    visual_motion: seg.visual_motion,
                },
            };
        }),
        transitions: template.transitions.map((transition) => ({
            id: transition.id,
            from_anchor_id: transition.from_segment_id,
            to_anchor_id: transition.to_segment_id,
            at_sec: transition.at_sec,
            presentation: transition.presentation,
            duration_sec: transition.duration_sec,
            timing: transition.timing,
            direction: transition.direction,
            overlay: transition.overlay,
            reason: transition.reason,
        })),
        render_recipe: template.render_recipe,
    };
}
function findMaterialForSlot(slot, materials) {
    if (!slot || !materials?.length)
        return undefined;
    if (slot.default_material_id) {
        const exact = materials.find((m) => m.id === slot.default_material_id);
        if (exact)
            return exact;
    }
    const acceptedTypes = new Set((slot.accepted_material_types?.length
        ? slot.accepted_material_types
        : [slot.type]).map((type) => type.toUpperCase()));
    const slotTags = new Set(slot.tags.map((tag) => tag.toLowerCase()));
    return materials.find((m) => {
        if (!acceptedTypes.has(m.material_type))
            return false;
        const materialTags = (m.ai_tags ?? []).map((tag) => tag.toLowerCase());
        return materialTags.some((tag) => slotTags.has(tag));
    });
}
function resolveLogicRole(creativeRole, contentDomain) {
    if (!isMarketingContentDomain(contentDomain)) {
        return creativeRole;
    }
    return mapSegmentNameToRole(creativeRole);
}
function mapSegmentNameToRole(name) {
    const n = name.toLowerCase();
    if (n.includes('hook'))
        return 'hook';
    if (n.includes('cta'))
        return 'cta';
    if (n.includes('product') || n.includes('demo'))
        return 'product_demo';
    if (n.includes('benefit') || n.includes('pain'))
        return 'pain_amplify';
    if (n.includes('open') || n.includes('intro'))
        return 'cinematic_open';
    if (n.includes('groove') || n.includes('montage'))
        return 'groove_montage';
    if (n.includes('accent') || n.includes('beat'))
        return 'accent_beat_sequence';
    if (n.includes('peak') || n.includes('outro') || n.includes('closing'))
        return 'color_peak_outro';
    return n.replace(/[^a-z0-9_ -]+/g, '').trim().replace(/[\s-]+/g, '_') || 'creative_segment';
}
function buildVisualPrompt(seg, slot) {
    const parts = [seg.purpose];
    if (seg.camera)
        parts.push(`镜头：${seg.camera}`);
    if (seg.motion)
        parts.push(`运镜：${seg.motion}`);
    if (slot?.tags.length)
        parts.push(`素材标签：${slot.tags.join('、')}`);
    return parts.join('；');
}
//# sourceMappingURL=template-to-migration.adapter.js.map