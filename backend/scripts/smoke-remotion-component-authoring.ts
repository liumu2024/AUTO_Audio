import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'

process.env.ENABLE_REMOTION_COMPONENT_AUTHORING = 'false'

const taskId = `smoke_component_authoring_${Date.now()}`
const generatedComponentId = `gen_directional_prism_warp_${Date.now()}`
const generatedDir = path.resolve(
  process.cwd(),
  '..',
  'remotion',
  'src',
  'generated-components',
  generatedComponentId,
)

function buildStructure(): MigrationProtocolV12 {
  return {
    version: '1.2',
    metadata: {
      video_id: 'sample',
      duration_sec: 4,
    },
    source_video: {
      url: 'sample.mp4',
      duration: 4,
    },
    generated_video: {
      url: '',
      duration: 4,
    },
    semantic_anchors: [
      {
        anchor_id: 'seg_001',
        start_sec: 0,
        end_sec: 4,
        logic_intent: {
          marketing_role: 'color_energy_scene',
          emotion_vibe: 'dreamy',
        },
        match: {
          status: 'matched',
          asset_name: 'mat',
          asset_id: 'mat_001',
        },
        replication_instructions: {
          visual_generation_prompt: 'Directional prism warp reveal with layered color bending.',
          overlay_rewrite_instruction: '',
          visual_motion: {
            preset: 'push_in',
            intensity: 0.2,
            driver: 'useCurrentFrame',
          },
        },
      },
    ],
    director_grounding: {
      schema_version: 'director_grounding.v1',
      task_id: taskId,
      source: {
        sample_video: {
          id: 'sample_video',
          role: 'structure_source',
        },
        reference_materials: [],
      },
      intent: {
        raw_text: 'replicate',
        goal: 'replicate_structure',
        style_keywords: [],
        must_keep: [],
        must_change: [],
        generation_directive: 'Replicate style.',
      },
      audio_visual_evidence: {
        duration_sec: 4,
        key_observations: [],
        beat_summary: '',
      },
      visual_phenomena: [],
      temporal_events: [],
      style_summary: {
        style_family: 'experimental_prism',
        editing_pattern: 'single special effect',
        audio_sync_logic: 'none',
        visual_style: 'prism warp',
        pace: 'medium',
      },
      remotion_capability_plan: {
        matched_plugins: [],
        missing_capabilities: [
          {
            id: 'directional_prism_warp',
            description: 'Directional prism warp with refracted color bands and bend distortion.',
            suggested_contract: {
              segment_ids: ['seg_001'],
              direction: { x: 1, y: -0.2 },
              intensity: 0.8,
              duration_sec: 1.4,
            },
          },
        ],
        plugin_authoring_skill: {
          enabled: true,
          purpose: 'test',
          candidate_plugin_ids: ['directional_prism_warp'],
        },
      },
      render_recipe: {
        style_family: 'experimental_prism',
        global_effects: [],
        scene_effects: [],
      },
      critique: {
        likely_failure_points: [],
        repair_notes: [],
        final_decision: 'usable',
      },
    },
  }
}

function buildOverlayStructure(): MigrationProtocolV12 {
  const structure = buildStructure()
  return {
    ...structure,
    director_grounding: {
      ...(structure.director_grounding as Record<string, unknown>),
      remotion_capability_plan: {
        matched_plugins: [],
        missing_capabilities: [
          {
            id: 'text_color_label_overlay',
            description: 'Small color square above one Chinese color character before color unlock.',
            suggested_contract: {
              target_layer: 'overlay',
              segment_ids: ['seg_001'],
              params: {
                color_hex: '#00FF00',
                text_content: '绿',
                display_duration_before_unlock: 1.2,
              },
            },
          },
        ],
        plugin_authoring_skill: {
          enabled: true,
          purpose: 'test',
          candidate_plugin_ids: ['text_color_label_overlay'],
        },
      },
    },
  } as MigrationProtocolV12
}

