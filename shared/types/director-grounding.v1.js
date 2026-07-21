/** Director Grounding Layer — 内容域与视觉机制枚举（样例理解 → Remotion） */
export const CONTENT_DOMAINS = [
    'landscape_montage',
    'product_ad',
    'music_visual',
    'motion_graphics',
    'talking_head',
    'unknown',
];
export const VISUAL_PHENOMENON_MECHANISMS = [
    'motion_driver',
    'mask_reveal',
    'distortion',
    'color_transform',
    'texture_grade',
    'color_grade',
    'layout',
    'overlay',
    'audio_driver',
];
export function isMarketingContentDomain(domain) {
    return domain === 'product_ad';
}
//# sourceMappingURL=director-grounding.v1.js.map