import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineMaterialJob,
  type RemotionTimelineSpecV1,
} from '../types/remotion-timeline-spec.v1.js'

export interface RemotionTimelineValidationIssue {
  path: string
  message: string
  severity: 'error' | 'warning'
}

export interface RemotionTimelineValidationReport {
  ok: boolean
  issues: RemotionTimelineValidationIssue[]
  summary: {
    asset_count: number
    scene_count: number
    transition_count: number
    overlay_count: number
    material_job_count: number
    duration_sec: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function materialJobMissingRequiredOutput(
  job: RemotionTimelineMaterialJob,
  assetIds: ReadonlySet<string>,
): boolean {
  if (job.type === 'generate_video' && job.status === 'planned' && !job.output_asset_id) return true
  return (job.type === 'reuse_asset' || job.status === 'fulfilled')
    && (!job.output_asset_id || !assetIds.has(job.output_asset_id))
}

function validateCustomRenderRef(
  issues: RemotionTimelineValidationIssue[],
  path: string,
  value: unknown,
  label: string,
) {
  if (value === undefined) return
  if (!isRecord(value)) {
    addIssue(issues, 'error', path, `${label} must be an object.`)
    return
  }
  const ref = value as { component_id?: unknown; display_name?: unknown }
  if (typeof ref.component_id !== 'string' || !ref.component_id.trim()) {
    addIssue(issues, 'error', `${path}.component_id`, `${label} requires a component_id.`)
  }
  if (ref.display_name !== undefined && (typeof ref.display_name !== 'string' || !ref.display_name.trim())) {
    addIssue(issues, 'error', `${path}.display_name`, `${label} display_name must be a non-empty string.`)
  }
}

function addIssue(
  issues: RemotionTimelineValidationIssue[],
  severity: RemotionTimelineValidationIssue['severity'],
  path: string,
  message: string,
): void {
  issues.push({ path, severity, message })
}

function validateRange(input: {
  issues: RemotionTimelineValidationIssue[]
  path: string
  start: unknown
  end: unknown
  durationSec?: number
}): void {
  if (!finiteNumber(input.start)) {
    addIssue(input.issues, 'error', `${input.path}.start_sec`, 'start_sec must be a finite number.')
  }
  if (!finiteNumber(input.end)) {
    addIssue(input.issues, 'error', `${input.path}.end_sec`, 'end_sec must be a finite number.')
  }
  if (!finiteNumber(input.start) || !finiteNumber(input.end)) return
  if (input.start < 0) {
    addIssue(input.issues, 'error', `${input.path}.start_sec`, 'start_sec must be >= 0.')
  }
  if (input.end <= input.start) {
    addIssue(input.issues, 'error', `${input.path}.end_sec`, 'end_sec must be after start_sec.')
  }
  if (input.durationSec != null && input.end > input.durationSec + 0.05) {
    addIssue(input.issues, 'error', `${input.path}.end_sec`, 'end_sec exceeds canvas duration_sec.')
  }
}

function validateUniqueId(input: {
  issues: RemotionTimelineValidationIssue[]
  ids: Set<string>
  path: string
  id: unknown
  label: string
}): string | undefined {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    addIssue(input.issues, 'error', `${input.path}.id`, `${input.label} id is required.`)
    return undefined
  }
  if (input.ids.has(input.id)) {
    addIssue(input.issues, 'error', `${input.path}.id`, `${input.label} id must be unique.`)
    return undefined
  }
  input.ids.add(input.id)
  return input.id
}

export function validateRemotionTimelineSpec(value: unknown): RemotionTimelineValidationReport {
  const issues: RemotionTimelineValidationIssue[] = []
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: '$', severity: 'error', message: 'RemotionTimelineSpec must be an object.' }],
      summary: {
        asset_count: 0,
        scene_count: 0,
        transition_count: 0,
        overlay_count: 0,
        material_job_count: 0,
        duration_sec: 0,
      },
    }
  }

  const spec = value as unknown as RemotionTimelineSpecV1
  if (spec.schema_version !== REMOTION_TIMELINE_SPEC_SCHEMA_VERSION) {
    addIssue(
      issues,
      'error',
      'schema_version',
      `schema_version must be ${REMOTION_TIMELINE_SPEC_SCHEMA_VERSION}.`,
    )
  }

  if (!isRecord(spec.canvas)) {
    addIssue(issues, 'error', 'canvas', 'canvas is required.')
  }
  const durationSec = finiteNumber(spec.canvas?.duration_sec) ? spec.canvas.duration_sec : 0
  if (!finiteNumber(spec.canvas?.width) || spec.canvas.width <= 0) {
    addIssue(issues, 'error', 'canvas.width', 'canvas.width must be a positive number.')
  }
  if (!finiteNumber(spec.canvas?.height) || spec.canvas.height <= 0) {
    addIssue(issues, 'error', 'canvas.height', 'canvas.height must be a positive number.')
  }
  if (!finiteNumber(spec.canvas?.fps) || spec.canvas.fps <= 0) {
    addIssue(issues, 'error', 'canvas.fps', 'canvas.fps must be a positive number.')
  }
  if (!finiteNumber(spec.canvas?.duration_sec) || spec.canvas.duration_sec <= 0) {
    addIssue(issues, 'error', 'canvas.duration_sec', 'canvas.duration_sec must be a positive number.')
  }

  const assets = Array.isArray(spec.assets) ? spec.assets : []
  if (!Array.isArray(spec.assets)) addIssue(issues, 'error', 'assets', 'assets must be an array.')
  const assetIds = new Set<string>()
  assets.forEach((asset, index) => {
    const path = `assets[${index}]`
    validateUniqueId({ issues, ids: assetIds, path, id: asset.id, label: 'asset' })
    if (!['video', 'image', 'audio'].includes(asset.type)) {
      addIssue(issues, 'error', `${path}.type`, 'unsupported asset type.')
    }
    if (typeof asset.src !== 'string' || !asset.src.trim()) {
      addIssue(issues, 'error', `${path}.src`, 'asset src is required.')
    }
    if (!['user_asset', 'generated_asset', 'stock_asset', 'local_fixture', 'fallback_asset'].includes(asset.source)) {
      addIssue(issues, 'error', `${path}.source`, 'unsupported asset source.')
    }
  })

  const scenes = Array.isArray(spec.scenes) ? spec.scenes : []
  if (!Array.isArray(spec.scenes)) addIssue(issues, 'error', 'scenes', 'scenes must be an array.')
  if (scenes.length === 0) addIssue(issues, 'error', 'scenes', 'at least one scene is required.')
  const plannedOutputAssetBySceneId = new Map(
    (Array.isArray(spec.material_jobs) ? spec.material_jobs : [])
      .filter((job) => job.output_asset_id)
      .map((job) => [job.scene_id, job.output_asset_id as string]),
  )
  const sceneIds = new Set<string>()
  scenes.forEach((scene, index) => {
    const path = `scenes[${index}]`
    validateUniqueId({ issues, ids: sceneIds, path, id: scene.id, label: 'scene' })
    if (!['user_video', 'ai_video', 'image_motion', 'remotion_card', 'caption_scene', 'data_viz'].includes(scene.type)) {
      addIssue(issues, 'error', `${path}.type`, 'unsupported scene type.')
    }
    if (!finiteNumber(scene.start_sec)) {
      addIssue(issues, 'error', `${path}.start_sec`, 'start_sec must be a finite number.')
    }
    if (!finiteNumber(scene.duration_sec) || scene.duration_sec <= 0) {
      addIssue(issues, 'error', `${path}.duration_sec`, 'duration_sec must be a positive number.')
    }
    if (finiteNumber(scene.start_sec) && finiteNumber(scene.duration_sec)) {
      validateRange({
        issues,
        path,
        start: scene.start_sec,
        end: scene.start_sec + scene.duration_sec,
        durationSec,
      })
    }
    if (['user_video', 'ai_video', 'image_motion'].includes(scene.type)) {
      if (!scene.asset_id) {
        const plannedOutputAssetId = plannedOutputAssetBySceneId.get(scene.id)
        if (scene.type === 'ai_video' && plannedOutputAssetId) {
          addIssue(
            issues,
            'warning',
            `${path}.asset_id`,
            `asset_id will be assigned from planned generated asset ${plannedOutputAssetId} during material resolution.`,
          )
        } else {
          addIssue(issues, 'error', `${path}.asset_id`, `${scene.type} scenes require asset_id.`)
        }
      } else if (!assetIds.has(scene.asset_id)) {
        if (plannedOutputAssetBySceneId.get(scene.id) === scene.asset_id) {
          addIssue(
            issues,
            'warning',
            `${path}.asset_id`,
            'asset_id points to a planned generated asset that must be resolved before render.',
          )
        } else {
          addIssue(issues, 'error', `${path}.asset_id`, 'asset_id must reference an existing asset.')
        }
      }
    }
    if (scene.asset_id) {
      const asset = assets.find((item) => item.id === scene.asset_id)
      if (asset && (scene.type === 'user_video' || scene.type === 'ai_video') && asset.type !== 'video') {
        addIssue(issues, 'error', `${path}.asset_id`, 'video scenes must reference a video asset.')
      }
      if (asset && scene.type === 'image_motion' && asset.type !== 'image') {
        addIssue(issues, 'error', `${path}.asset_id`, 'image_motion scenes must reference an image asset.')
      }
    }
    validateCustomRenderRef(issues, `${path}.custom_render`, scene.custom_render, 'scene custom_render')
  })

  const sortedScenes = [...scenes].sort((a, b) => a.start_sec - b.start_sec)
  sortedScenes.forEach((scene, index) => {
    const next = sortedScenes[index + 1]
    if (!next) return
    const sceneEnd = scene.start_sec + scene.duration_sec
    if (sceneEnd > next.start_sec + 0.05) {
      addIssue(
        issues,
        'warning',
        'scenes',
        `scene ${scene.id} overlaps with ${next.id}; TransitionSeries will use declared order, not absolute overlap.`,
      )
    }
  })

  const transitions = Array.isArray(spec.transitions) ? spec.transitions : []
  if (!Array.isArray(spec.transitions)) {
    addIssue(issues, 'error', 'transitions', 'transitions must be an array.')
  }
  const transitionIds = new Set<string>()
  transitions.forEach((transition, index) => {
    const path = `transitions[${index}]`
    validateUniqueId({ issues, ids: transitionIds, path, id: transition.id, label: 'transition' })
    if (!sceneIds.has(transition.from_scene_id)) {
      addIssue(issues, 'error', `${path}.from_scene_id`, 'from_scene_id must reference an existing scene.')
    }
    if (!sceneIds.has(transition.to_scene_id)) {
      addIssue(issues, 'error', `${path}.to_scene_id`, 'to_scene_id must reference an existing scene.')
    }
    if (!(REMOTION_TIMELINE_TRANSITION_TYPES as readonly unknown[]).includes(transition.type)) {
      addIssue(issues, 'error', `${path}.type`, 'unsupported transition type.')
    }
    if (!finiteNumber(transition.duration_sec) || transition.duration_sec < 0) {
      addIssue(issues, 'error', `${path}.duration_sec`, 'duration_sec must be >= 0.')
    }
    if (transition.type === 'cut' && transition.duration_sec !== 0) {
      addIssue(issues, 'warning', `${path}.duration_sec`, 'cut transitions should use duration_sec = 0.')
    }
    if (finiteNumber(transition.duration_sec) && transition.duration_sec > 1.5) {
      addIssue(issues, 'warning', `${path}.duration_sec`, 'long transitions can make scene timing feel loose.')
    }
    if (transition.custom_render !== undefined) {
      if (!isRecord(transition.custom_render)) {
        addIssue(issues, 'error', `${path}.custom_render`, 'transition custom_render must be an object.')
      }
      validateCustomRenderRef(issues, `${path}.custom_render`, transition.custom_render, 'transition custom_render')
    }
  })

  const overlays = Array.isArray(spec.overlays) ? spec.overlays : []
  if (!Array.isArray(spec.overlays)) addIssue(issues, 'error', 'overlays', 'overlays must be an array.')
  const captionTracks = spec.caption_tracks == null ? [] : Array.isArray(spec.caption_tracks) ? spec.caption_tracks : []
  if (spec.caption_tracks != null && !Array.isArray(spec.caption_tracks)) {
    addIssue(issues, 'error', 'caption_tracks', 'caption_tracks must be an array when provided.')
  }
  const captionTrackIds = new Set<string>()
  captionTracks.forEach((track, index) => {
    const path = `caption_tracks[${index}]`
    validateUniqueId({ issues, ids: captionTrackIds, path, id: track.id, label: 'caption track' })
    if (!finiteNumber(track.x_pct)) addIssue(issues, 'error', `${path}.x_pct`, 'x_pct must be a finite number.')
    if (!finiteNumber(track.y_pct)) addIssue(issues, 'error', `${path}.y_pct`, 'y_pct must be a finite number.')
    if (
      track.max_lines != null &&
      (!Number.isInteger(track.max_lines) || track.max_lines < 1 || track.max_lines > 8)
    ) {
      addIssue(issues, 'error', `${path}.max_lines`, 'max_lines must be an integer between 1 and 8.')
    }
    if (track.z_index != null && !Number.isInteger(track.z_index)) {
      addIssue(issues, 'error', `${path}.z_index`, 'z_index must be an integer when provided.')
    }
    for (const [name, animation] of [
      ['enter_animation', track.enter_animation],
      ['exit_animation', track.exit_animation],
    ] as const) {
      if (animation && !['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'].includes(animation)) {
        addIssue(issues, 'error', `${path}.${name}`, 'unsupported caption track animation.')
      }
    }
    if (track.overlap_policy && !['forbid', 'allow_crossfade'].includes(track.overlap_policy)) {
      addIssue(issues, 'error', `${path}.overlap_policy`, 'unsupported caption track overlap policy.')
    }
  })
  const overlayIds = new Set<string>()
  overlays.forEach((overlay, index) => {
    const path = `overlays[${index}]`
    validateUniqueId({ issues, ids: overlayIds, path, id: overlay.id, label: 'overlay' })
    if (!['caption', 'title', 'label', 'shape', 'image_badge', 'light_sweep'].includes(overlay.type)) {
      addIssue(issues, 'error', `${path}.type`, 'unsupported overlay type.')
    }
    validateRange({
      issues,
      path,
      start: overlay.start_sec,
      end: overlay.end_sec,
      durationSec,
    })
    if (overlay.scene_id && !sceneIds.has(overlay.scene_id)) {
      addIssue(issues, 'error', `${path}.scene_id`, 'scene_id must reference an existing scene.')
    }
    if (overlay.scene_id && sceneIds.has(overlay.scene_id) && finiteNumber(overlay.start_sec) && finiteNumber(overlay.end_sec)) {
      const scene = scenes.find((item) => item.id === overlay.scene_id)
      if (scene && (overlay.start_sec < scene.start_sec - 0.05 || overlay.end_sec > scene.start_sec + scene.duration_sec + 0.05)) {
        addIssue(issues, 'error', path, 'scene overlay must stay within its referenced scene time range.')
      }
    }
    if (overlay.track_id && overlay.type !== 'caption') {
      addIssue(issues, 'error', `${path}.track_id`, 'track_id is only supported by caption overlays.')
    }
    if (overlay.type === 'caption' && overlay.track_id && !captionTrackIds.has(overlay.track_id)) {
      addIssue(issues, 'error', `${path}.track_id`, 'track_id must reference an existing caption track.')
    }
    if (['caption', 'title', 'label'].includes(overlay.type) && !overlay.text?.trim()) {
      addIssue(issues, 'error', `${path}.text`, `${overlay.type} overlays require text.`)
    }
    if (overlay.type === 'image_badge' && !overlay.asset_id) {
      addIssue(issues, 'error', `${path}.asset_id`, 'image_badge overlays require asset_id.')
    }
    if (overlay.asset_id && !assetIds.has(overlay.asset_id)) {
      addIssue(issues, 'error', `${path}.asset_id`, 'asset_id must reference an existing asset.')
    }
    if (!finiteNumber(overlay.x_pct)) addIssue(issues, 'error', `${path}.x_pct`, 'x_pct must be a finite number.')
    if (!finiteNumber(overlay.y_pct)) addIssue(issues, 'error', `${path}.y_pct`, 'y_pct must be a finite number.')
    if (
      overlay.max_lines != null &&
      (!Number.isInteger(overlay.max_lines) || overlay.max_lines < 1 || overlay.max_lines > 8)
    ) {
      addIssue(issues, 'error', `${path}.max_lines`, 'max_lines must be an integer between 1 and 8.')
    }
    if (overlay.opacity != null && (!finiteNumber(overlay.opacity) || overlay.opacity < 0 || overlay.opacity > 1)) {
      addIssue(issues, 'error', `${path}.opacity`, 'opacity must be between 0 and 1.')
    }
    if (overlay.animation && !['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'].includes(overlay.animation)) {
      addIssue(issues, 'error', `${path}.animation`, 'unsupported overlay animation.')
    }
    for (const [name, animation] of [
      ['enter_animation', overlay.enter_animation],
      ['exit_animation', overlay.exit_animation],
    ] as const) {
      if (animation && !['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'].includes(animation)) {
        addIssue(issues, 'error', `${path}.${name}`, 'unsupported overlay animation.')
      }
    }
    if (overlay.z_index != null && !Number.isInteger(overlay.z_index)) {
      addIssue(issues, 'error', `${path}.z_index`, 'z_index must be an integer when provided.')
    }
  })

  for (const track of captionTracks) {
    const segments = overlays
      .filter((overlay) => overlay.type === 'caption' && overlay.track_id === track.id)
      .slice()
      .sort((a, b) => a.start_sec - b.start_sec)
    for (let index = 0; index < segments.length - 1; index += 1) {
      const current = segments[index]
      const next = segments[index + 1]
      const overlap = current.end_sec - next.start_sec
      if (overlap <= 0.01) continue
      if (track.overlap_policy !== 'allow_crossfade') {
        addIssue(issues, 'error', `overlays[${overlays.indexOf(next)}]`, `caption track ${track.id} does not allow overlapping segments.`)
      } else if (overlap > 0.5) {
        addIssue(issues, 'error', `overlays[${overlays.indexOf(next)}]`, `caption track ${track.id} crossfade overlap must not exceed 0.5 seconds.`)
      }
    }
  }

  const audio = spec.audio == null ? [] : Array.isArray(spec.audio) ? spec.audio : []
  if (spec.audio != null && !Array.isArray(spec.audio)) {
    addIssue(issues, 'error', 'audio', 'audio must be an array when provided.')
  }
  const audioIds = new Set<string>()
  audio.forEach((clip, index) => {
    const path = `audio[${index}]`
    validateUniqueId({ issues, ids: audioIds, path, id: clip.id, label: 'audio clip' })
    if (!assetIds.has(clip.asset_id)) {
      addIssue(issues, 'error', `${path}.asset_id`, 'audio clip asset_id must reference an existing asset.')
    } else if (assets.find((asset) => asset.id === clip.asset_id)?.type !== 'audio') {
      addIssue(issues, 'error', `${path}.asset_id`, 'audio clip asset_id must reference an audio asset.')
    }
    validateRange({
      issues,
      path,
      start: clip.start_sec,
      end: clip.end_sec,
      durationSec,
    })
    if (clip.volume != null && (!finiteNumber(clip.volume) || clip.volume < 0 || clip.volume > 1)) {
      addIssue(issues, 'error', `${path}.volume`, 'volume must be between 0 and 1.')
    }
  })

  const materialJobs = Array.isArray(spec.material_jobs) ? spec.material_jobs : []
  if (!Array.isArray(spec.material_jobs)) {
    addIssue(issues, 'error', 'material_jobs', 'material_jobs must be an array.')
  }
  const jobIds = new Set<string>()
  materialJobs.forEach((job, index) => {
    const path = `material_jobs[${index}]`
    validateUniqueId({ issues, ids: jobIds, path, id: job.id, label: 'material job' })
    if (!sceneIds.has(job.scene_id)) {
      addIssue(issues, 'error', `${path}.scene_id`, 'scene_id must reference an existing scene.')
    }
    if (!['reuse_asset', 'generate_video', 'request_user_material'].includes(job.type)) {
      addIssue(issues, 'error', `${path}.type`, 'unsupported material job type.')
    }
    if (!['planned', 'fulfilled', 'failed'].includes(job.status)) {
      addIssue(issues, 'error', `${path}.status`, 'unsupported material job status.')
    }
    if (job.type === 'generate_video' && !job.prompt?.trim()) {
      addIssue(issues, 'error', `${path}.prompt`, 'generate_video jobs require prompt.')
    }
    if (job.input_asset_id) {
      const inputAsset = assets.find((asset) => asset.id === job.input_asset_id)
      if (job.type !== 'generate_video') {
        addIssue(issues, 'error', `${path}.input_asset_id`, 'input_asset_id is only valid for generate_video jobs.')
      } else if (!inputAsset) {
        addIssue(issues, 'error', `${path}.input_asset_id`, 'input_asset_id must reference an existing asset.')
      } else if (inputAsset.type !== 'image') {
        addIssue(issues, 'error', `${path}.input_asset_id`, 'input_asset_id must reference an image asset.')
      }
      const sceneIndex = scenes.findIndex((scene) => scene.id === job.scene_id)
      const explanation = sceneIndex >= 0 ? scenes[sceneIndex]?.creative_intent?.description : undefined
      if (sceneIndex >= 0 && !explanation?.trim()) {
        addIssue(
          issues,
          'error',
          `scenes[${sceneIndex}].creative_intent.description`,
          'image-conditioned generation must explain how the source image is used.',
        )
      }
    }
    if (job.input_asset_id && job.input_image_url) {
      addIssue(issues, 'error', path, 'use input_asset_id or legacy input_image_url, not both.')
    }
    if (materialJobMissingRequiredOutput(job, assetIds)) {
      addIssue(
        issues,
        'error',
        `${path}.output_asset_id`,
        `${job.type} ${job.status} jobs require an available output asset.`,
      )
    } else if (job.output_asset_id && !assetIds.has(job.output_asset_id)) {
      addIssue(
        issues,
        job.status === 'fulfilled' ? 'error' : 'warning',
        `${path}.output_asset_id`,
        'output_asset_id should reference an asset after resolution.',
      )
    }
    const outputAsset = job.output_asset_id
      ? assets.find((asset) => asset.id === job.output_asset_id)
      : undefined
    if (outputAsset && outputAsset.type !== 'video' && outputAsset.type !== 'image') {
      addIssue(issues, 'error', `${path}.output_asset_id`, 'material job output must be a video or image asset.')
    }
    const fallbackAsset = job.fallback_asset_id
      ? assets.find((asset) => asset.id === job.fallback_asset_id)
      : undefined
    if (job.fallback_asset_id && !fallbackAsset) {
      addIssue(issues, 'error', `${path}.fallback_asset_id`, 'fallback_asset_id must reference an existing asset.')
    } else if (fallbackAsset && fallbackAsset.type !== 'video' && fallbackAsset.type !== 'image') {
      addIssue(issues, 'error', `${path}.fallback_asset_id`, 'fallback asset must be a video or image.')
    }
  })

  if (spec.render_policy?.renderer !== 'remotion_timeline') {
    addIssue(issues, 'error', 'render_policy.renderer', 'render_policy.renderer must be remotion_timeline.')
  }
  if (isRecord(spec.render_policy)) {
    for (const field of Object.keys(spec.render_policy)) {
      if (!['renderer', 'fallback_renderer'].includes(field)) {
        addIssue(issues, 'error', `render_policy.${field}`, 'unsupported render policy field.')
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    summary: {
      asset_count: assets.length,
      scene_count: scenes.length,
      transition_count: transitions.length,
      overlay_count: overlays.length,
      material_job_count: materialJobs.length,
      duration_sec: durationSec,
    },
  }
}

export function assertValidRemotionTimelineSpec(value: unknown): RemotionTimelineSpecV1 {
  const report = validateRemotionTimelineSpec(value)
  if (!report.ok) {
    const details = report.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 16)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid RemotionTimelineSpec:\n${details}`)
  }
  return value as RemotionTimelineSpecV1
}
