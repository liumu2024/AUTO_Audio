import type {
  AudioReactiveCutDriverEffects,
  CinematicGradePackEffects,
  CinematicLightSweepEffects,
  ColorPortalSpotlightEffects,
  EditorialSplitCollageEffects,
  KineticColorRippleEffects,
  MaskSliceTransitionEffects,
  RenderEffectLayer,
  RippleDisplacementEffects,
  SceneEffects,
} from '../types/render-plan.v1.js'

function childLayer(
  parent: RenderEffectLayer,
  idSuffix: string,
  input: {
    layerKind: RenderEffectLayer['layerKind']
    plugin_id: string
    preset: SceneEffects['preset']
    effects: SceneEffects
    reason: string
  },
): RenderEffectLayer {
  return {
    ...parent,
    id: `${parent.id}_${idSuffix}`,
    layerKind: input.layerKind,
    kind: input.layerKind,
    plugin_id: input.plugin_id,
    preset: input.preset,
    effects: input.effects,
    is_primary: false,
    reason: `${parent.reason ?? ''} ${input.reason}`.trim(),
  }
}

function textureGradeLayer(
  parent: RenderEffectLayer,
  suffix: string,
  input: { base_filter?: string; color_grade?: CinematicGradePackEffects['color_grade'] },
  reason: string,
): RenderEffectLayer {
  return childLayer(parent, suffix, {
    layerKind: 'texture_grade',
    plugin_id: 'cinematic_texture_grade',
    preset: 'primitive_texture_grade',
    effects: {
      preset: 'primitive_texture_grade',
      base_filter: input.base_filter,
      color_grade: input.color_grade,
    },
    reason,
  })
}

function vignetteLayer(
  parent: RenderEffectLayer,
  vignette: NonNullable<CinematicGradePackEffects['vignette']>,
  reason: string,
): RenderEffectLayer {
  return childLayer(parent, 'vignette', {
    layerKind: 'texture_grade',
    plugin_id: 'cinematic_texture_grade',
    preset: 'primitive_vignette_overlay',
    effects: { preset: 'primitive_vignette_overlay', vignette },
    reason,
  })
}

function grainLayer(
  parent: RenderEffectLayer,
  grain: NonNullable<CinematicGradePackEffects['grain']>,
  reason: string,
): RenderEffectLayer {
  return childLayer(parent, 'grain', {
    layerKind: 'texture_grade',
    plugin_id: 'cinematic_texture_grade',
    preset: 'primitive_grain_overlay',
    effects: { preset: 'primitive_grain_overlay', grain },
    reason,
  })
}

function letterboxLayer(
  parent: RenderEffectLayer,
  letterbox: NonNullable<CinematicGradePackEffects['letterbox']>,
  reason: string,
): RenderEffectLayer {
  return childLayer(parent, 'letterbox', {
    layerKind: 'texture_grade',
    plugin_id: 'cinematic_texture_grade',
    preset: 'primitive_letterbox_overlay',
    effects: { preset: 'primitive_letterbox_overlay', letterbox },
    reason,
  })
}

export function splitLegacyColorPortalLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'color_portal_spotlight') return [layer]
  const effect = layer.effects as ColorPortalSpotlightEffects
  const mask = {
    shape: effect.portal.shape,
    radius_pct_keyframes: effect.portal.radius_pct_keyframes,
    position_keyframes: effect.portal.position_keyframes,
    beat_reactive_scale: effect.portal.beat_reactive_scale,
  }
  const colorTransform = childLayer(layer, 'color_transform', {
    layerKind: 'color_transform',
    plugin_id: 'grayscale_to_color_transform',
    preset: 'primitive_color_transform',
    effects: {
      preset: 'primitive_color_transform',
      transform: 'grayscale_to_color_base',
      base_filter: effect.base_filter ?? 'grayscale(100%) contrast(1.08)',
    },
    reason: 'Split from legacy color_portal_spotlight: grayscale base transform.',
  })
  const maskReveal = childLayer(layer, 'mask_reveal', {
    layerKind: 'mask_reveal',
    plugin_id: 'circle_mask_reveal',
    preset: 'primitive_mask_reveal',
    effects: { preset: 'primitive_mask_reveal', mask },
    reason: 'Split from legacy color_portal_spotlight: circular mask reveal.',
  })
  const ringOverlay = effect.ring
    ? childLayer(layer, 'ring_overlay', {
        layerKind: 'motion_driver',
        plugin_id: 'portal_ring_overlay',
        preset: 'primitive_ring_overlay',
        effects: { preset: 'primitive_ring_overlay', ring: effect.ring, mask },
        reason: 'Split from legacy color_portal_spotlight: ring overlay.',
      })
    : undefined
  return [colorTransform, maskReveal, ...(ringOverlay ? [ringOverlay] : [])]
}

export function splitLegacyKineticColorRippleLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'kinetic_color_ripple') return [layer]
  const effect = layer.effects as KineticColorRippleEffects
  const colorTransform = childLayer(layer, 'color_transform', {
    layerKind: 'color_transform',
    plugin_id: 'grayscale_to_color_transform',
    preset: 'primitive_color_transform',
    effects: {
      preset: 'primitive_color_transform',
      transform: 'grayscale_to_color_base',
      base_filter: effect.base_filter ?? 'grayscale(100%) contrast(1.18)',
    },
    reason: 'Split from legacy kinetic_color_ripple: grayscale base transform.',
  })
  const waveReveal = childLayer(layer, 'wave_reveal', {
    layerKind: 'mask_reveal',
    plugin_id: 'directional_wave_reveal',
    preset: 'primitive_directional_wave_reveal',
    effects: {
      preset: 'primitive_directional_wave_reveal',
      color_layer: effect.color_layer,
      reveal_events: effect.reveal_events,
    },
    reason: 'Split from legacy kinetic_color_ripple: directional wave reveal.',
  })
  const orbMotion = childLayer(layer, 'orb_motion', {
    layerKind: 'motion_driver',
    plugin_id: 'orb_motion_driver',
    preset: 'primitive_orb_motion',
    effects: { preset: 'primitive_orb_motion', orb: effect.orb },
    reason: 'Split from legacy kinetic_color_ripple: orb motion.',
  })
  const ringOverlay = effect.ring
    ? childLayer(layer, 'orb_ring', {
        layerKind: 'motion_driver',
        plugin_id: 'orb_ring_follow_overlay',
        preset: 'primitive_orb_ring_overlay',
        effects: {
          preset: 'primitive_orb_ring_overlay',
          orb: effect.orb,
          ring: effect.ring,
        },
        reason: 'Split from legacy kinetic_color_ripple: orb follow ring.',
      })
    : undefined
  return [colorTransform, waveReveal, orbMotion, ...(ringOverlay ? [ringOverlay] : [])]
}

export function splitLegacyCinematicGradePackLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'cinematic_grade_pack') return [layer]
  const effect = layer.effects as CinematicGradePackEffects
  const layers: RenderEffectLayer[] = [
    textureGradeLayer(
      layer,
      'texture_grade',
      { base_filter: effect.base_filter, color_grade: effect.color_grade },
      'Split from legacy cinematic_grade_pack: texture grade.',
    ),
  ]
  if (effect.bloom?.enabled) {
    layers.push(
      childLayer(layer, 'bloom', {
        layerKind: 'texture_grade',
        plugin_id: 'cinematic_texture_grade',
        preset: 'primitive_bloom_overlay',
        effects: { preset: 'primitive_bloom_overlay', bloom: effect.bloom },
        reason: 'Split from legacy cinematic_grade_pack: bloom overlay.',
      }),
    )
  }
  if (effect.chromatic_aberration?.enabled) {
    layers.push(
      childLayer(layer, 'chroma', {
        layerKind: 'texture_grade',
        plugin_id: 'cinematic_texture_grade',
        preset: 'primitive_chromatic_aberration_overlay',
        effects: {
          preset: 'primitive_chromatic_aberration_overlay',
          chromatic_aberration: effect.chromatic_aberration,
        },
        reason: 'Split from legacy cinematic_grade_pack: chromatic aberration overlay.',
      }),
    )
  }
  if (effect.vignette?.enabled) {
    layers.push(vignetteLayer(layer, effect.vignette, 'Split from legacy cinematic_grade_pack: vignette.'))
  }
  if (effect.grain?.enabled) {
    layers.push(grainLayer(layer, effect.grain, 'Split from legacy cinematic_grade_pack: grain.'))
  }
  if (effect.letterbox?.enabled) {
    layers.push(
      letterboxLayer(layer, effect.letterbox, 'Split from legacy cinematic_grade_pack: letterbox.'),
    )
  }
  return layers
}

export function splitLegacyCinematicLightSweepLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'cinematic_light_sweep') return [layer]
  const effect = layer.effects as CinematicLightSweepEffects
  const layers: RenderEffectLayer[] = [
    textureGradeLayer(
      layer,
      'texture_grade',
      { base_filter: effect.base_filter, color_grade: effect.color_grade },
      'Split from legacy cinematic_light_sweep: texture grade.',
    ),
    childLayer(layer, 'light_sweep', {
      layerKind: 'texture_grade',
      plugin_id: 'cinematic_texture_grade',
      preset: 'primitive_light_sweep_overlay',
      effects: { preset: 'primitive_light_sweep_overlay', sweep: effect.sweep },
      reason: 'Split from legacy cinematic_light_sweep: light sweep overlay.',
    }),
  ]
  if (effect.vignette?.enabled) {
    layers.push(vignetteLayer(layer, effect.vignette, 'Split from legacy cinematic_light_sweep: vignette.'))
  }
  if (effect.grain?.enabled) {
    layers.push(grainLayer(layer, effect.grain, 'Split from legacy cinematic_light_sweep: grain.'))
  }
  if (effect.letterbox?.enabled) {
    layers.push(
      letterboxLayer(layer, effect.letterbox, 'Split from legacy cinematic_light_sweep: letterbox.'),
    )
  }
  return layers
}

export function splitLegacyAudioReactiveLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'audio_reactive_cut_driver') return [layer]
  const effect = layer.effects as AudioReactiveCutDriverEffects
  const layers: RenderEffectLayer[] = []
  if (effect.base_filter) {
    layers.push(
      textureGradeLayer(
        layer,
        'base_filter',
        { base_filter: effect.base_filter },
        'Split from legacy audio_reactive_cut_driver: base filter.',
      ),
    )
  }
  layers.push(
    childLayer(layer, 'beat_pulse', {
      layerKind: 'audio_driver',
      plugin_id: 'beat_cut_driver',
      preset: 'primitive_beat_pulse',
      effects: {
        preset: 'primitive_beat_pulse',
        base_filter: effect.base_filter,
        beat_times: effect.beat_times,
        strong_beats: effect.strong_beats,
        energy_peaks: effect.energy_peaks,
        pulse: effect.pulse,
        shake: effect.shake,
      },
      reason: 'Split from legacy audio_reactive_cut_driver: beat pulse transform.',
    }),
  )
  if (effect.flash?.enabled) {
    layers.push(
      childLayer(layer, 'beat_flash', {
        layerKind: 'audio_driver',
        plugin_id: 'beat_cut_driver',
        preset: 'primitive_beat_flash_overlay',
        effects: {
          preset: 'primitive_beat_flash_overlay',
          strong_beats: effect.strong_beats,
          energy_peaks: effect.energy_peaks,
          flash: effect.flash,
        },
        reason: 'Split from legacy audio_reactive_cut_driver: beat flash overlay.',
      }),
    )
  }
  return layers
}

export function splitLegacyMaskSliceLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'mask_slice_transition') return [layer]
  const effect = layer.effects as MaskSliceTransitionEffects
  const layers: RenderEffectLayer[] = []
  if (effect.base_filter) {
    layers.push(
      textureGradeLayer(
        layer,
        'base_filter',
        { base_filter: effect.base_filter },
        'Split from legacy mask_slice_transition: base filter.',
      ),
    )
  }
  layers.push(
    childLayer(layer, 'slice_reveal', {
      layerKind: 'mask_reveal',
      plugin_id: 'layout_window_mask',
      preset: 'primitive_slice_reveal',
      effects: {
        preset: 'primitive_slice_reveal',
        start_sec: effect.start_sec,
        duration_sec: effect.duration_sec,
        slice_count: effect.slice_count,
        direction: effect.direction,
        mode: effect.mode,
        stagger_sec: effect.stagger_sec,
        slide_distance_pct: effect.slide_distance_pct,
        overlay_asset_id: effect.overlay_asset_id,
        slice_style: effect.slice_style,
      },
      reason: 'Split from legacy mask_slice_transition: slice reveal.',
    }),
  )
  return layers
}

export function splitLegacyRippleDisplacementLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'ripple_displacement') return [layer]
  const effect = layer.effects as RippleDisplacementEffects
  const layers: RenderEffectLayer[] = []
  if (effect.base_filter) {
    layers.push(
      textureGradeLayer(
        layer,
        'base_filter',
        { base_filter: effect.base_filter },
        'Split from legacy ripple_displacement: base filter.',
      ),
    )
  }
  layers.push(
    childLayer(layer, 'ripple_displacement', {
      layerKind: 'distortion',
      plugin_id: 'water_ripple_distortion_overlay',
      preset: 'primitive_ripple_displacement',
      effects: { preset: 'primitive_ripple_displacement', ripple: effect.ripple },
      reason: 'Split from legacy ripple_displacement: displacement layer.',
    }),
    childLayer(layer, 'ripple_ring', {
      layerKind: 'distortion',
      plugin_id: 'water_ripple_distortion_overlay',
      preset: 'primitive_ripple_ring_overlay',
      effects: {
        preset: 'primitive_ripple_ring_overlay',
        ripple: effect.ripple,
        lighting: effect.lighting,
      },
      reason: 'Split from legacy ripple_displacement: ripple ring overlay.',
    }),
  )
  return layers
}

export function splitLegacyEditorialCollageLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  if (layer.effects.preset !== 'editorial_split_collage') return [layer]
  const effect = layer.effects as EditorialSplitCollageEffects
  const layers: RenderEffectLayer[] = [
    textureGradeLayer(
      layer,
      'texture_grade',
      { base_filter: effect.base_filter, color_grade: effect.color_grade },
      'Split from legacy editorial_split_collage: texture grade.',
    ),
    childLayer(layer, 'collage_layout', {
      layerKind: 'layout',
      plugin_id: 'split_collage_layout',
      preset: 'primitive_collage_layout',
      effects: {
        preset: 'primitive_collage_layout',
        base_filter: effect.base_filter,
        color_grade: effect.color_grade,
        panels: effect.panels,
        panel_style: effect.panel_style,
      },
      reason: 'Split from legacy editorial_split_collage: collage layout.',
    }),
  ]
  if (effect.vignette?.enabled) {
    layers.push(vignetteLayer(layer, effect.vignette, 'Split from legacy editorial_split_collage: vignette.'))
  }
  if (effect.grain?.enabled) {
    layers.push(grainLayer(layer, effect.grain, 'Split from legacy editorial_split_collage: grain.'))
  }
  if (effect.letterbox?.enabled) {
    layers.push(
      letterboxLayer(layer, effect.letterbox, 'Split from legacy editorial_split_collage: letterbox.'),
    )
  }
  return layers
}

const SPLITTERS = [
  splitLegacyKineticColorRippleLayer,
  splitLegacyColorPortalLayer,
  splitLegacyCinematicGradePackLayer,
  splitLegacyCinematicLightSweepLayer,
  splitLegacyAudioReactiveLayer,
  splitLegacyMaskSliceLayer,
  splitLegacyRippleDisplacementLayer,
  splitLegacyEditorialCollageLayer,
] as const

export function splitEffectLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  let current = [layer]
  for (const split of SPLITTERS) {
    current = current.flatMap((item) => split(item))
  }
  return current
}

export function splitEffectLayers(layers: RenderEffectLayer[]): RenderEffectLayer[] {
  return layers.flatMap((layer) => splitEffectLayer(layer))
}

/** @deprecated use splitEffectLayer */
export function splitLegacyCompositeLayer(layer: RenderEffectLayer): RenderEffectLayer[] {
  return splitEffectLayer(layer)
}
