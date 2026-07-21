/** Remotion 分层能力 registry — layerKind 与插件契约 */
export const CAPABILITY_LAYER_KINDS = [
    'motion_driver',
    'mask_reveal',
    'distortion',
    'color_transform',
    'texture_grade',
    'color_grade',
    'layout',
    'overlay',
    'audio_driver',
    'composite',
];
export function isOverlayCapability(manifest) {
    return manifest.targetLayer === 'overlay' || manifest.layerKind === 'overlay';
}
//# sourceMappingURL=capability-registry.v1.js.map