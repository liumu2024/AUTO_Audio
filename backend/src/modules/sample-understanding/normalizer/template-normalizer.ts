import {
  coerceSequenceLayout,
  coerceSlotSource,
  coerceSlotType,
  coerceTransitionDirection,
  coerceTransitionOverlayType,
  coerceTransitionPresentation,
  coerceTransitionTimingType,
  coerceVisualMotionPreset,
  normalizeRenderRecipe,
} from './enum-coercion.js'
import {
  clampNumber,
  isRecord,
  normalizeId,
  normalizeLooseKey,
  numberFromRecord,
  stringFromRecord,
  type JsonRecord,
} from './json-utils.js'

function normalizeParsedCreativeIntent(value: unknown): unknown {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    return {
      raw_text: value.trim(),
      goal: 'generate_variant',
      product_or_topic: 'unknown',
      target_audience: 'unknown',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: value.trim(),
    }
  }
  return value
}

function normalizeSampleUnderstandingBlock(value: unknown): unknown {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    return {
      hook_formula: '',
      narrative_arc: '',
      conversion_logic: '',
      audience_trigger: '',
      reusable_pattern: value.trim(),
    }
  }
  return value
}

function normalizeSampleVideoRef(value: unknown): unknown {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    return { id: 'sample_video', name: value.trim() }
  }
  return value
}

function resolveTemplateStyle(
  value: JsonRecord,
  styleFeatures: JsonRecord,
  rootIntent?: JsonRecord,
): string {
  const direct = stringFromRecord(value, ['style', 'visual_style', 'style_summary'])
  if (direct) return direct

  const fromFeatures = [
    styleFeatures.visual_style,
    styleFeatures.pace,
    styleFeatures.transition,
    styleFeatures.bgm,
    styleFeatures.subtitle_style,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .join('；')

  if (fromFeatures) return fromFeatures

  const creativeIntent = isRecord(value.creative_intent)
    ? value.creative_intent
    : rootIntent
  const keywords = Array.isArray(creativeIntent?.style_keywords)
    ? creativeIntent.style_keywords.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []
  if (keywords.length) return keywords.join('、')

  const intentGoal =
    typeof creativeIntent?.goal === 'string' ? creativeIntent.goal.trim() : ''
  if (intentGoal) return intentGoal

  return '未标注风格'
}

function normalizeStyleFeatures(value: unknown): unknown {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    return { transition: value.trim() }
  }
  if (Array.isArray(value)) {
    return value.reduce<JsonRecord>((acc, item, index) => {
      if (typeof item === 'string' && item.trim()) {
        acc[`style_${index + 1}`] = item.trim()
        return acc
      }
      if (isRecord(item)) {
        for (const [key, itemValue] of Object.entries(item)) {
          if (typeof itemValue === 'string' && itemValue.trim()) {
            acc[key] = itemValue.trim()
          } else if (typeof itemValue === 'number' && Number.isFinite(itemValue)) {
            acc[key] = String(itemValue)
          }
        }
      }
      return acc
    }, {})
  }
  return value
}

function inferVisualMotionPreset(text: unknown): string {
  if (typeof text !== 'string') return 'static'
  const normalized = text.toLowerCase()
  if (/shake|handheld|抖|手持/.test(normalized)) return 'shake'
  if (/pan|平移|横移|扫过/.test(normalized)) return 'pan'
  if (/push|dolly|推进|推近/.test(normalized)) return 'push_in'
  if (/zoom|放大|拉近/.test(normalized)) return 'zoom_in'
  return 'static'
}

function normalizeSequenceSpec(segment: JsonRecord): JsonRecord {
  const start = numberFromRecord(segment, ['start']) ?? 0
  const end = numberFromRecord(segment, ['end']) ?? start + 1
  const duration = Math.max(0.1, end - start)
  const raw = isRecord(segment.sequence) ? segment.sequence : {}
  const layout =
    coerceSequenceLayout(raw.layout) ??
    coerceSequenceLayout(segment.layout) ??
    'fill'

  return {
    ...raw,
    from_sec: numberFromRecord(raw, ['from_sec', 'from', 'start_sec']) ?? start,
    duration_sec: numberFromRecord(raw, ['duration_sec', 'duration']) ?? duration,
    layout,
    premount_sec: clampNumber(
      numberFromRecord(raw, ['premount_sec', 'premount']),
      0,
      10,
      0.5,
    ),
  }
}

function normalizeVisualMotion(segment: JsonRecord): JsonRecord {
  const raw = isRecord(segment.visual_motion) ? segment.visual_motion : {}
  const preset =
    coerceVisualMotionPreset(raw.preset) ??
    coerceVisualMotionPreset(inferVisualMotionPreset(segment.motion)) ??
    'static'
  const defaultIntensity = preset === 'static' ? 0 : 0.45
  return {
    ...raw,
    preset,
    intensity: clampNumber(
      numberFromRecord(raw, ['intensity']),
      0,
      1,
      defaultIntensity,
    ),
    easing: typeof raw.easing === 'string' ? raw.easing : 'ease-out',
    driver: 'useCurrentFrame',
  }
}

