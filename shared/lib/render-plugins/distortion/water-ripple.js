export const DISTORTION_PLUGINS = [
    {
        id: 'water_ripple_distortion_overlay',
        label: 'Water Ripple Distortion Overlay',
        status: 'verified',
        targetLayer: 'effect',
        layerKind: 'distortion',
        atomicity: 'atomic',
        family: 'water_ripple',
        primaryLayer: 'distortion',
        secondaryLayers: [],
        fallbackPreset: 'primitive_ripple_displacement',
        capabilities: ['water ripple', 'wave distortion', 'ripple overlay', '水波', '波纹', '涟漪'],
        requiredParams: ['ripple.origin', 'ripple.duration_sec', 'ripple.radius_pct_keyframes'],
        defaultParams: {
            base_filter: 'contrast(1.08) saturate(1.05) brightness(0.96)',
        },
        compatibleLayers: ['texture_grade', 'audio_driver', 'motion_driver'],
        acceptedAssetTypes: ['image', 'video', 'generated_video'],
        boundary: {
            supports: {
                'distortion.family': ['water_ripple', 'wave_displacement'],
                'distortion.origin': ['point', 'center'],
                'distortion.motion': ['radial_expand'],
            },
            cannotSupport: [
                'geometry.layout=collage',
                'motion.object=orb',
                'style.color_transform=grayscale_to_color',
            ],
            forbiddenLayers: ['layout', 'motion_driver', 'mask_reveal', 'overlay'],
            requiresCompositionFor: ['texture_grade', 'audio_driver'],
            adaptability: {
                geometry: 'low',
                timing: 'medium',
                style: 'low',
                assets: 'medium',
            },
        },
    },
];
//# sourceMappingURL=water-ripple.js.map