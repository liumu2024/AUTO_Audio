/**
 * Derives the V2 creation branch from explicit sample input and candidate materials.
 * A user video remains a material unless it is separately supplied as the sample.
 */
export function buildV2TimelineRequestShape(input) {
    const referenceVideoPath = input.sampleVideoPath?.trim() || undefined;
    const mainVideo = input.materials.find((material) => material.type === 'video');
    const image = input.materials.find((material) => material.type === 'image');
    const creationMode = referenceVideoPath
        ? 'sample_replicate'
        : mainVideo || image
            ? 'material_brief'
            : 'text_to_video';
    return {
        creationMode,
        mainVideoPath: mainVideo?.src,
        referenceVideoPath,
        imageSrc: image?.src,
        inputImageUrl: image?.publicUrl,
        materials: input.materials,
        sourceUrl: mainVideo?.src ?? image?.src ?? referenceVideoPath ?? '',
    };
}
//# sourceMappingURL=v2-timeline-request-shape.js.map