function styleTransitionText(value: JsonRecord): string {
  const styleFeatures = isRecord(value.style_features) ? value.style_features : {}
  return [
    styleFeatures.transition,
    styleFeatures.transition_style,
    styleFeatures.transitions,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .join(' ')
}

function inferTransitionPresentation(text: string): string {
  const normalized = text.toLowerCase()
  if (/fade|dissolve|cross.?fade|溶|淡|叠化/.test(normalized)) return 'fade'
  if (/slide|push|滑|推/.test(normalized)) return 'slide'
  if (/wipe|swipe|擦|划/.test(normalized)) return 'wipe'
  if (/flip|翻/.test(normalized)) return 'flip'
  if (/clock|radial|时钟/.test(normalized)) return 'clock_wipe'
  return 'cut'
}

/** cut 必须 0；非 cut 若模型写 0 则给默认转场时长（与 schema superRefine 一致） */
function resolveTransitionDurationSec(
  presentation: string,
  rawDuration: number | undefined,
): number {
  if (presentation === 'cut') return 0
  if (rawDuration === undefined || rawDuration <= 0) return 0.3
  return rawDuration
}

function finalizeTransitionRecord(transition: JsonRecord): JsonRecord {
  const presentation =
    typeof transition.presentation === 'string' ? transition.presentation : 'cut'
  const duration_sec = resolveTransitionDurationSec(
    presentation,
    typeof transition.duration_sec === 'number'
      ? transition.duration_sec
      : undefined,
  )
  return {
    ...transition,
    duration_sec,
  }
}

function normalizeSlotCandidate(slot: JsonRecord, index: number): JsonRecord {
  const type = coerceSlotType(slot.type) ?? 'video'
  const source = coerceSlotSource(slot.source) ?? 'reference_material'
  const accepted = Array.isArray(slot.accepted_material_types)
    ? slot.accepted_material_types
        .map((item) => coerceSlotType(item))
        .filter((item): item is NonNullable<ReturnType<typeof coerceSlotType>> =>
          Boolean(item),
        )
    : undefined

  return {
    ...slot,
    id: normalizeId(slot.id, `slot_${String(index + 1).padStart(3, '0')}`),
    type,
    source,
    required: typeof slot.required === 'boolean' ? slot.required : true,
    ...(accepted?.length ? { accepted_material_types: accepted } : {}),
  }
}

function normalizeTransitionCandidate(
  transition: JsonRecord,
  index: number,
  structure: JsonRecord[],
): JsonRecord {
  const previous = structure[index]
  const next = structure[index + 1]
  const fromSegmentId =
    stringFromRecord(transition, [
      'from_segment_id',
      'fromSegmentId',
      'from',
      'from_id',
      'from_anchor_id',
    ]) ?? stringFromRecord(previous ?? {}, ['id'])
  const toSegmentId =
    stringFromRecord(transition, [
      'to_segment_id',
      'toSegmentId',
      'to',
      'to_id',
      'to_anchor_id',
    ]) ?? stringFromRecord(next ?? {}, ['id'])
  const atSec =
    numberFromRecord(transition, ['at_sec', 'at', 'cut_sec', 'boundary_sec']) ??
    numberFromRecord(previous ?? {}, ['end']) ??
    0
  const presentation =
    coerceTransitionPresentation(
      transition.presentation ??
        transition.type ??
        transition.kind ??
        transition.effect,
    ) ?? 'cut'
  const durationSec = resolveTransitionDurationSec(
    presentation,
    numberFromRecord(transition, ['duration_sec', 'duration', 'duration_s']),
  )
  const direction = coerceTransitionDirection(transition.direction, presentation)

  const rawTiming = isRecord(transition.timing) ? transition.timing : {}
  const timingType =
    coerceTransitionTimingType(rawTiming.type ?? transition.timing) ?? 'linear'
  const rawOverlay = isRecord(transition.overlay) ? transition.overlay : {}
  const overlayType =
    coerceTransitionOverlayType(rawOverlay.type) ?? 'none'
  const overlayIntensity = clampNumber(
    numberFromRecord(rawOverlay, ['intensity']),
    0,
    1,
    0.5,
  )

  const normalized: JsonRecord = {
    ...transition,
    id: normalizeId(transition.id, `tr_${String(index + 1).padStart(3, '0')}`),
    from_segment_id: fromSegmentId,
    to_segment_id: toSegmentId,
    at_sec: atSec,
    presentation,
    duration_sec: durationSec,
    timing: {
      ...rawTiming,
      type: timingType,
    },
    overlay: {
      ...rawOverlay,
      type: overlayType,
      ...(rawOverlay.intensity !== undefined ? { intensity: overlayIntensity } : {}),
    },
  }
  delete normalized.direction
  if (direction !== undefined) normalized.direction = direction
  return normalized
}

function buildDefaultTransitions(
  structure: JsonRecord[],
  transitionText: string,
): JsonRecord[] {
  if (structure.length < 2) return []
  const presentation = inferTransitionPresentation(transitionText)
  const durationSec = presentation === 'cut' ? 0 : 0.3

  return structure.slice(0, -1).map((segment, index) => {
    const next = structure[index + 1]
    return {
      id: `tr_${String(index + 1).padStart(3, '0')}`,
      from_segment_id: stringFromRecord(segment, ['id']) ?? `seg_${index + 1}`,
      to_segment_id:
        stringFromRecord(next, ['id']) ?? `seg_${String(index + 2).padStart(3, '0')}`,
      at_sec: numberFromRecord(segment, ['end']) ?? index + 1,
      presentation,
      duration_sec: durationSec,
      timing: { type: 'linear' },
      overlay: { type: 'none' },
      reason: transitionText || '默认相邻片段切换',
    }
  })
}

function normalizeViralPoints(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item, index) => {
    if (typeof item === 'string') {
      return { time: index, type: 'hook_punchline', reason: item }
    }
    return item
  })
}

