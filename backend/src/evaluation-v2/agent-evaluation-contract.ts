const MUTABLE_FIELDS = {
  scene: new Set([
    'type', 'start_sec', 'duration_sec', 'asset_id', 'fit', 'background', 'title', 'subtitle',
    'body', 'accent_color', 'motion', 'visual_role', 'creative_intent', 'note', 'custom_render',
  ]),
  overlay: new Set([
    'type', 'start_sec', 'end_sec', 'scene_id', 'track_id', 'text', 'asset_id', 'x_pct', 'y_pct',
    'width_pct', 'height_pct', 'max_lines', 'z_index', 'color', 'background', 'opacity', 'animation',
    'enter_animation', 'exit_animation',
  ]),
  transition: new Set(['type', 'duration_sec', 'direction', 'custom_render']),
  material_job: new Set([
    'type', 'status', 'prompt', 'input_asset_id', 'output_asset_id', 'fallback_asset_id',
    'fallback_kind', 'provider',
  ]),
  creative_brief: new Set(['direction', 'image_references', 'sample_methods', 'applied_preferences']),
} as const

export function validateAllowedMutationRules(value: unknown, label: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: allowedMutations must not be empty.`)
  for (const [index, rule] of value.entries()) {
    if (!rule || typeof rule !== 'object') throw new Error(`${label}: invalid allowedMutations[${index}].`)
    const record = rule as { object?: string; ids?: unknown; fields?: unknown }
    const allowedFields = MUTABLE_FIELDS[record.object as keyof typeof MUTABLE_FIELDS]
    if (!allowedFields) throw new Error(`${label}: unknown mutation object ${record.object ?? '<missing>'}.`)
    if (record.object === 'creative_brief') {
      if (record.ids !== undefined) throw new Error(`${label}: creative_brief mutation must not declare ids.`)
    } else if (!Array.isArray(record.ids) || record.ids.length === 0
      || record.ids.some((id) => typeof id !== 'string' || !id)) {
      throw new Error(`${label}: ${record.object} mutation needs non-empty ids.`)
    }
    if (!Array.isArray(record.fields) || record.fields.length === 0
      || record.fields.some((field) => typeof field !== 'string' || !allowedFields.has(field as never))) {
      throw new Error(`${label}: ${record.object} mutation contains an invalid or empty field list.`)
    }
    if (new Set(record.fields).size !== record.fields.length) {
      throw new Error(`${label}: ${record.object} mutation contains duplicate fields.`)
    }
  }
}
