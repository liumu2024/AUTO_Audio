import type {
  MotifSharedGeometry,
  MotifSharedTimeline,
} from '../types/effect-roadmap.v1.js'
import type {
  RenderEffectLayer,
  RenderPlanComponentResolution,
  RenderPlanComponentResolutionDecision,
  SceneEffects,
} from '../types/render-plan.v1.js'

export interface EffectSharedParamRef {
  $shared: string
}

export interface EffectFollowRef {
  $follow: {
    sourceLayerId: string
    sourcePath: string
    mode: 'point_at_time'
  }
}

export interface SharedParamEntry {
  source_atom_id: string
  source_path: string
  value: unknown
}

export interface RuntimeFollowBinding {
  targetLayerId: string
  targetPath: string
  sourceLayerId: string
  sourcePath: string
  mode: 'point_at_time'
}

export interface EffectBindingWarning {
  scene_id: string
  layer_id: string
  binding: string
  reason: string
}

export interface SceneEffectBindingContext {
  sharedParams?: Record<string, SharedParamEntry>
  sharedTimeline?: MotifSharedTimeline
  sharedGeometry?: MotifSharedGeometry
  beatTimes?: number[]
  runtimeFollows?: RuntimeFollowBinding[]
  warnings?: EffectBindingWarning[]
}

export interface EffectBindingResolveInput {
  sceneId: string
  layers: RenderEffectLayer[]
  sharedParams?: Record<string, SharedParamEntry>
  sharedTimeline?: MotifSharedTimeline
  sharedGeometry?: MotifSharedGeometry
  beatTimes?: number[]
  sceneStartSec?: number
  sceneDurationSec?: number
}

export interface EffectBindingResolveResult {
  layers: RenderEffectLayer[]
  runtimeFollows: RuntimeFollowBinding[]
  warnings: EffectBindingWarning[]
}

