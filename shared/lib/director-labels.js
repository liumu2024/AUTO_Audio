/** 导演分段 creative_role / marketing_role → 中文展示名 */
export const CREATIVE_ROLE_LABELS = {
    opening: '开篇',
    build: '铺陈',
    climax: '高潮',
    afterglow: '余韵',
    hook: '开场吸引',
    pain_amplify: '痛点放大',
    demo: '产品展示',
    product_demo: '产品演示',
    cta: '行动召唤',
    social_proof: '信任证明',
    brand_story: '品牌故事',
    entertainment: '氛围段落',
    cinematic_open: '开场氛围',
    horizontal_collage: '横向拼贴',
    vertical_triptych: '三联屏',
    triptych_collage: '三联屏',
    split_collage: '分屏拼贴',
    color_peak: '色彩峰值',
    texture_cut: '质感切点',
    reflection_pause: '节奏留白',
    closing_frame: '收尾构图',
    beat_cut: '卡点切换',
    portal_reveal: '形状揭示',
    style_replication: '风格复刻',
    style_opening: '风格开场',
    color_unlock: '色彩解锁',
};
export const SLOT_TAG_LABELS = {
    intro: '开篇',
    opening: '开场',
    water_scene: '水景',
    landscape: '风光',
    closing: '收尾',
    outro: '片尾',
    style_reference: '风格参考',
    beat_sync: '节拍同步',
    collage: '拼贴',
    portal: '形状转场',
    overlay: '叠加层',
};
export function creativeRoleLabel(value) {
    if (!value)
        return '未判断';
    return CREATIVE_ROLE_LABELS[value] ?? value;
}
export function slotTagLabel(value) {
    return SLOT_TAG_LABELS[value] ?? value;
}
//# sourceMappingURL=director-labels.js.map