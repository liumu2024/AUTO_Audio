import { SCENIC_FILM_GRADE_PLUGINS } from './scenic-film-grade.js';
export const TEXTURE_GRADE_PLUGINS = [
    ...SCENIC_FILM_GRADE_PLUGINS,
    {
        id: 'cinematic_texture_grade',
        label: 'Cinematic Texture Grade',
        status: 'verified',
        targetLayer: 'effect',
        layerKind: 'texture_grade',
        atomicity: 'atomic',
        family: 'texture_grade',
        primaryLayer: 'texture_grade',
        secondaryLayers: [],
        fallbackPreset: 'primitive_texture_grade',
        capabilities: ['cinematic grade', 'film grain', 'vignette', '电影感', '胶片颗粒'],
        requiredParams: [],
        defaultParams: {},
        compatibleLayers: ['motion_driver', 'mask_reveal', 'distortion', 'layout', 'audio_driver', 'color_transform'],
        acceptedAssetTypes: ['image', 'video', 'generated_video'],
        negativeKeywords: ['grayscale to color', 'color unlock', 'mask reveal'],
        boundary: {
            supports: {
                'style.texture': ['grain', 'vignette', 'soft_contrast'],
                'style.look': ['cinematic', 'film'],
                'style.color_transform': ['grade_only'],
            },
            cannotSupport: [
                'style.color_transform=grayscale_to_color',
                'geometry.mask_shape=circle',
                'geometry.layout=collage',
                'motion.object=orb',
            ],
            forbiddenLayers: ['layout', 'mask_reveal', 'motion_driver', 'distortion', 'overlay'],
            requiresCompositionFor: ['color_unlock', 'mask_reveal', 'collage_layout'],
            adaptability: {
                style: 'high',
                timing: 'low',
                geometry: 'none',
                assets: 'medium',
            },
        },
    },
];
//# sourceMappingURL=cinematic-texture-grade.js.map