const BINDING_PATH_ALIASES: Record<string, string> = {
  'mask.center_path': 'mask.position_keyframes',
  'ring.center_path': 'mask.position_keyframes',
  'ring.radius_pct_keyframes': 'mask.radius_pct_keyframes',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEffectSharedParamRef(value: unknown): value is EffectSharedParamRef {
  return isRecord(value) && typeof value.$shared === 'string'
}

export function isEffectFollowRef(value: unknown): value is EffectFollowRef {
  return isRecord(value) && isRecord(value.$follow) && typeof value.$follow.sourceLayerId === 'string'
}

function containsEffectBindingRef(value: unknown): boolean {
  if (isEffectSharedParamRef(value) || isEffectFollowRef(value)) return true
  if (Array.isArray(value)) return value.some(containsEffectBindingRef)
  if (!isRecord(value)) return false
  return Object.values(value).some(containsEffectBindingRef)
}

export function atomIdFromLayerId(layerId: string): string | null {
  const parts = layerId.split(':')
  return parts.length >= 2 ? parts[parts.length - 1]! : null
}

function normalizeArrayIndexPath(path: string): string {
  return path
    .replace(/\.(\d+)\./g, '[].')
    .replace(/\.(\d+)$/, '[]')
    .replace(/^(\w+)\[(\d+)\]\./, '$1[].')
}

export function resolveBindingPath(path: string): string {
  return BINDING_PATH_ALIASES[path] ?? path
}

function resolveTargetPath(path: string): string {
  return normalizeArrayIndexPath(resolveBindingPath(path))
}

function splitPath(path: string): string[] {
  return path.split('.').flatMap((segment) => {
    const arrayMatch = /^(.+)\[\]$/.exec(segment)
    if (arrayMatch) return [arrayMatch[1]!, '[]']
    return [segment]
  })
}

export function getAtPath(root: unknown, path: string): unknown {
  const segments = splitPath(resolveBindingPath(path))
  let current: unknown = root
  for (const segment of segments) {
    if (segment === '[]') {
      if (!Array.isArray(current) || current.length === 0) return undefined
      current = current[0]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const normalized = resolveBindingPath(path)
  const arrayItemMatch = /^(.+)\[\]\.(.+)$/.exec(normalized)
  if (arrayItemMatch) {
    const [, arrayKey, restPath] = arrayItemMatch
    let array = root[arrayKey!]
    if (!Array.isArray(array)) {
      array = []
      root[arrayKey!] = array
    }
    const items = array as unknown[]
    if (items.length === 0) items.push({})
    const item = items[0]
    if (!isRecord(item)) return
    if (!restPath!.includes('.')) {
      item[restPath!] = value
      return
    }
    setAtPath(item, restPath!, value)
    return
  }

  const segments = normalized.split('.')
  let current: Record<string, unknown> = root
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const isLast = index === segments.length - 1
    if (isLast) {
      current[segment] = value
      return
    }
    const existing = current[segment]
    if (Array.isArray(existing)) return
    if (!isRecord(existing)) current[segment] = {}
    current = current[segment] as Record<string, unknown>
  }
}

function deleteAtPath(root: Record<string, unknown>, path: string): void {
  const normalized = resolveBindingPath(path)
  const arrayItemMatch = /^(.+)\[\]\.(.+)$/.exec(normalized)
  if (arrayItemMatch) {
    const [, arrayKey, restPath] = arrayItemMatch
    const array = root[arrayKey!]
    if (!Array.isArray(array) || array.length === 0 || !isRecord(array[0])) return
    if (!restPath!.includes('.')) {
      delete array[0][restPath!]
      return
    }
    deleteAtPath(array[0], restPath!)
    return
  }

  const segments = normalized.split('.')
  let current: Record<string, unknown> = root
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const isLast = index === segments.length - 1
    if (isLast) {
      delete current[segment]
      return
    }
    const existing = current[segment]
    if (!isRecord(existing)) return
    current = existing
  }
}

function layerIndexByAtomId(layers: RenderEffectLayer[]): Map<string, RenderEffectLayer> {
  const map = new Map<string, RenderEffectLayer>()
  for (const layer of layers) {
    const atomId = atomIdFromLayerId(layer.id)
    if (atomId) map.set(atomId, layer)
  }
  return map
}

function cloneLayer(layer: RenderEffectLayer): RenderEffectLayer {
  return {
    ...layer,
    effects: structuredClone(layer.effects),
  }
}

export function interpolatePathAtTime(
  keyframes: Array<{ time: number; x_pct: number; y_pct: number }>,
  timeSec: number,
): { x_pct: number; y_pct: number } {
  if (keyframes.length === 0) {
    return { x_pct: 50, y_pct: 50 }
  }
  if (timeSec <= keyframes[0]!.time) {
    return { x_pct: keyframes[0]!.x_pct, y_pct: keyframes[0]!.y_pct }
  }
  const last = keyframes[keyframes.length - 1]!
  if (timeSec >= last.time) {
    return { x_pct: last.x_pct, y_pct: last.y_pct }
  }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const start = keyframes[index]!
    const end = keyframes[index + 1]!
    if (timeSec >= start.time && timeSec <= end.time) {
      const progress = (timeSec - start.time) / Math.max(0.001, end.time - start.time)
      return {
        x_pct: start.x_pct + (end.x_pct - start.x_pct) * progress,
        y_pct: start.y_pct + (end.y_pct - start.y_pct) * progress,
      }
    }
  }
  return { x_pct: last.x_pct, y_pct: last.y_pct }
}

export function interpolateRadiusAtTime(
  keyframes: Array<{ time: number; value: number }>,
  timeSec: number,
): number {
  if (keyframes.length === 0) return 0
  if (timeSec <= keyframes[0]!.time) return keyframes[0]!.value
  const last = keyframes[keyframes.length - 1]!
  if (timeSec >= last.time) return last.value
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const start = keyframes[index]!
    const end = keyframes[index + 1]!
    if (timeSec >= start.time && timeSec <= end.time) {
      const progress = (timeSec - start.time) / Math.max(0.001, end.time - start.time)
      return start.value + (end.value - start.value) * progress
    }
  }
  return last.value
}