/**
 * 导演模板层归一化：结构、槽位、转场、render_recipe 等可执行字段。
 */
export function normalizeTemplateCandidate(
  value: unknown,
  context: { intent?: JsonRecord } = {},
): unknown {
  if (!isRecord(value)) return value

  const slotsInput = Array.isArray(value.slots) ? value.slots : []
  const normalizedSlots = slotsInput
    .filter(isRecord)
    .map((slot, index) => normalizeSlotCandidate(slot, index))

  const slotIdByName = new Map<string, string>()
  for (const slot of normalizedSlots) {
    if (typeof slot.id !== 'string') continue
    const names = [slot.name, slot.label, slot.description]
    for (const name of names) {
      if (typeof name === 'string' && name.trim()) {
        slotIdByName.set(name.trim(), slot.id)
        slotIdByName.set(normalizeLooseKey(name), slot.id)
      }
    }
  }

  const structureInput = Array.isArray(value.structure) ? value.structure : []
  const normalizedStructure = structureInput.map((segment, index) => {
    if (!isRecord(segment)) return segment
    const rawSlot = segment.slot
    const slot = (() => {
      if (typeof rawSlot !== 'string') return rawSlot
      const exact = slotIdByName.get(rawSlot.trim())
      if (exact) return exact
      const loose = slotIdByName.get(normalizeLooseKey(rawSlot))
      if (loose) return loose
      const sameIndexSlot = normalizedSlots[index]
      if (isRecord(sameIndexSlot) && typeof sameIndexSlot.id === 'string') {
        return sameIndexSlot.id
      }
      return rawSlot
    })()
    const start = Math.max(0, numberFromRecord(segment, ['start']) ?? 0)
    const end = Math.max(start + 0.1, numberFromRecord(segment, ['end']) ?? start + 1)
    return {
      ...segment,
      id: normalizeId(segment.id, `seg_${String(index + 1).padStart(3, '0')}`),
      start,
      end,
      sequence: normalizeSequenceSpec({ ...segment, start, end }),
      visual_motion: normalizeVisualMotion(segment),
      slot: typeof slot === 'number' && Number.isFinite(slot) ? String(slot) : slot,
    }
  })

  const normalizedStyleFeaturesRaw = normalizeStyleFeatures(value.style_features)
  const normalizedStyleFeatures = isRecord(normalizedStyleFeaturesRaw)
    ? normalizedStyleFeaturesRaw
    : {}
  const normalizedStructureRecords = normalizedStructure.filter(isRecord)
  const transitionInput = Array.isArray(value.transitions) ? value.transitions : []
  const normalizedTransitionInput = transitionInput
    .filter(isRecord)
    .map((transition, index) =>
      normalizeTransitionCandidate(transition, index, normalizedStructureRecords),
    )
  const normalizedTransitions = (
    normalizedTransitionInput.length
      ? normalizedTransitionInput
      : buildDefaultTransitions(
          normalizedStructureRecords,
          styleTransitionText({ style_features: normalizedStyleFeatures }),
        )
  ).map((transition) =>
    isRecord(transition) ? finalizeTransitionRecord(transition) : transition,
  )

  const renderRecipe = normalizeRenderRecipe(value.render_recipe)

  const durationFromStructure = normalizedStructureRecords.reduce(
    (max, segment) => Math.max(max, numberFromRecord(segment, ['end']) ?? 0),
    0,
  )

  return {
    ...value,
    schema_version: '1.0',
    id: normalizeId(value.id, 'template_default'),
    title:
      stringFromRecord(value, ['title', 'name']) ?? '未命名模板',
    duration:
      numberFromRecord(value, ['duration', 'duration_sec']) ??
      (durationFromStructure > 0 ? durationFromStructure : 1),
    style: resolveTemplateStyle(value, normalizedStyleFeatures, context.intent),
    sample_video: normalizeSampleVideoRef(value.sample_video),
    creative_intent: normalizeParsedCreativeIntent(value.creative_intent),
    sample_understanding: normalizeSampleUnderstandingBlock(value.sample_understanding),
    style_features: normalizedStyleFeatures,
    viral_points: normalizeViralPoints(value.viral_points),
    slots: normalizedSlots,
    structure: normalizedStructure,
    transitions: normalizedTransitions,
    ...(renderRecipe ? { render_recipe: renderRecipe } : {}),
  }
}