function buildWatermarkStructure(): MigrationProtocolV12 {
  const structure = buildStructure()
  return {
    ...structure,
    director_grounding: {
      ...(structure.director_grounding as Record<string, unknown>),
      remotion_capability_plan: {
        matched_plugins: [],
        missing_capabilities: [
          {
            id: 'signature_watermark_overlay',
            description: 'Persistent signature watermark at the bottom center.',
            suggested_contract: {
              target_layer: 'overlay',
              segment_ids: ['seg_001'],
              content_text: '-AlanGaller-',
              opacity: 0.7,
            },
          },
        ],
        plugin_authoring_skill: {
          enabled: true,
          purpose: 'test',
          candidate_plugin_ids: ['signature_watermark_overlay'],
        },
      },
    },
  } as MigrationProtocolV12
}

function buildAdaptStructure(): MigrationProtocolV12 {
  const structure = buildStructure()
  return {
    ...structure,
    director_grounding: {
      ...(structure.director_grounding as Record<string, unknown>),
      remotion_capability_plan: {
        matched_plugins: [
          {
            preset: 'primitive_mask_reveal',
            plugin_id: 'circle_mask_reveal',
            reason: 'Sample uses diagonal mask reveal.',
            segment_ids: ['seg_001'],
          },
        ],
        missing_capabilities: [
          {
            id: 'soft_diagonal_mask_reveal',
            description: 'Soft directional mask reveal along diagonal sweep.',
            suggested_contract: {
              segment_ids: ['seg_001'],
              layer_kind: 'mask_reveal',
              intensity: 0.72,
              duration_sec: 1.1,
            },
          },
        ],
        plugin_authoring_skill: {
          enabled: false,
          purpose: 'test',
          candidate_plugin_ids: [],
        },
      },
    },
  } as MigrationProtocolV12
}