function isPathKeyframes(value: unknown): value is Array<{ time: number; x_pct: number; y_pct: number }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    isRecord(value[0]) &&
    typeof value[0]!.time === 'number' &&
    typeof value[0]!.x_pct === 'number'
  )
}

function isRadiusKeyframes(value: unknown): value is Array<{ time: number; value: number }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    isRecord(value[0]) &&
    typeof value[0]!.time === 'number' &&
    typeof value[0]!.value === 'number'
  )
}

function parseBeatSyncIndex(sync: string): number | null {
  const match = /^strong_beat:(\d+)$/.exec(sync.trim())
  if (!match) return null
  return Number.parseInt(match[1]!, 10)
}

function applySharedGeometry(
  layers: RenderEffectLayer[],
  sharedGeometry?: MotifSharedGeometry,
): RenderEffectLayer[] {
  const origin = sharedGeometry?.origin
  if (!origin) return layers

  return layers.map((layer) => {
    const effects = structuredClone(layer.effects) as unknown as Record<string, unknown>
    const mask = effects.mask
    if (isRecord(mask) && Array.isArray(mask.position_keyframes) && mask.position_keyframes.length > 0) {
      mask.position_keyframes = [{ time: 0, x_pct: origin.x_pct, y_pct: origin.y_pct }]
    }
    const orb = effects.orb
    if (isRecord(orb) && Array.isArray(orb.path_keyframes) && orb.path_keyframes.length > 0) {
      orb.path_keyframes = [{ time: 0, x_pct: origin.x_pct, y_pct: origin.y_pct }]
    }
    return { ...layer, effects: effects as unknown as SceneEffects }
  })
}

function applySharedTimeline(
  layers: RenderEffectLayer[],
  sharedTimeline: MotifSharedTimeline | undefined,
  beatTimes: number[] | undefined,
  warnings: EffectBindingWarning[],
  sceneId: string,
): RenderEffectLayer[] {
  if (!sharedTimeline?.sync_points?.length) return layers

  return layers.map((layer) => {
    const effects = structuredClone(layer.effects) as unknown as Record<string, unknown>
    const revealEvents = effects.reveal_events
    if (!Array.isArray(revealEvents) || revealEvents.length === 0) return layer

    const atomId = atomIdFromLayerId(layer.id)
    for (const syncPoint of sharedTimeline.sync_points ?? []) {
      if (atomId && syncPoint.atom_ids?.length && !syncPoint.atom_ids.includes(atomId)) {
        continue
      }

      const beatIndex = parseBeatSyncIndex(syncPoint.sync)
      const triggerTime =
        beatIndex !== null && beatTimes?.[beatIndex] !== undefined
          ? beatTimes[beatIndex]!
          : syncPoint.at_sec

      if (triggerTime === undefined) {
        warnings.push({
          scene_id: sceneId,
          layer_id: layer.id,
          binding: `shared_timeline:${syncPoint.id}`,
          reason: `Unable to resolve sync "${syncPoint.sync}" to beat trigger time.`,
        })
        continue
      }

      for (const event of revealEvents) {
        if (!isRecord(event)) continue
        if (typeof event.trigger_time === 'number') {
          event.trigger_time = triggerTime
        }
      }
    }

    return { ...layer, effects: effects as unknown as SceneEffects }
  })
}

