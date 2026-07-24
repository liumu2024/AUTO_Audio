export type V2TimelineCreationMode = 'sample_replicate' | 'material_brief' | 'text_to_video';
export interface V2TimelineRequestMaterial {
    id: string;
    name?: string;
    type: 'video' | 'image' | 'audio';
    src: string;
    publicUrl?: string;
    tags?: string[];
}
export interface V2TimelineRequestShape {
    creationMode: V2TimelineCreationMode;
    mainVideoPath?: string;
    referenceVideoPath?: string;
    imageSrc?: string;
    inputImageUrl?: string;
    materials: V2TimelineRequestMaterial[];
    sourceUrl: string;
}
/**
 * Derives the V2 creation branch from explicit sample input and candidate materials.
 * A user video remains a material unless it is separately supplied as the sample.
 */
export declare function buildV2TimelineRequestShape(input: {
    sampleVideoPath?: string;
    materials: V2TimelineRequestMaterial[];
}): V2TimelineRequestShape;
//# sourceMappingURL=v2-timeline-request-shape.d.ts.map