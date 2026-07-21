import { remotionRenderer } from '../render-engine/remotion-renderer.service.js'
import {
  formatRenderOutputQualityFailure,
  inspectRenderedOutput,
} from '../render-engine/render-output-quality.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'
import {
  artifactRefForPath,
  recordAgentTraceEvent,
  writeAgentTraceArtifact,
} from '../agent-trace/writer.js'
import { agentTraceArtifactsDir } from '../agent-trace/paths.js'
import {
  evaluateRenderedVideo,
  formatPostRenderEvaluationMarkdown,
} from '../agent-tools/post-render-evaluation-tool.js'
import type {
  GenerateInput,
  GenerateOutput,
  VideoGeneratorPort,
} from './generator.port.js'
import type {
  EditorialSplitCollageEffects,
  PrimitiveCollageLayoutEffects,
  RenderEffectLayer,
  RenderPlanV1,
  SceneEffects,
} from '../../../../shared/types/render-plan.v1.js'
import { validateRenderPlanComponents } from '../remotion-component-authoring/capability-resolver.js'

function normalizeSceneEffects(effects: SceneEffects | undefined): SceneEffects | undefined {
  if (!effects) return effects
  if (effects.preset === 'editorial_split_collage') {
    const collage = effects as EditorialSplitCollageEffects
    return {
      ...collage,
      panels: Array.isArray(collage.panels) ? collage.panels : [],
    }
  }
  if (effects.preset === 'primitive_collage_layout') {
    const collage = effects as PrimitiveCollageLayoutEffects
    return {
      ...collage,
      panels: Array.isArray(collage.panels) ? collage.panels : [],
    }
  }
  return effects
}

function normalizeEffectLayer(layer: RenderEffectLayer): RenderEffectLayer {
  const effects = normalizeSceneEffects(layer.effects)
  return !effects || effects === layer.effects ? layer : { ...layer, effects }
}

function isNonRenderablePlaceholderUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'example.com' || hostname.endsWith('.example.com')
  } catch {
    return false
  }
}

const DISABLED_EFFECT_PRESETS = new Set([
  'primitive_beat_pulse',
  'primitive_beat_flash_overlay',
])

function isDisabledBeatDriverLayer(layer: RenderEffectLayer): boolean {
  return (
    layer.plugin_id === 'beat_cut_driver' ||
    layer.layerKind === 'audio_driver' ||
    DISABLED_EFFECT_PRESETS.has(layer.preset) ||
    DISABLED_EFFECT_PRESETS.has(layer.effects.preset)
  )
}

function sanitizeRenderPlanForRemotion(plan: RenderPlanV1): RenderPlanV1 {
  const removedAssetIds = new Set(
    plan.assets
      .filter((asset) => isNonRenderablePlaceholderUrl(asset.url))
      .map((asset) => asset.id),
  )
  const assets = removedAssetIds.size
    ? plan.assets.filter((asset) => !removedAssetIds.has(asset.id))
    : plan.assets

  return {
    ...plan,
    assets,
    scenes: plan.scenes.map((scene) => {
      const effects =
        scene.effects && DISABLED_EFFECT_PRESETS.has(scene.effects.preset)
          ? undefined
          : normalizeSceneEffects(scene.effects)
      const effectLayers = scene.effect_layers
        ?.map(normalizeEffectLayer)
        .filter((layer) => !isDisabledBeatDriverLayer(layer))
      const audio = removedAssetIds.size
        ? scene.audio.filter(
            (layer) => !layer.asset_id || !removedAssetIds.has(layer.asset_id),
          )
        : scene.audio
      const visualAssetRemoved =
        scene.visual.asset_id && removedAssetIds.has(scene.visual.asset_id)
      const visual = visualAssetRemoved
        ? {
            ...scene.visual,
            mode: 'ai_generated' as const,
            asset_id: undefined,
            material_source: undefined,
            trim: undefined,
          }
        : scene.visual
      if (
        effects === scene.effects &&
        effectLayers === scene.effect_layers &&
        audio === scene.audio &&
        visual === scene.visual
      ) {
        return scene
      }
      return {
        ...scene,
        visual,
        effects,
        audio,
        ...(effectLayers ? { effect_layers: effectLayers } : {}),
      }
    }),
  }
}