function resolveSharedRefValue(input: {
  entry: SharedParamEntry
  sourceLayer: RenderEffectLayer | undefined
  targetPath: string
  targetLayerId: string
  sceneId: string
  warnings: EffectBindingWarning[]
  runtimeFollows: RuntimeFollowBinding[]
}): unknown {
  const sourcePath = resolveBindingPath(input.entry.source_path)
  const liveValue = input.sourceLayer
    ? getAtPath(input.sourceLayer.effects, sourcePath)
    : undefined
  const value =
    liveValue === undefined || containsEffectBindingRef(liveValue)
      ? input.entry.value
      : liveValue

  if (sourcePath.endsWith('path_keyframes') && input.targetPath.includes('origin')) {
    if (!input.sourceLayer || !isPathKeyframes(value)) {
      input.warnings.push({
        scene_id: input.sceneId,
        layer_id: input.targetLayerId,
        binding: input.entry.source_path,
        reason: `Follow binding requires orb path keyframes on source layer ${input.entry.source_atom_id}.`,
      })
      return undefined
    }
    input.runtimeFollows.push({
      targetLayerId: input.targetLayerId,
      targetPath: resolveTargetPath(input.targetPath),
      sourceLayerId: input.sourceLayer.id,
      sourcePath,
      mode: 'point_at_time',
    })
    return undefined
  }

  if (isPathKeyframes(value)) {
    return structuredClone(value)
  }
  if (isRadiusKeyframes(value)) {
    return structuredClone(value)
  }

  if (value === undefined) {
    input.warnings.push({
      scene_id: input.sceneId,
      layer_id: input.targetLayerId,
      binding: input.entry.source_path,
      reason: `Shared binding source ${input.entry.source_atom_id}.${input.entry.source_path} is missing.`,
    })
  }

  return value === undefined ? undefined : structuredClone(value)
}

function walkAndResolveBindings(input: {
  node: unknown
  currentPath: string
  layer: RenderEffectLayer
  layersByAtom: Map<string, RenderEffectLayer>
  sharedParams: Record<string, SharedParamEntry>
  sceneId: string
  warnings: EffectBindingWarning[]
  runtimeFollows: RuntimeFollowBinding[]
}): unknown {
  if (isEffectSharedParamRef(input.node)) {
    const entry = input.sharedParams[input.node.$shared]
    if (!entry) {
      input.warnings.push({
        scene_id: input.sceneId,
        layer_id: input.layer.id,
        binding: input.node.$shared,
        reason: `Unknown shared param key "${input.node.$shared}".`,
      })
      return undefined
    }

    const sourceLayer = input.layersByAtom.get(entry.source_atom_id)
    if (!sourceLayer) {
      input.warnings.push({
        scene_id: input.sceneId,
        layer_id: input.layer.id,
        binding: input.node.$shared,
        reason: `Shared binding source atom "${entry.source_atom_id}" is not present in scene layers.`,
      })
      return undefined
    }

    return resolveSharedRefValue({
      entry,
      sourceLayer,
      targetPath: input.currentPath,
      targetLayerId: input.layer.id,
      sceneId: input.sceneId,
      warnings: input.warnings,
      runtimeFollows: input.runtimeFollows,
    })
  }

  if (isEffectFollowRef(input.node)) {
    input.runtimeFollows.push({
      targetLayerId: input.layer.id,
      targetPath: resolveTargetPath(input.currentPath),
      sourceLayerId: input.node.$follow.sourceLayerId,
      sourcePath: resolveBindingPath(input.node.$follow.sourcePath),
      mode: 'point_at_time',
    })
    return undefined
  }

  if (Array.isArray(input.node)) {
    return input.node.map((item, index) =>
      walkAndResolveBindings({
        ...input,
        node: item,
        currentPath: `${input.currentPath}[${index}]`,
      }),
    )
  }

  if (!isRecord(input.node)) return input.node

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.node)) {
    const childPath = input.currentPath ? `${input.currentPath}.${key}` : key
    const resolvedValue = walkAndResolveBindings({
      ...input,
      node: value,
      currentPath: childPath,
    })
    if (resolvedValue !== undefined) {
      resolved[key] = resolvedValue
    }
  }
  return resolved
}