async function writeVerifiedManifest(): Promise<void> {
  await rm(generatedDir, { recursive: true, force: true })
  await mkdir(generatedDir, { recursive: true })
  await writeFile(
    path.join(generatedDir, 'component.tsx'),
    `import { AbsoluteFill } from 'remotion'
import type { GeneratedComponentRenderProps } from '../../component-registry'

export default function SmokeGeneratedComponent(_props: GeneratedComponentRenderProps) {
  return <AbsoluteFill style={{ background: '#ffffff' }} />
}
`,
    'utf8',
  )
  await writeFile(
    path.join(generatedDir, 'manifest.json'),
    `${JSON.stringify(
      {
        id: generatedComponentId,
        label: 'Directional Prism Warp',
        status: 'verified',
        description: 'Directional prism warp with refracted color bands and bend distortion.',
        capabilities: ['directional prism warp', 'refracted color bands', 'bend distortion'],
        visual_grammar: ['prism warp', 'color refraction', 'directional bands'],
        supported_asset_types: ['image', 'video', 'generated_video'],
        layer_kind: 'distortion',
        props_contract: {
          direction: { x: 1, y: -0.2 },
          intensity: 0.8,
        },
        fallback_preset: 'ripple_displacement',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function main() {
  const {
    applyComponentResolutionToRenderPlan,
    resolveRenderCapabilities,
    validateRenderPlanComponents,
  } = await import('../src/modules/remotion-component-authoring/capability-resolver.js')
  const { buildRenderPlanFromStructure } = await import('../../shared/lib/render-plan-builder.js')

  try {
    const structure = buildStructure()
    const fallbackResolution = await resolveRenderCapabilities({
      taskId,
      structure,
    })
    const fallbackDecision = fallbackResolution.componentResolution.decisions[0]
    if (!fallbackDecision || fallbackDecision.decision !== 'fallback') {
      throw new Error(`Expected fallback decision, got ${JSON.stringify(fallbackDecision)}`)
    }

    const debugDir = fallbackResolution.componentResolution.debug_dir
    if (!debugDir || !existsSync(path.join(debugDir, '06-component-resolution.report.json'))) {
      throw new Error('Expected component resolution debug report.')
    }

    const overlayResolution = await resolveRenderCapabilities({
      taskId: `${taskId}_overlay`,
      structure: buildOverlayStructure(),
    })
    const overlayDecision = overlayResolution.componentResolution.decisions[0]
    if (overlayDecision?.target_layer !== 'overlay') {
      throw new Error(`Expected overlay decision, got ${JSON.stringify(overlayDecision)}`)
    }

    await writeVerifiedManifest()
    const reuseResolution = await resolveRenderCapabilities({
      taskId: `${taskId}_reuse`,
      structure,
    })
    const reuseDecision = reuseResolution.componentResolution.decisions[0]
    if (!reuseDecision || reuseDecision.component_id !== generatedComponentId) {
      throw new Error(`Expected generated component reuse, got ${JSON.stringify(reuseDecision)}`)
    }
    if (reuseDecision.decision !== 'reuse') {
      throw new Error(`Expected reuse decision, got ${reuseDecision.decision}`)
    }

    const adaptResolution = await resolveRenderCapabilities({
      taskId: `${taskId}_adapt`,
      structure: buildAdaptStructure(),
    })
    const adaptDecision = adaptResolution.componentResolution.decisions[0]
    if (!adaptDecision || adaptDecision.decision !== 'fallback') {
      throw new Error(`Expected primitive fallback decision, got ${JSON.stringify(adaptDecision)}`)
    }
    if (adaptDecision.preset !== 'primitive_mask_reveal') {
      throw new Error(`Expected primitive_mask_reveal fallback preset, got ${adaptDecision.preset}`)
    }

    const plan = buildRenderPlanFromStructure({
      taskId,
      structure,
      materials: [
        {
          id: 'mat_001',
          material_type: 'IMAGE',
          label: 'sample',
          oss_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>',
          ai_tags: ['sample'],
          status: 'READY',
        },
      ],
    })
    const patchedPlan = applyComponentResolutionToRenderPlan(
      plan,
      reuseResolution.componentResolution,
    )
    if (!patchedPlan.component_resolution?.decisions.length) {
      throw new Error('Expected component_resolution on RenderPlan.')
    }
    const checkedPlan = await validateRenderPlanComponents(patchedPlan)
    if (checkedPlan.scenes[0]?.effects?.preset !== 'generated_component') {
      throw new Error('Expected generated_component effect after validation.')
    }

    const overlayPlan = applyComponentResolutionToRenderPlan(
      buildRenderPlanFromStructure({
        taskId: `${taskId}_overlay`,
        structure: buildOverlayStructure(),
        materials: [
          {
            id: 'mat_001',
            material_type: 'IMAGE',
            label: 'sample',
            oss_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>',
            ai_tags: ['sample'],
            status: 'READY',
          },
        ],
      }),
      overlayResolution.componentResolution,
    )
    const overlay = overlayPlan.scenes[0]?.overlays[0]
    if (!overlay?.style.color_label || overlay.text !== '绿') {
      throw new Error(`Expected color label overlay, got ${JSON.stringify(overlay)}`)
    }

    const watermarkResolution = await resolveRenderCapabilities({
      taskId: `${taskId}_watermark`,
      structure: buildWatermarkStructure(),
    })
    const watermarkPlan = applyComponentResolutionToRenderPlan(
      buildRenderPlanFromStructure({
        taskId: `${taskId}_watermark`,
        structure: buildWatermarkStructure(),
        materials: [],
      }),
      watermarkResolution.componentResolution,
    )
    const watermark = watermarkPlan.scenes[0]?.overlays[0]
    if (watermark?.text !== '-AlanGaller-' || watermark.style.color_label) {
      throw new Error(`Expected text watermark overlay, got ${JSON.stringify(watermark)}`)
    }

    console.log('[smoke-remotion-component-authoring] OK')
    console.log(
      JSON.stringify(
        {
          fallbackDecision: fallbackDecision.decision,
          overlayDecision: overlayDecision.target_layer,
          reuseDecision: reuseDecision.decision,
          adaptDecision: adaptDecision.decision,
          reusedComponent: reuseDecision.component_id,
          debugDir,
        },
        null,
        2,
      ),
    )
  } finally {
    await rm(generatedDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
