import { creativeRoleLabel } from './director-labels.js';
const DEFAULT_TRACKS = [
    { id: 'video', label: '画面轨', sublabel: '镜头 / 素材 / 画面段落' },
    { id: 'audio', label: '音乐轨', sublabel: '配乐 / 节拍 / 音频参考' },
];
/** 从 v1.2 structure 推导时间线工程。字幕保留在 RenderPlan overlays，不再生成独立轨道。 */
export function buildTimelineFromStructure(structure) {
    const duration = structure.metadata.duration_sec;
    const clips = [];
    for (const anchor of structure.semantic_anchors) {
        const isGap = anchor.match.status === 'gap';
        const displayRole = anchor.logic_intent.creative_role ?? anchor.logic_intent.marketing_role;
        const roleLabel = creativeRoleLabel(displayRole);
        const roleDisplay = roleLabel !== '未判断' ? roleLabel : anchor.anchor_id;
        const videoLabel = anchor.match.asset_name ?? (isGap ? `[缺口] ${roleDisplay}` : roleDisplay);
        clips.push({
            id: `clip-v-${anchor.anchor_id}`,
            track_id: 'video',
            start_sec: anchor.start_sec,
            end_sec: anchor.end_sec,
            label: videoLabel,
            anchor_id: anchor.anchor_id,
            material_id: anchor.match.asset_id,
            content_rewrite_instruction: anchor.replication_instructions.overlay_rewrite_instruction,
            visual_generation_prompt: anchor.replication_instructions.visual_generation_prompt,
        });
    }
    clips.push({
        id: 'clip-a-bgm',
        track_id: 'audio',
        start_sec: 0,
        end_sec: duration,
        label: '参考音乐 / 配乐',
    });
    return {
        duration_sec: duration,
        tracks: DEFAULT_TRACKS,
        clips,
        transitions: structure.transitions ?? [],
    };
}
/** 从 v1.2 structure 推导左侧大纲。 */
export function buildOutlineFromStructure(structure) {
    return structure.semantic_anchors.map((anchor, index) => {
        const creativeRole = anchor.logic_intent.creative_role ?? anchor.logic_intent.marketing_role;
        const role = creativeRoleLabel(creativeRole);
        return {
            id: `outline-${index + 1}`,
            anchor_id: anchor.anchor_id,
            title: role !== '未判断' ? role : anchor.anchor_id,
            marketing_role: anchor.logic_intent.marketing_role,
            creative_role: creativeRole,
            start_sec: anchor.start_sec,
            end_sec: anchor.end_sec,
        };
    });
}
export function formatOutlineDuration(start, end) {
    const fmt = (s) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${String(sec).padStart(2, '0')}`;
    };
    return `${fmt(start)} - ${fmt(end)}`;
}
//# sourceMappingURL=pipeline-builder.js.map