export function resolveEffectLayerBindings(
  input: EffectBindingResolveInput,
): EffectBindingResolveResult {
  const warnings: EffectBindingWarning[] = []
  const runtimeFollows: RuntimeFollowBinding[] = []
  const sharedParams = input.sharedParams ?? {}

  let layers = input.layers.map(cloneLayer)
  layers = applySharedGeometry(layers, input.sharedGeometry)
  layers = applySharedTimeline(layers, input.sharedTimeline, input.beatTimes, warnings, input.sceneId)

  const layersByAtom = layerIndexByAtomId(layers)

  layers = layers.map((layer) => {
    const resolvedEffects = walkAndResolveBindings({
      node: layer.effects,
      currentPath: '',
      layer,
      layersByAtom,
      sharedParams,
      sceneId: input.sceneId,
      warnings,
      runtimeFollows,
    })

    if (!isRecord(resolvedEffects)) {
      warnings.push({
        scene_id: input.sceneId,
        layer_id: layer.id,
        binding: layer.effects.preset,
        reason: 'Effect binding resolution produced invalid effects object.',
      })
      return layer
    }

    return {
      ...layer,
      effects: resolvedEffects as unknown as SceneEffects,
    }
  })

  return { layers, runtimeFollows, warnings }
}

export function sampleBindingValueAtTime(input: {
  layers: RenderEffectLayer[]
  sourceLayerId: string
  sourcePath: string
  timeSec: number
}): unknown {
  const sourceLayer = input.layers.find((layer) => layer.id === input.sourceLayerId)
  if (!sourceLayer) return undefined

  const value = getAtPath(sourceLayer.effects, input.sourcePath)
  if (isPathKeyframes(value)) {
    return interpolatePathAtTime(value, input.timeSec)
  }
  if (isRadiusKeyframes(value)) {
    return interpolateRadiusAtTime(value, input.timeSec)
  }
  return value
}

export function sampleLayerEffectsAtTime(input: {
  layers: RenderEffectLayer[]
  runtimeFollows: RuntimeFollowBinding[]
  layerId: string
  timeSec: number
}): SceneEffects | undefined {
  const layer = input.layers.find((item) => item.id === input.layerId)
  if (!layer) return undefined

  const effects = structuredClone(layer.effects) as unknown as Record<string, unknown>
  const follows = input.runtimeFollows.filter((follow) => follow.targetLayerId === input.layerId)

  for (const follow of follows) {
    const sampled = sampleBindingValueAtTime({
      layers: input.layers,
      sourceLayerId: follow.sourceLayerId,
      sourcePath: follow.sourcePath,
      timeSec: input.timeSec,
    })

    if (!isRecord(sampled) || typeof sampled.x_pct !== 'number' || typeof sampled.y_pct !== 'number') {
      continue
    }

    setAtPath(effects, resolveTargetPath(follow.targetPath), {
      x_pct: sampled.x_pct,
      y_pct: sampled.y_pct,
    })
  }

  return effects as unknown as SceneEffects
}

export function sampleMaskCenterAtTime(
  effects: SceneEffects,
  timeSec: number,
): { x_pct: number; y_pct: number } | null {
  const mask = getAtPath(effects, 'mask.position_keyframes')
  if (!isPathKeyframes(mask)) return null
  return interpolatePathAtTime(mask, timeSec)
}

export function mergeBindingWarningsIntoComponentResolution(input: {
  componentResolution?: RenderPlanComponentResolution
  warnings: EffectBindingWarning[]
}): RenderPlanComponentResolution {
  const existing = input.componentResolution ?? {
    enabled: true,
    authoring_enabled: false,
    decisions: [],
  }

  const decisions: RenderPlanComponentResolutionDecision[] = [...existing.decisions]
  for (const warning of input.warnings) {
    decisions.push({
      capability_id: `effect_binding.${warning.binding}`,
      segment_ids: [warning.scene_id],
      decision: 'fallback',
      reason: `[runtime binding] ${warning.layer_id}: ${warning.reason}`,
    })
  }

  return {
    ...existing,
    enabled: true,
    decisions,
  }
}
