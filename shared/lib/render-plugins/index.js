import { AUDIO_DRIVER_PLUGINS } from './audio-driver/beat-cut-driver.js';
import { COLOR_TRANSFORM_PLUGINS } from './color-transform/grayscale-to-color-transform.js';
import { DISTORTION_PLUGINS } from './distortion/water-ripple.js';
import { LAYOUT_PLUGINS } from './layout/split-collage-layout.js';
import { MASK_REVEAL_PLUGINS } from './mask-reveal/geometric-reveal.js';
import { MOTION_DRIVER_PLUGINS } from './motion-driver/orb-motion-driver.js';
import { OVERLAY_PLUGINS } from './overlay/text-signature-watermark.js';
import { TEXTURE_GRADE_PLUGINS } from './texture-grade/cinematic-texture-grade.js';
export const RENDER_PLUGIN_LAYER_BUCKETS = [
    {
        layerKind: 'motion_driver',
        directory: 'motion-driver',
        plugins: MOTION_DRIVER_PLUGINS,
    },
    {
        layerKind: 'mask_reveal',
        directory: 'mask-reveal',
        plugins: MASK_REVEAL_PLUGINS,
    },
    {
        layerKind: 'distortion',
        directory: 'distortion',
        plugins: DISTORTION_PLUGINS,
    },
    {
        layerKind: 'color_transform',
        directory: 'color-transform',
        plugins: COLOR_TRANSFORM_PLUGINS,
    },
    {
        layerKind: 'texture_grade',
        directory: 'texture-grade',
        plugins: TEXTURE_GRADE_PLUGINS,
    },
    {
        layerKind: 'layout',
        directory: 'layout',
        plugins: LAYOUT_PLUGINS,
    },
    {
        layerKind: 'audio_driver',
        directory: 'audio-driver',
        plugins: AUDIO_DRIVER_PLUGINS,
    },
    {
        layerKind: 'overlay',
        directory: 'overlay',
        plugins: OVERLAY_PLUGINS,
    },
];
export const LAYERED_RENDER_PLUGIN_MANIFESTS = RENDER_PLUGIN_LAYER_BUCKETS.flatMap((bucket) => bucket.plugins);
//# sourceMappingURL=index.js.map