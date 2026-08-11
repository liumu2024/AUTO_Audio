import {
  createDefaultDirectorSlots,
  mergeDirectorSlots,
} from '@shared/lib/director-understanding'
import type {
  DirectorContext,
  DirectorContextSlots,
  DirectorUserIntent,
} from '@shared/types/director-context'

import type { InputAttachment } from '@/stores/creationStore'

export type { DirectorConversationRuntime } from '@shared/lib/director-understanding'

function hasUserMaterial(attachments: InputAttachment[]): boolean {
  return attachments.some((item) => item.type === 'video' || item.type === 'image')
}

export function buildDirectorSampleVideoFromUI(input: {
  sampleUrl: string
  sampleName?: string
  existing?: DirectorContext['sampleVideo']
}): DirectorContext['sampleVideo'] {
  if (!input.sampleUrl.trim()) return undefined
  const existing = input.existing?.url === input.sampleUrl ? input.existing : undefined
  return {
    id: existing?.id ?? 'sample_video',
    url: input.sampleUrl,
    name: input.sampleName,
    reference: existing?.reference,
    sampleUnderstanding: existing?.sampleUnderstanding,
  }
}

export function buildDirectorContextFromUI(input: {
  sampleUrl: string
  sampleName?: string
  attachments: InputAttachment[]
  aspectRatio: DirectorContextSlots['aspectRatio']
  durationSec?: number
  styleIntensity: DirectorContextSlots['styleIntensity']
  explicitUiControls?: DirectorContext['explicitUiControls']
  isSampleParsed: boolean
  existing?: DirectorContext
}): DirectorContext {
  const baseSlots = input.existing?.slots ?? createDefaultDirectorSlots()
  const runtimeSlots = {
    sampleVideoStatus: input.isSampleParsed
      ? ('parsed' as const)
      : input.sampleUrl.trim()
        ? ('attached' as const)
        : ('missing' as const),
    materialStatus: hasUserMaterial(input.attachments)
      ? ('ready' as const)
      : ('missing' as const),
    aspectRatio: input.aspectRatio,
    durationSec: input.durationSec,
    styleIntensity: input.styleIntensity,
  }
  const explicitUiControls = input.explicitUiControls
  const userIntent: DirectorUserIntent = {
    ...(input.existing?.userIntent ?? {}),
    ...(explicitUiControls?.aspectRatio
      ? { aspectRatio: explicitUiControls.aspectRatio }
      : {}),
    ...(explicitUiControls?.durationSec !== undefined
      ? { durationSec: explicitUiControls.durationSec }
      : {}),
    ...(explicitUiControls?.styleIntensity
      ? { styleIntensity: explicitUiControls.styleIntensity }
      : {}),
  }

  return {
    sampleVideo: buildDirectorSampleVideoFromUI({
      sampleUrl: input.sampleUrl,
      sampleName: input.sampleName,
      existing: input.existing?.sampleVideo,
    }),
    materials: input.attachments.map((att) => ({
      id: att.materialId ?? att.id.replace(/^att_/, ''),
      type: att.type,
      url: att.url,
      name: att.name,
      tags: att.tags ?? [],
    })),
    userIntent,
    currentTimeline: input.existing?.currentTimeline,
    directorState: input.existing?.directorState,
    conversationSummary: input.existing?.conversationSummary,
    explicitUiControls,
    slots: mergeDirectorSlots(baseSlots, runtimeSlots),
  }
}
