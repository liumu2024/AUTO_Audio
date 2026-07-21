import { create } from 'zustand'

import {
  buildOutlineFromStructure,
  buildTimelineFromStructure,
} from '@shared/lib/pipeline-builder'
import { createDefaultDirectorSlots } from '@shared/lib/director-understanding'
import { buildGenerationTimeline } from '@/lib/generation-timeline'
import { useCreationStore } from '@/stores/creationStore'
import { useDirectorContextStore } from '@/stores/directorContextStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { usePropertyEditorStore } from '@/stores/propertyEditorStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTimelineStore } from '@/stores/timelineStore'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'
import type { PipelineBundle } from '@/types/pipeline'

interface PipelineState {
  bundle: PipelineBundle | null
  hydrate: (bundle: PipelineBundle) => void
  applyStructure: (structure: MigrationProtocolV12) => void
}

function pickHydratedRenderPlan(bundle: PipelineBundle) {
  const incomingPlan = bundle.render_plan ?? null
  const currentState = useRenderPlanStore.getState()
  const currentPlan = currentState.plan

  if (!incomingPlan) return null
  if (!currentPlan) return incomingPlan
  if (currentState.isDirty) return currentPlan

  const incomingRevision = incomingPlan.plan_revision ?? 1
  const currentRevision = currentPlan.plan_revision ?? 1
  return incomingRevision >= currentRevision ? incomingPlan : currentPlan
}

function syncFromBundle(bundle: PipelineBundle): PipelineBundle {
  const effectiveRenderPlan = pickHydratedRenderPlan(bundle)
  const effectiveBundle = {
    ...bundle,
    render_plan: effectiveRenderPlan ?? undefined,
  }
  const structure = {
    ...effectiveBundle.structure,
    generated_video: effectiveBundle.generation?.final_video_url
      ? {
          url: effectiveBundle.generation.final_video_url,
          duration:
            effectiveBundle.generation.duration_sec ??
            effectiveBundle.structure.metadata.duration_sec,
        }
      : effectiveBundle.structure.generated_video?.url &&
          effectiveBundle.structure.generated_video.url !== effectiveBundle.structure.source_video.url
        ? effectiveBundle.structure.generated_video
        : {
            url: '',
            duration: effectiveBundle.structure.metadata.duration_sec,
          },
  } as MigrationProtocolV12

  useMigrationProjectStore.getState().setProject(structure)
  if (effectiveRenderPlan) {
    useRenderPlanStore.getState().setPlan(effectiveRenderPlan)
  } else {
    useRenderPlanStore.getState().setPlan(null)
  }
  if (effectiveBundle.director_context) {
    useDirectorContextStore.setState({
      context: {
        ...effectiveBundle.director_context,
        slots:
          effectiveBundle.director_context.slots ??
          createDefaultDirectorSlots({
            sampleVideoStatus: 'parsed',
            aspectRatio: effectiveRenderPlan?.canvas.ratio ?? '9:16',
            durationSec: effectiveRenderPlan?.duration_sec,
          }),
      },
    })
  }
  useTimelineStore.getState().setProject(
    effectiveRenderPlan
      ? buildGenerationTimeline(effectiveBundle.timeline, effectiveRenderPlan)
      : effectiveBundle.timeline,
  )
  const sourceDur = effectiveBundle.structure.source_video?.duration
  const metaDur = effectiveBundle.structure.metadata.duration_sec
  usePlaybackStore.getState().setDuration(
    sourceDur > 0 ? sourceDur : metaDur,
  )

  const firstAnchor = effectiveBundle.structure.semantic_anchors[0]
  if (firstAnchor) {
    usePropertyEditorStore
      .getState()
      .loadAnchor(firstAnchor.anchor_id, `编辑锚点: ${firstAnchor.anchor_id}`)
    useTimelineStore.getState().selectClip(`clip-v-${firstAnchor.anchor_id}`)
  }

  const parsed =
    effectiveBundle.structure.semantic_anchors.length > 0 &&
    Boolean(effectiveBundle.outline?.length)
  useCreationStore.getState().setSampleParsed(parsed)

  const editorStore = useEditorStore.getState()
  if (effectiveRenderPlan?.scenes.length) {
    editorStore.setGenerationEditEnabled(true)
    if (structure.generated_video.url && structure.generated_video.url !== structure.source_video.url) {
      editorStore.setTimelineMode('generation')
    }
  } else if (parsed) {
    editorStore.setGenerationEditEnabled(false)
    editorStore.setTimelineMode('sample')
  }

  return effectiveBundle
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  bundle: null,

  hydrate: (bundle) => {
    const effectiveBundle = syncFromBundle(bundle)
    set({ bundle: effectiveBundle })
  },

  applyStructure: (structure) => {
    const prev = get().bundle
    if (!prev) return

    const next: PipelineBundle = {
      ...prev,
      structure,
      timeline: buildTimelineFromStructure(structure),
      outline: buildOutlineFromStructure(structure),
      render_plan: prev.render_plan,
    }
    syncFromBundle(next)
    set({ bundle: next })
  },
}))
