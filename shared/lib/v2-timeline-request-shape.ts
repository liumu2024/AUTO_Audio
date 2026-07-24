export type V2TimelineCreationMode =
  | 'sample_replicate'
  | 'material_brief'
  | 'text_to_video'

export interface V2TimelineRequestMaterial {
  id: string
  name?: string
  type: 'video' | 'image' | 'audio'
  src: string
  publicUrl?: string
  tags?: string[]
}

export interface V2TimelineRequestShape {
  creationMode: V2TimelineCreationMode
  mainVideoPath?: string
  referenceVideoPath?: string
  imageSrc?: string
  inputImageUrl?: string
  materials: V2TimelineRequestMaterial[]
  sourceUrl: string
}

/**
 * Derives the V2 creation branch from explicit sample input and candidate materials.
 * A user video remains a material unless it is separately supplied as the sample.
 */
export function buildV2TimelineRequestShape(input: {
  sampleVideoPath?: string
  materials: V2TimelineRequestMaterial[]
}): V2TimelineRequestShape {
  const referenceVideoPath = input.sampleVideoPath?.trim() || undefined
  const mainVideo = input.materials.find((material) => material.type === 'video')
  const image = input.materials.find((material) => material.type === 'image')
  const creationMode: V2TimelineCreationMode = referenceVideoPath
    ? 'sample_replicate'
    : mainVideo || image
      ? 'material_brief'
      : 'text_to_video'

  return {
    creationMode,
    mainVideoPath: mainVideo?.src,
    referenceVideoPath,
    imageSrc: image?.src,
    inputImageUrl: image?.publicUrl,
    materials: input.materials,
    sourceUrl: mainVideo?.src ?? image?.src ?? referenceVideoPath ?? '',
  }
}