export class RemotionVideoGenerator implements VideoGeneratorPort {
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    if (!input.renderPlan) {
      throw new Error('renderPlan is required for Remotion generation')
    }

    const renderPlan = await validateRenderPlanComponents(
      sanitizeRenderPlanForRemotion(input.renderPlan),
    )
    const output = await remotionRenderer.renderMedia(renderPlan, {
      requireRender: true,
      onProgress: (event) => {
        broadcastTaskProgress(input.taskId, {
          progress: Math.min(98, 22 + event.progress * 0.76),
          stage: 'Rendering',
          log: event.message,
        })
      },
    })

    if (!output.finalVideoUrl) {
      throw new Error('Remotion render did not return finalVideoUrl')
    }

    const quality = await inspectRenderedOutput({
      outputPath: output.outputPath,
      expectedDurationSec: renderPlan.duration_sec,
    })
    await writeAgentTraceArtifact({
      taskId: input.taskId,
      phase: 'quality_gate',
      actor: 'validator',
      fileName: 'render-output-quality.json',
      summary: quality.ok
        ? 'Render output quality check passed.'
        : 'Render output quality check failed.',
      json: quality,
      status: quality.ok ? 'success' : 'failed',
      data: { ok: quality.ok },
    })
    if (!quality.ok) {
      throw new Error(formatRenderOutputQualityFailure(quality))
    }

    const evaluation = await evaluateRenderedVideo({
      taskId: input.taskId,
      renderPlan,
      outputPath: output.outputPath,
      sampleVideoUrl: input.sampleVideoUrl ?? input.structure.source_video?.url,
      quality,
      artifactDir: agentTraceArtifactsDir(input.taskId, 'quality_gate'),
    })
    await writeAgentTraceArtifact({
      taskId: input.taskId,
      phase: 'quality_gate',
      actor: 'validator',
      fileName: 'post-render-evaluation.json',
      summary: evaluation.warnings.length
        ? `Post-render evaluation completed with ${evaluation.warnings.length} warning(s).`
        : 'Post-render evaluation completed.',
      json: evaluation,
      status: evaluation.warnings.length ? 'warning' : 'success',
      data: {
        warning_count: evaluation.warnings.length,
        material_usage_rate: evaluation.metrics.material_usage_rate,
        transition_non_cut_coverage_rate:
          evaluation.metrics.transition_non_cut_coverage_rate,
      },
    })
    await writeAgentTraceArtifact({
      taskId: input.taskId,
      phase: 'quality_gate',
      actor: 'validator',
      fileName: 'post-render-evaluation.zh.md',
      summary: 'Post-render evaluation Chinese summary written.',
      text: formatPostRenderEvaluationMarkdown(evaluation),
      status: evaluation.warnings.length ? 'warning' : 'success',
    })
    const framePaths = evaluation.keyframe_comparison.flatMap((item) =>
      [item.sample_frame_path, item.output_frame_path].filter((value): value is string =>
        Boolean(value),
      ),
    )
    if (framePaths.length > 0) {
      const frameRefs = await Promise.all(
        framePaths.map((framePath) =>
          artifactRefForPath({
            taskId: input.taskId,
            path: framePath,
            kind: 'image',
            phase: 'quality_gate',
            category: 'audit',
          }),
        ),
      )
      await recordAgentTraceEvent({
        taskId: input.taskId,
        phase: 'quality_gate',
        actor: 'validator',
        event: 'artifact',
        status: 'success',
        summary: 'Post-render keyframe comparison images extracted.',
        artifactRefs: frameRefs,
      })
    }

    broadcastTaskProgress(input.taskId, {
      progress: 99,
      stage: 'Quality Check',
      log: quality.actualDurationSec
        ? `Render output checked: ${quality.actualDurationSec.toFixed(2)}s.`
        : 'Render output file checked.',
    })

    return {
      finalVideoUrl: output.finalVideoUrl,
      durationSec: quality.actualDurationSec ?? renderPlan.duration_sec,
    }
  }
}

export const remotionVideoGenerator = new RemotionVideoGenerator()
