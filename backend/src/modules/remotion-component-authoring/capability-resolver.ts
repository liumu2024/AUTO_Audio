import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { env } from '../../config/env.js'
import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import { createDefaultEffect } from '../../../../shared/lib/effect-registry.js'
import {
  getRenderPluginManifest,
  pluginIdForPreset,
} from '../../../../shared/lib/render-plugin-manifest.js'
import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import {
  hydrateSeedPluginManifest,
  inferFallbackPresetFromSeedManifest,
  resolveSeedManifestLayerKind,
} from '../../../../shared/lib/seed-manifest-bridge.js'
import type { EffectRoadmap } from '../../../../shared/types/effect-roadmap.v1.js'
import type {
  GeneratedComponentEffects,
  RenderEffectLayer,
  RenderPlanComponentResolution,
  RenderPlanComponentResolutionDecision,
  RenderPlanV1,
  SceneEffects,
} from '../../../../shared/types/render-plan.v1.js'
import type {
  MappingDecisionsSeedArtifact,
  SeedMappingDecision,
} from '../effect-roadmap/seed-plugin-mapper.js'
import { remotionComponentAuthoringTaskDir } from '../effect-debug-artifacts/paths.js'
import { artifactRefForPath, recordAgentTraceEvent } from '../agent-trace/writer.js'
import {
  BUILTIN_FALLBACK_PRESET,
  fallbackPresetForLayer,
  normalizeGeneratedComponentManifest,
  normalizeLayerKind,
  readBuiltinComponentManifests,
  readGeneratedComponentManifests,
  type ComponentGapReport,
  type ComponentRetrievalResult,
  type GeneratedComponentManifest,
} from './component-knowledge.js'
import {
  createComponentCapabilityToolset,
  validateComponentEffect,
  type ComponentEffectValidationContract,
} from './component-capability-toolkit.js'
import {
  COMPONENT_AUTHORING_SKILL,
  evaluateComponentAuthoringGate,
} from './component-authoring-skill.js'

interface AuthoringOutput {
  component_tsx: string
  manifest: GeneratedComponentManifest
  sample_props: Record<string, unknown>
  acceptance_checklist: Record<string, unknown>
}

interface AuthoringModelParseInfo {
  parsed: boolean
  source: 'direct_json' | 'response_output_text' | 'unparsed'
  reason?: string
  output_text_chars?: number
}

interface AuthoringModelResponse {
  raw: string
  parsed?: AuthoringOutput
  parse: AuthoringModelParseInfo
}

interface NormalizedAuthoringOutput {
  output: AuthoringOutput
  usedFallbackTemplate: boolean
  fallbackReason?: string
}

interface ResolveRenderCapabilitiesInput {
  taskId: string
  structure: MigrationProtocolV12
}

interface ResolveRenderCapabilitiesOutput {
  structure: MigrationProtocolV12
  componentResolution: RenderPlanComponentResolution
}

const COMPONENT_SOURCE_FILE = 'component.tsx'
const ALLOWED_IMPORTS = new Set(['react', 'remotion', '../../component-registry'])
const FORBIDDEN_SOURCE_PATTERNS = [
  /\b(?:eval|Function|require)\s*\(/,
  /\bprocess\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bimport\s*\(/,
  /\bfrom\s+['"](?:node:|fs|path|child_process|http|https|os|crypto)/,
  /\bwhile\s*\(/,
  /\bfor\s*\(\s*;\s*;\s*\)/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bdocument\b/,
  /\bwindow\b/,
]
const MAX_GENERATED_SOURCE_CHARS = 18_000

function resolveFromBackendCwd(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'generated_component'
}

function resolveComponentSourcePath(componentDir: string, directoryName: string): string | undefined {
  const canonical = path.join(componentDir, COMPONENT_SOURCE_FILE)
  if (existsSync(canonical)) return canonical
  const legacy = path.join(componentDir, `${directoryName}.tsx`)
  if (existsSync(legacy)) return legacy
  return undefined
}

function pascalCase(value: string): string {
  return safeId(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'GeneratedComponent'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractGrounding(
  structure: MigrationProtocolV12,
): DirectorGroundingResult | undefined {
  const value = structure.director_grounding
  if (!isRecord(value) || value.schema_version !== 'director_grounding.v1') {
    return undefined
  }
  return value as unknown as DirectorGroundingResult
}

async function writeJson(dir: string, fileName: string, payload: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await recordComponentArtifact(dir, filePath, fileName)
}

async function writeText(dir: string, fileName: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  await writeFile(filePath, content, 'utf8')
  await recordComponentArtifact(dir, filePath, fileName)
}

function taskDebugDir(taskId: string): string {
  return remotionComponentAuthoringTaskDir(taskId)
}

function taskIdFromComponentDebugDir(dir: string): string | undefined {
  const normalized = path.resolve(dir).split(path.sep)
  const artifactsIndex = normalized.lastIndexOf('artifacts')
  if (artifactsIndex > 0) return normalized[artifactsIndex - 1]
  return undefined
}

async function recordComponentArtifact(
  dir: string,
  filePath: string,
  fileName: string,
): Promise<void> {
  const taskId = taskIdFromComponentDebugDir(dir)
  if (!taskId) return
  const artifact = await artifactRefForPath({
    taskId,
    path: filePath,
    label: fileName,
  })
  await recordAgentTraceEvent({
    taskId,
    phase: 'component_authoring',
    actor: fileName.includes('llm-output') || fileName.includes('authoring-prompt')
      ? 'llm'
      : 'tool',
    event: 'artifact',
    status: 'success',
    summary: `Component authoring artifact written: ${fileName}`,
    artifactRefs: [artifact],
    data: { file_name: fileName },
  })
}

function remotionRoot(): string {
  return resolveFromBackendCwd(env.remotionRoot)
}

function generatedComponentsDir(): string {
  return path.join(remotionRoot(), 'src', 'generated-components')
}

function inferCapabilityLayerKind(input: {
  capabilityText: string
  contract: Record<string, unknown>
}): CapabilityLayerKind {
  const fromContract =
    normalizeLayerKind(input.contract.layer_kind) ??
    normalizeLayerKind(input.contract.layerKind) ??
    normalizeLayerKind(input.contract.layer) ??
    normalizeLayerKind(input.contract.target_layer) ??
    normalizeLayerKind(input.contract.targetLayer) ??
    normalizeLayerKind(input.contract.mechanism)
  if (fromContract) return fromContract

  const lowered = input.capabilityText.toLowerCase()
  if (isOverlayCapability(input.capabilityText)) return 'overlay'
  if (/orb|ball|sphere|light\s*dot|\u5149\u7403|\u5c0f\u7403|\u7403/.test(lowered)) {
    return 'motion_driver'
  }
  if (/ripple|wave|distortion|\u6c34\u6ce2|\u6ce2\u7eb9|\u6d9f\u6f2a/.test(lowered)) {
    return 'distortion'
  }
  if (/portal|reveal|mask|window|wipe|\u5f00\u7a97|\u906e\u7f69|\u63ed\u793a|\u7070\u53d8\u5f69/.test(lowered)) {
    return 'mask_reveal'
  }
  if (/split|collage|panel|layout|\u5206\u5c4f|\u62fc\u8d34|\u753b\u4e2d\u753b/.test(lowered)) {
    return 'layout'
  }
  if (/beat|audio|music|rms|\u8282\u62cd|\u9f13\u70b9|\u5361\u70b9/.test(lowered)) {
    return 'audio_driver'
  }
  if (/gray|grayscale|black.?white|color unlock|\u9ed1\u767d|\u7070\u5ea6|\u8f6c\u5f69/.test(lowered)) {
    return 'color_transform'
  }
  if (/grade|grain|vignette|cinematic|film|\u8c03\u8272|\u80f6\u7247|\u7535\u5f71/.test(lowered)) {
    return 'texture_grade'
  }
  return 'composite'
}

function isOverlayCapability(capabilityText: string): boolean {
  const lowered = capabilityText.toLowerCase()
  return [
    'overlay',
    'label',
    'caption',
    'subtitle',
    'text',
    'sticker',
    'color square',
    '鑹插潡',
    '鏍囩',
    '鏂囧瓧',
    '瀛楀箷',
    '鑺卞瓧',
  ].some((keyword) => lowered.includes(keyword))
}

type OverlayCapabilitySubtype = 'watermark' | 'color_label' | 'caption'

function overlayCapabilitySubtype(capabilityText: string): OverlayCapabilitySubtype {
  const lowered = capabilityText.toLowerCase()
  if (
    [
      'watermark',
      'signature',
      'logo',
      'credit',
      '\u6c34\u5370',
      '\u7b7e\u540d',
      '\u7f72\u540d',
    ].some((keyword) => lowered.includes(keyword))
  ) {
    return 'watermark'
  }
  if (
    [
      'color square',
      'color label',
      'label chip',
      '\u8272\u5757',
      '\u989c\u8272\u6807\u7b7e',
    ].some((keyword) => lowered.includes(keyword))
  ) {
    return 'color_label'
  }
  return 'caption'
}

function extractSegmentIds(
  capability: DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number],
  structure: MigrationProtocolV12,
): string[] {
  const contract = capability.suggested_contract
  const candidates = [
    contract.segment_ids,
    contract.target_segment_ids,
    contract.segments,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const ids = candidate.filter((item): item is string => typeof item === 'string')
      if (ids.length) return ids
    }
  }
  if (typeof contract.segment_id === 'string') return [contract.segment_id]
  return structure.semantic_anchors[0]?.anchor_id ? [structure.semantic_anchors[0].anchor_id] : []
}

function buildComponentProps(
  capability: DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number],
  segmentIds: string[],
  layerKind: CapabilityLayerKind,
): Record<string, unknown> {
  const contract = capability.suggested_contract
  const params = isRecord(contract.params) ? contract.params : {}
  const capabilityText = `${capability.id} ${capability.description} ${JSON.stringify(contract)}`
  return {
    capability_id: capability.id,
    description: capability.description,
    segment_ids: segmentIds,
    target_layer: contract.target_layer ?? (isOverlayCapability(capabilityText) ? 'overlay' : 'effect'),
    layer_kind: layerKind,
    overlay_subtype: overlayCapabilitySubtype(capabilityText),
    origin: isRecord(contract.origin) ? contract.origin : { x_pct: 50, y_pct: 50 },
    direction: isRecord(contract.direction) ? contract.direction : { x: 1, y: 0 },
    color_hex:
      typeof contract.color_hex === 'string'
        ? contract.color_hex
        : typeof params.color_hex === 'string'
          ? params.color_hex
          : '#ffffff',
    text_content:
      typeof contract.text_content === 'string'
        ? contract.text_content
        : typeof params.text_content === 'string'
          ? params.text_content
          : typeof contract.content === 'string'
            ? contract.content
            : typeof params.content === 'string'
              ? params.content
              : typeof contract.content_text === 'string'
                ? contract.content_text
                : typeof params.content_text === 'string'
                  ? params.content_text
                  : typeof contract.text === 'string'
                    ? contract.text
                    : typeof params.text === 'string'
                      ? params.text
                      : '',
    opacity:
      typeof contract.opacity === 'number'
        ? contract.opacity
        : typeof params.opacity === 'number'
          ? params.opacity
          : undefined,
    bottom_padding_px:
      typeof contract.bottom_padding_px === 'number'
        ? contract.bottom_padding_px
        : typeof params.bottom_padding_px === 'number'
          ? params.bottom_padding_px
          : undefined,
    position_x:
      typeof contract.position_x === 'number'
        ? contract.position_x
        : typeof params.position_x === 'number'
          ? params.position_x
          : 0.5,
    position_y:
      typeof contract.position_y === 'number'
        ? contract.position_y
        : typeof params.position_y === 'number'
          ? params.position_y
          : 0.45,
    display_duration_before_unlock:
      typeof contract.display_duration_before_unlock === 'number'
        ? contract.display_duration_before_unlock
        : typeof params.display_duration_before_unlock === 'number'
          ? params.display_duration_before_unlock
          : 1.2,
    wave_count: typeof contract.wave_count === 'number' ? contract.wave_count : 4,
    color_reveal: typeof contract.color_reveal === 'number' ? contract.color_reveal : 0.72,
    chromatic_aberration_px:
      typeof contract.chromatic_aberration_px === 'number'
        ? contract.chromatic_aberration_px
        : 2,
    duration_sec: typeof contract.duration_sec === 'number' ? contract.duration_sec : 1.2,
    intensity: typeof contract.intensity === 'number' ? contract.intensity : 0.65,
    raw_contract: contract,
  }
}

function ensureSceneEffectRecipe(
  structure: MigrationProtocolV12,
  segmentIds: string[],
  preset: SceneEffects['preset'],
  extraParams?: Record<string, unknown>,
): MigrationProtocolV12 {
  if (preset === 'generated_component') return structure
  const renderRecipe = structure.render_recipe ?? {}
  const existing = renderRecipe.scene_effects ?? []
  const existingIds = new Set(existing.map((item) => item.segment_id))
  const additions = segmentIds
    .filter((segmentId) => !existingIds.has(segmentId))
    .map((segmentId) => ({
      segment_id: segmentId,
      preset,
      params: {
        injected_by: 'remotion_component_capability_resolver',
        ...(extraParams ?? {}),
      },
    }))

  if (!additions.length) return structure

  return {
    ...structure,
    render_recipe: {
      ...renderRecipe,
      scene_effects: [...existing, ...additions],
    },
  }
}

function authoringPrompt(input: {
  componentId: string
  capability: DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number]
  segmentIds: string[]
  layerKind: CapabilityLayerKind
  componentProps: Record<string, unknown>
  fallbackPreset: string
  seedProposal?: {
    plugin_id: string
    plugin_family: string
    manifest: Record<string, unknown>
    component_summary?: string
    must_match: Record<string, unknown>
    can_adapt: string[]
  }
}): string {
  const seedLines = input.seedProposal
    ? [
        '',
        'Seed plugin proposal context (implement this dedicated plugin, not a generic primitive stub):',
        `seed_plugin_id=${input.seedProposal.plugin_id}`,
        `seed_plugin_family=${input.seedProposal.plugin_family}`,
        `seed_component_summary=${input.seedProposal.component_summary ?? ''}`,
        `seed_must_match=${JSON.stringify(input.seedProposal.must_match, null, 2)}`,
        `seed_can_adapt=${JSON.stringify(input.seedProposal.can_adapt, null, 2)}`,
        `seed_manifest=${JSON.stringify(input.seedProposal.manifest, null, 2)}`,
      ]
    : []

  return [
    'You are writing ONE safe Remotion visual component for an AI video editor.',
    'Return ONLY JSON. No Markdown. No code fences.',
    'The JSON shape must be:',
    '{"component_tsx": string, "manifest": object, "sample_props": object, "acceptance_checklist": object}',
    '',
    'Hard rules:',
    '- The TSX file must import only from "remotion" and type-only from "../../component-registry".',
    '- No npm dependencies. No package.json changes. No dynamic import. No fetch/WebSocket/storage/process/eval/Function/require.',
    '- Export exactly one default function: `export default function ComponentName(props: GeneratedComponentRenderProps) { ... }`.',
    '- Do not use React.FC, React imports, type aliases for the component function, or anonymous default exports.',
    '- Use props.src, props.assetType, props.visual, props.effects.props and props.scene only.',
    '- Treat `props.effects.props` as unknown-safe data: first assign `const effectProps = props.effects.props as Record<string, unknown>`, then narrow every numeric/object prop with typeof checks before using it.',
    '- Remotion `interpolate` options must use valid strings such as `extrapolateLeft: "clamp"` and `extrapolateRight: "clamp"`; never use numeric extrapolate values.',
    '- Do not destructure `props.effects.props` directly, because its fields are typed as unknown under strict TypeScript.',
    '- The component must render video/image media full-frame and add the requested visual effect with CSS/SVG/Remotion primitives.',
    `- Generate exactly ONE layer-kind behavior: ${input.layerKind}. Do not combine unrelated layout/text/audio/mask/distortion responsibilities.`,
    '- Keep text overlays out of the component; overlays are handled elsewhere.',
    '- component_tsx is persisted as component.tsx alongside manifest.json, sample-props.json, acceptance-checklist.json.',
    '',
    `component_id=${input.componentId}`,
    `fallback_preset=${input.fallbackPreset}`,
    `layer_kind=${input.layerKind}`,
    `target_segment_ids=${JSON.stringify(input.segmentIds)}`,
    `capability=${JSON.stringify(input.capability, null, 2)}`,
    `required_component_props=${JSON.stringify(input.componentProps, null, 2)}`,
    ...seedLines,
    '',
    'manifest requirements:',
    `- id must be "${input.componentId}".`,
    '- status must be "verified" only if the component code is intended to validate.',
    '- include capabilities[], visual_grammar[], supported_asset_types[], props_contract, fallback_preset.',
    `- include target_layer="effect" and layer_kind="${input.layerKind}".`,
  ].join('\n')
}

function repairPrompt(input: {
  componentId: string
  originalPrompt: string
  previousOutput: AuthoringOutput
  validation: Record<string, unknown>
}): string {
  return [
    'Repair the generated Remotion component JSON so it passes validation.',
    'Return ONLY JSON. No Markdown. No code fences.',
    'Keep the same JSON shape: {"component_tsx": string, "manifest": object, "sample_props": object, "acceptance_checklist": object}.',
    'Repair rules:',
    '- The component must be `export default function ComponentName(props: GeneratedComponentRenderProps) { ... }`.',
    '- Do not use React.FC or React imports.',
    '- Read `props.effects.props` through `const effectProps = props.effects.props as Record<string, unknown>` and narrow every field before arithmetic.',
    '- Use `extrapolateLeft: "clamp"` / `extrapolateRight: "clamp"` for Remotion interpolate options.',
    `component_id=${input.componentId}`,
    `validation_failure=${JSON.stringify(input.validation, null, 2)}`,
    `original_authoring_prompt=${input.originalPrompt}`,
    `previous_json=${JSON.stringify(input.previousOutput, null, 2)}`,
  ].join('\n\n')
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

function parseJsonDocument(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isAuthoringOutput(value: unknown): value is AuthoringOutput {
  return (
    isRecord(value) &&
    typeof value.component_tsx === 'string' &&
    value.component_tsx.trim().length > 0 &&
    isRecord(value.manifest)
  )
}

function extractTextCandidate(candidate: unknown): string {
  if (typeof candidate === 'string') return candidate
  if (Array.isArray(candidate)) {
    return candidate.map((item) => extractTextCandidate(item)).filter(Boolean).join('\n')
  }
  if (!isRecord(candidate)) return ''
  for (const field of [candidate.output_text, candidate.text, candidate.content]) {
    if (typeof field === 'string') return field
  }
  if (Array.isArray(candidate.content)) return extractTextCandidate(candidate.content)
  if (Array.isArray(candidate.output)) return extractTextCandidate(candidate.output)
  return ''
}

function extractAuthoringOutput(raw: string): {
  parsed?: AuthoringOutput
  parse: AuthoringModelParseInfo
} {
  const directJson = parseJsonDocument(raw) ?? parseJsonFromText(raw)
  if (isAuthoringOutput(directJson)) {
    return {
      parsed: directJson,
      parse: { parsed: true, source: 'direct_json' },
    }
  }

  const outputText = extractTextCandidate(directJson)
  if (outputText.trim()) {
    const fromOutputText = parseJsonFromText(outputText)
    if (isAuthoringOutput(fromOutputText)) {
      return {
        parsed: fromOutputText,
        parse: {
          parsed: true,
          source: 'response_output_text',
          output_text_chars: outputText.length,
        },
      }
    }
    return {
      parse: {
        parsed: false,
        source: 'unparsed',
        reason: 'Responses output_text was present but did not contain a valid authoring JSON object.',
        output_text_chars: outputText.length,
      },
    }
  }

  return {
    parse: {
      parsed: false,
      source: 'unparsed',
      reason: 'No direct authoring JSON or Responses output_text was found.',
    },
  }
}

async function callAuthoringModel(prompt: string): Promise<AuthoringModelResponse> {
  if (!env.videoUnderstandingApiKey) {
    throw new Error('VIDEO_UNDERSTANDING_API_KEY is required for component authoring.')
  }

  const payload = {
    model: env.videoUnderstandingModel,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
  }

  const response = await fetch(env.videoUnderstandingResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.videoUnderstandingApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Component authoring model returned ${response.status}: ${raw.slice(0, 800)}`)
  }

  const extracted = extractAuthoringOutput(raw)
  return { raw, ...extracted }
}

function fallbackAuthoringOutput(input: {
  componentId: string
  capability: DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number]
  layerKind: CapabilityLayerKind
  componentProps: Record<string, unknown>
  fallbackPreset: SceneEffects['preset']
}): AuthoringOutput {
  const componentName = pascalCase(input.componentId)
  return {
    component_tsx: `// Auto-generated Remotion visual component for a missing Director Grounding capability.
import { AbsoluteFill, Img, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import type { GeneratedComponentRenderProps } from '../../component-registry'

export default function ${componentName}(props: GeneratedComponentRenderProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const effectProps = props.effects.props as Record<string, unknown>
  const durationSec = typeof effectProps.duration_sec === 'number' ? effectProps.duration_sec : 1.2
  const intensity = typeof effectProps.intensity === 'number' ? effectProps.intensity : 0.65
  const progress = interpolate(frame, [0, Math.max(1, fps * durationSec)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const media =
    props.assetType === 'video' || props.assetType === 'generated_video'
      ? <Video src={props.src ?? ''} muted style={{ width: '100%', height: '100%', objectFit: props.visual.fit }} />
      : <Img src={props.src ?? ''} style={{ width: '100%', height: '100%', objectFit: props.visual.fit }} />

  return (
    <AbsoluteFill style={{ background: '#09090b', overflow: 'hidden' }}>
      <AbsoluteFill style={{ filter: 'contrast(1.08) saturate(1.08)' }}>{media}</AbsoluteFill>
      <AbsoluteFill
        style={{
          background: \`radial-gradient(circle at 50% 50%, rgba(255,255,255,\${0.2 * progress * intensity}) 0%, rgba(34,211,238,\${0.18 * progress}) 24%, rgba(168,85,247,\${0.16 * progress}) 46%, rgba(0,0,0,0) 72%)\`,
          mixBlendMode: 'screen',
          opacity: 0.9,
        }}
      />
    </AbsoluteFill>
  )
}
`,
    manifest: {
      id: input.componentId,
      label: input.capability.id,
      status: 'verified',
      description: input.capability.description,
      capabilities: [input.capability.description],
      visual_grammar: ['generated fallback visual layer', 'radial color energy overlay'],
      supported_asset_types: ['image', 'video', 'generated_video'],
      props_contract: input.componentProps,
      fallback_preset: input.fallbackPreset,
      target_layer: 'effect',
      layer_kind: input.layerKind,
    },
    sample_props: {
      component_id: input.componentId,
      props: input.componentProps,
    },
    acceptance_checklist: {
      import_safety_scan: true,
      typescript_build: true,
      sample_render: 'required_later',
    },
  }
}

function normalizeAuthoringOutput(
  output: AuthoringOutput | undefined,
  fallback: AuthoringOutput,
  componentId: string,
): NormalizedAuthoringOutput {
  if (!output) {
    return {
      output: fallback,
      usedFallbackTemplate: true,
      fallbackReason: 'No structured authoring output was parsed from the model response.',
    }
  }
  if (typeof output.component_tsx !== 'string' || !output.component_tsx.trim()) {
    return {
      output: fallback,
      usedFallbackTemplate: true,
      fallbackReason: 'Parsed authoring output is missing component_tsx.',
    }
  }
  if (!isRecord(output.manifest)) {
    return {
      output: fallback,
      usedFallbackTemplate: true,
      fallbackReason: 'Parsed authoring output is missing manifest.',
    }
  }
  return {
    output: {
      component_tsx: output.component_tsx,
      manifest: normalizeGeneratedComponentManifest({
        ...fallback.manifest,
        ...output.manifest,
        id: componentId,
        status: 'draft',
      }),
      sample_props: isRecord(output.sample_props) ? output.sample_props : fallback.sample_props,
      acceptance_checklist: isRecord(output.acceptance_checklist)
        ? output.acceptance_checklist
        : fallback.acceptance_checklist,
    },
    usedFallbackTemplate: false,
  }
}

function scanSourceSafety(source: string): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(source)) issues.push(`Forbidden source pattern: ${pattern}`)
  }

  const importMatches = source.matchAll(/import\s+(?:type\s+)?[^'"]+from\s+['"]([^'"]+)['"]/g)
  for (const match of importMatches) {
    const specifier = match[1]
    if (!ALLOWED_IMPORTS.has(specifier)) {
      issues.push(`Import not allowed: ${specifier}`)
    }
  }
  if (!/export\s+default\s+function\s+[A-Za-z0-9_]+/.test(source)) {
    issues.push('Missing default function export.')
  }
  if (!source.includes('GeneratedComponentRenderProps')) {
    issues.push('GeneratedComponentRenderProps type is not used.')
  }
  return { ok: issues.length === 0, issues }
}

function commandForNpx(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

function commandForWindowsShell(): string {
  const comSpec = process.env.ComSpec
  if (comSpec && existsSync(comSpec)) return comSpec
  const systemCmd = 'C:\\Windows\\System32\\cmd.exe'
  return existsSync(systemCmd) ? systemCmd : 'cmd.exe'
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const quoteWindowsArg = (arg: string) =>
      /[\s&()^|<>]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
    const child = spawn(
      process.platform === 'win32' ? commandForWindowsShell() : command,
      process.platform === 'win32'
        ? ['/d', '/c', [command, ...args].map(quoteWindowsArg).join(' ')]
        : args,
      {
        cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${stdout}\n${stderr}`))
    })
  })
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset)
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilterPngScanline(input: Buffer, output: Buffer, inputOffset: number, outputOffset: number, stride: number, bpp: number): void {
  const filter = input[inputOffset]
  const scanlineOffset = inputOffset + 1
  for (let x = 0; x < stride; x += 1) {
    const raw = input[scanlineOffset + x]
    const left = x >= bpp ? output[outputOffset + x - bpp] : 0
    const up = outputOffset >= stride ? output[outputOffset + x - stride] : 0
    const upLeft = outputOffset >= stride && x >= bpp ? output[outputOffset + x - stride - bpp] : 0
    let value = raw
    if (filter === 1) value = raw + left
    else if (filter === 2) value = raw + up
    else if (filter === 3) value = raw + Math.floor((left + up) / 2)
    else if (filter === 4) value = raw + paethPredictor(left, up, upLeft)
    output[outputOffset + x] = value & 0xff
  }
}

async function inspectPngNonBlank(filePath: string): Promise<Record<string, unknown> & { ok: boolean }> {
  const png = await readFile(filePath)
  if (png.length < 1024) {
    return { ok: false, file_size: png.length, reason: 'PNG file too small.' }
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks: Buffer[] = []

  while (offset + 8 <= png.length) {
    const length = readUInt32(png, offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > png.length) break
    if (type === 'IHDR') {
      width = readUInt32(png, dataStart)
      height = readUInt32(png, dataStart + 4)
      bitDepth = png[dataStart + 8]
      colorType = png[dataStart + 9]
    } else if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    return {
      ok: png.length > 4096,
      file_size: png.length,
      width,
      height,
      bit_depth: bitDepth,
      color_type: colorType,
      reason: 'Unsupported PNG pixel format; file size fallback used.',
    }
  }

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    unfilterPngScanline(inflated, pixels, y * (stride + 1), y * stride, stride, channels)
  }

  const step = Math.max(1, Math.floor((width * height) / 2000))
  let samples = 0
  let alphaSamples = 0
  let brightnessSum = 0
  let minBrightness = 255
  let maxBrightness = 0
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += step) {
    const base = pixelIndex * channels
    const r = pixels[base]
    const g = pixels[base + 1]
    const b = pixels[base + 2]
    const a = channels === 4 ? pixels[base + 3] : 255
    const brightness = (r + g + b) / 3
    brightnessSum += brightness
    minBrightness = Math.min(minBrightness, brightness)
    maxBrightness = Math.max(maxBrightness, brightness)
    if (a > 8) alphaSamples += 1
    samples += 1
  }

  const avgBrightness = brightnessSum / Math.max(1, samples)
  const contrast = maxBrightness - minBrightness
  const ok = alphaSamples > samples * 0.5 && avgBrightness > 2 && contrast > 1
  return {
    ok,
    file_size: png.length,
    width,
    height,
    samples,
    alpha_samples: alphaSamples,
    avg_brightness: Number(avgBrightness.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
  }
}

function sampleImageDataUrl(): string {
  return [
    'data:image/svg+xml;utf8,',
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="0.45" stop-color="#22d3ee"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="540" cy="960" r="260" fill="#ffffff" opacity="0.35"/></svg>',
    ),
  ].join('')
}

async function renderSampleStill(input: {
  componentId: string
  componentProps: Record<string, unknown>
  debugDir: string
}): Promise<Record<string, unknown> & { ok: boolean }> {
  const propsPath = path.join(input.debugDir, `${input.componentId}.sample-render-props.json`)
  const outputPath = path.join(input.debugDir, `${input.componentId}.sample-frame.png`)
  const props = {
    taskId: `${input.componentId}_sample`,
    fps: 30,
    width: 360,
    height: 640,
    durationInFrames: 45,
    strategy: 'motion_graphics',
    assets: [
      {
        id: 'sample_asset',
        type: 'image',
        name: 'sample.svg',
        url: sampleImageDataUrl(),
        source: 'system',
      },
    ],
    scenes: [
      {
        id: 'scene_sample',
        sourceAnchorId: 'seg_sample',
        fromFrame: 0,
        durationInFrames: 45,
        role: 'component_sample',
        visual: {
          mode: 'material_clip',
          asset_id: 'sample_asset',
          material_source: 'system',
          fit: 'cover',
          visual_prompt: 'Generated component validation sample.',
        },
        effects: {
          preset: 'generated_component',
          component_id: input.componentId,
          props: input.componentProps,
          fallback_preset: BUILTIN_FALLBACK_PRESET,
        },
        overlays: [],
        audio: [],
      },
    ],
    transitions: [],
  }
  await writeJson(input.debugDir, path.basename(propsPath), props)

  try {
    const result = await runCommand(
      commandForNpx(),
      [
        '--no-install',
        'remotion',
        'still',
        'src/index.ts',
        'Dpl304Video',
        outputPath,
        '--props',
        propsPath,
        '--frame',
        '18',
        '--overwrite',
      ],
      remotionRoot(),
    )
    const inspection = await inspectPngNonBlank(outputPath)
    const taskId = taskIdFromComponentDebugDir(input.debugDir)
    if (taskId) {
      const artifact = await artifactRefForPath({
        taskId,
        path: outputPath,
        label: path.basename(outputPath),
        kind: 'image',
      })
      await recordAgentTraceEvent({
        taskId,
        phase: 'component_authoring',
        actor: 'renderer',
        event: 'artifact',
        status: inspection.ok ? 'success' : 'warning',
        summary: `Component sample frame rendered: ${path.basename(outputPath)}`,
        artifactRefs: [artifact],
        data: { inspection },
      })
    }
    return {
      ok: inspection.ok,
      output_path: outputPath,
      stdout: result.stdout.slice(-1000),
      stderr: result.stderr.slice(-1000),
      inspection,
    }
  } catch (error) {
    return {
      ok: false,
      output_path: outputPath,
      message: error instanceof Error ? error.message.slice(-1600) : String(error),
    }
  }
}

async function validateGeneratedComponent(input: {
  source: string
  componentDir: string
  componentId: string
  componentProps: Record<string, unknown>
  debugDir: string
  layerKind: CapabilityLayerKind
  fallbackPreset: SceneEffects['preset']
  validationContract?: ComponentEffectValidationContract
}): Promise<Record<string, unknown> & { ok: boolean }> {
  const safety = scanSourceSafety(input.source)
  const hasComponentSource =
    existsSync(path.join(input.componentDir, COMPONENT_SOURCE_FILE)) ||
    existsSync(path.join(input.componentDir, `${input.componentId}.tsx`))
  const fileStructure =
    hasComponentSource &&
    ['manifest.json', 'sample-props.json', 'acceptance-checklist.json'].every((fileName) =>
      existsSync(path.join(input.componentDir, fileName)),
    )

  if (input.source.length > MAX_GENERATED_SOURCE_CHARS) {
    safety.issues.push(`Generated source too long: ${input.source.length} chars.`)
    safety.ok = false
  }

  let typecheck: Record<string, unknown>
  let sampleRender: Record<string, unknown> & { ok: boolean }
  let effectValidation:
    | { ok: boolean; skipped: boolean; reason: string }
    | Awaited<ReturnType<typeof validateComponentEffect>>
  if (!safety.ok || !fileStructure) {
    typecheck = { ok: false, skipped: true, reason: 'Safety or file structure check failed.' }
    sampleRender = { ok: false, skipped: true, reason: 'Safety or file structure check failed.' }
    effectValidation = { ok: false, skipped: true, reason: 'Safety or file structure check failed.' }
  } else {
    await rebuildGeneratedRegistry([
      {
        id: input.componentId,
        label: input.componentId,
        status: 'verified',
        directory_name: path.basename(input.componentDir),
        fallback_preset: BUILTIN_FALLBACK_PRESET,
        target_layer: 'effect',
        layer_kind:
          normalizeLayerKind(input.componentProps.layer_kind) ??
          normalizeLayerKind(input.componentProps.target_layer) ??
          'composite',
        supported_asset_types: ['image', 'video', 'generated_video'],
      },
    ])
    try {
      const result = await runCommand(commandForNpx(), ['tsc', '--noEmit'], remotionRoot())
      typecheck = { ok: true, stdout: result.stdout.slice(-1000), stderr: result.stderr.slice(-1000) }
    } catch (error) {
      typecheck = { ok: false, message: error instanceof Error ? error.message.slice(-1600) : String(error) }
    }

    sampleRender = !env.enableRemotionComponentSampleRender
      ? {
          ok: true,
          skipped: true,
          reason: 'Sample render disabled via ENABLE_REMOTION_COMPONENT_SAMPLE_RENDER.',
        }
      : typecheck.ok
        ? await renderSampleStill({
            componentId: input.componentId,
            componentProps: input.componentProps,
            debugDir: input.debugDir,
          })
        : { ok: false, skipped: true, reason: 'TypeScript check failed.' }

    effectValidation = !env.enableRemotionComponentEffectValidation
      ? {
          ok: true,
          skipped: true,
          reason: 'Effect validation disabled via ENABLE_REMOTION_COMPONENT_EFFECT_VALIDATION=false.',
        }
      : typecheck.ok
        ? await validateComponentEffect({
            componentId: input.componentId,
            componentProps: input.componentProps,
            layerKind: input.layerKind,
            fallbackPreset: input.fallbackPreset,
            validationContract: input.validationContract,
            componentDir: input.componentDir,
            debugDir: input.debugDir,
            taskId: taskIdFromComponentDebugDir(input.debugDir),
          })
        : { ok: false, skipped: true, reason: 'TypeScript check failed.' }

    await rebuildGeneratedRegistry()
  }

  const ok =
    safety.ok &&
    fileStructure &&
    Boolean(typecheck.ok) &&
    Boolean(sampleRender.ok) &&
    Boolean(effectValidation.ok)
  return {
    ok,
    component_id: input.componentId,
    import_safety_scan: safety,
    file_structure: fileStructure,
    typescript_build: typecheck,
    sample_render: sampleRender,
    effect_validation: effectValidation,
  }
}

async function generateComponent(input: {
  capability: DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number]
  segmentIds: string[]
  layerKind: CapabilityLayerKind
  componentProps: Record<string, unknown>
  fallbackPreset: SceneEffects['preset']
  debugDir: string
  validationContract?: ComponentEffectValidationContract
  seedProposal?: {
    plugin_id: string
    plugin_family: string
    manifest: Record<string, unknown>
    component_summary?: string
    must_match: Record<string, unknown>
    can_adapt: string[]
  }
  componentIdOverride?: string
  debugArtifactPrefix?: string
}): Promise<{ componentId: string; validation: Record<string, unknown> & { ok: boolean }; raw: string }> {
  const componentId = input.componentIdOverride ?? `gen_${safeId(input.capability.id)}`
  const artifactPrefix = input.debugArtifactPrefix ?? `${safeId(componentId)}-`
  const componentDir = path.join(generatedComponentsDir(), componentId)
  const stagingDir = path.join(generatedComponentsDir(), `.${componentId}.staging`)
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  const prompt = authoringPrompt({
    componentId,
    capability: input.capability,
    segmentIds: input.segmentIds,
    layerKind: input.layerKind,
    componentProps: input.componentProps,
    fallbackPreset: input.fallbackPreset,
    seedProposal: input.seedProposal,
  })
  await writeText(input.debugDir, `${artifactPrefix}03-authoring-prompt.txt`, `${prompt}\n`)

  const fallback = fallbackAuthoringOutput({
    componentId,
    capability: input.capability,
    layerKind: input.layerKind,
    componentProps: input.componentProps,
    fallbackPreset: input.fallbackPreset,
  })

  async function writeAuthoringOutputToStaging(output: AuthoringOutput): Promise<void> {
    await writeFile(path.join(stagingDir, COMPONENT_SOURCE_FILE), output.component_tsx, 'utf8')
    await writeJson(stagingDir, 'manifest.json', {
      ...output.manifest,
      status: 'draft',
    })
    await writeJson(stagingDir, 'sample-props.json', output.sample_props)
    await writeJson(stagingDir, 'acceptance-checklist.json', output.acceptance_checklist)
  }

  let raw = ''
  let parsed: AuthoringOutput | undefined
  let parseInfo: AuthoringModelParseInfo = {
    parsed: false,
    source: 'unparsed',
    reason: 'Authoring model was not called.',
  }
  let modelError: string | undefined
  try {
    const response = await callAuthoringModel(prompt)
    raw = response.raw
    parsed = response.parsed
    parseInfo = response.parse
  } catch (error) {
    modelError = error instanceof Error ? error.message : String(error)
    raw = `Authoring model failed; primitive fallback will be used. ${modelError}`
    parseInfo = {
      parsed: false,
      source: 'unparsed',
      reason: modelError,
    }
  }
  await writeText(input.debugDir, `${artifactPrefix}04-llm-output.raw.txt`, raw)
  await writeJson(input.debugDir, `${artifactPrefix}04-parsed-output.summary.json`, {
    component_id: componentId,
    parse: parseInfo,
    parsed_keys: parsed ? Object.keys(parsed as unknown as Record<string, unknown>) : [],
    model_error: modelError ?? null,
  })

  let normalized = normalizeAuthoringOutput(parsed, fallback, componentId)
  if (normalized.usedFallbackTemplate) {
    const blockedValidation = {
      ok: false,
      component_id: componentId,
      promotion_blocked: true,
      registry_updated: false,
      used_local_fallback_template: true,
      fallback_reason: normalized.fallbackReason,
      parse: parseInfo,
      model_error: modelError ?? null,
    }
    await writeJson(input.debugDir, `${artifactPrefix}05-validation.json`, blockedValidation)
    await rm(stagingDir, { recursive: true, force: true })
    return { componentId, validation: blockedValidation, raw }
  }

  let authoringOutput = normalized.output
  await writeAuthoringOutputToStaging(authoringOutput)

  let validation = await validateGeneratedComponent({
    source: authoringOutput.component_tsx,
    componentDir: stagingDir,
    componentId,
    componentProps: input.componentProps,
    debugDir: input.debugDir,
    layerKind: input.layerKind,
    fallbackPreset: input.fallbackPreset,
    validationContract: input.validationContract,
  })

  if (!validation.ok && parsed) {
    const promptForRepair = repairPrompt({
      componentId,
      originalPrompt: prompt,
      previousOutput: authoringOutput,
      validation,
    })
    await writeText(
      input.debugDir,
      `${artifactPrefix}03-authoring-prompt.txt`,
      `${prompt}\n\n--- repair ---\n\n${promptForRepair}\n`,
    )
    try {
      const repairResponse = await callAuthoringModel(promptForRepair)
      raw = `${raw}\n\n--- repair raw ---\n\n${repairResponse.raw}`
      await writeText(input.debugDir, `${artifactPrefix}04-llm-output.raw.txt`, raw)
      await writeJson(input.debugDir, `${artifactPrefix}04-repair-parsed-output.summary.json`, {
        component_id: componentId,
        parse: repairResponse.parse,
        parsed_keys: repairResponse.parsed
          ? Object.keys(repairResponse.parsed as unknown as Record<string, unknown>)
          : [],
      })
      normalized = normalizeAuthoringOutput(repairResponse.parsed, fallback, componentId)
      if (normalized.usedFallbackTemplate) {
        validation = {
          ok: false,
          component_id: componentId,
          promotion_blocked: true,
          registry_updated: false,
          used_local_fallback_template: true,
          fallback_reason: `Repair output rejected: ${normalized.fallbackReason}`,
          initial_validation: validation,
          parse: parseInfo,
          repair_parse: repairResponse.parse,
        }
        await writeJson(input.debugDir, `${artifactPrefix}05-validation.json`, validation)
        await rm(stagingDir, { recursive: true, force: true })
        return { componentId, validation, raw }
      }
      parseInfo = repairResponse.parse
      authoringOutput = normalized.output
      await writeAuthoringOutputToStaging(authoringOutput)
      validation = await validateGeneratedComponent({
        source: authoringOutput.component_tsx,
        componentDir: stagingDir,
        componentId,
        componentProps: input.componentProps,
        debugDir: input.debugDir,
        layerKind: input.layerKind,
        fallbackPreset: input.fallbackPreset,
        validationContract: input.validationContract,
      })
    } catch (error) {
      raw = `${raw}\n\n--- repair failed ---\n\n${error instanceof Error ? error.message : String(error)}`
      await writeText(input.debugDir, `${artifactPrefix}04-llm-output.raw.txt`, raw)
    }
  }

  if (authoringOutput.component_tsx.trim() === fallback.component_tsx.trim()) {
    validation = {
      ...validation,
      ok: false,
      component_id: componentId,
      promotion_blocked: true,
      registry_updated: false,
      used_local_fallback_template: true,
      fallback_reason: 'Generated source matches the local fallback template.',
      parse: parseInfo,
    }
    await writeJson(input.debugDir, `${artifactPrefix}05-validation.json`, validation)
    await rm(stagingDir, { recursive: true, force: true })
    return { componentId, validation, raw }
  }

  if (!validation.ok) {
    await writeJson(input.debugDir, `${artifactPrefix}05-validation.json`, {
      ...validation,
      registry_updated: false,
      parse: parseInfo,
    })
    await rm(stagingDir, { recursive: true, force: true })
    return { componentId, validation: { ...validation, registry_updated: false, parse: parseInfo }, raw }
  }

  await rm(componentDir, { recursive: true, force: true })
  await mkdir(componentDir, { recursive: true })
  const componentTools = createComponentCapabilityToolset({ remotionRoot: remotionRoot() })
  const validationSummary = componentTools.buildValidationSummary({
    validation,
    layerKind: input.layerKind,
    taskId: taskIdFromComponentDebugDir(input.debugDir),
  })
  await writeFile(path.join(componentDir, COMPONENT_SOURCE_FILE), authoringOutput.component_tsx, 'utf8')
  await writeJson(componentDir, 'manifest.json', {
    ...authoringOutput.manifest,
    id: componentId,
    status: 'verified',
    validation_summary: validationSummary,
  })
  await writeJson(componentDir, 'sample-props.json', authoringOutput.sample_props)
  await writeJson(componentDir, 'acceptance-checklist.json', authoringOutput.acceptance_checklist)
  await componentTools.persistValidationHistory({
    componentDir,
    summary: validationSummary,
    validation,
  })
  await rm(stagingDir, { recursive: true, force: true })
  await rebuildGeneratedRegistry()

  const finalValidation = {
    ...validation,
    registry_updated: true,
    promotion: {
      status: 'promoted',
      source: 'model_output',
      parse: parseInfo,
      used_local_fallback_template: false,
    },
  }
  await writeJson(input.debugDir, `${artifactPrefix}05-validation.json`, finalValidation)
  return { componentId, validation: finalValidation, raw }
}

export interface SeedAuthoringByAtomEntry {
  atom_id: string
  component_id: string
  ok: boolean
  layerKind: CapabilityLayerKind
  fallback_preset: SceneEffects['preset']
  component_props: Record<string, unknown>
  reason: string
}

export interface AuthorSeedPluginProposalsInput {
  taskId: string
  mappingDecisionsSeed: MappingDecisionsSeedArtifact
  effectRoadmap: EffectRoadmap
}

export interface AuthorSeedPluginProposalsOutput {
  byAtomId: Map<string, SeedAuthoringByAtomEntry>
  invoked: boolean
  raw_outputs: string[]
  validation_results: unknown[]
}

type MissingCapability =
  DirectorGroundingResult['remotion_capability_plan']['missing_capabilities'][number]

function resolveSegmentIdsForSeedAtom(
  atomId: string,
  effectRoadmap: EffectRoadmap,
): string[] {
  for (const segment of effectRoadmap.segments) {
    if (segment.atoms.some((atom) => atom.id === atomId)) {
      return [segment.segment_id]
    }
  }
  return effectRoadmap.segments[0]?.segment_id ? [effectRoadmap.segments[0].segment_id] : []
}

function capabilityFromSeedDecision(
  decision: SeedMappingDecision,
  atomLayerKind: CapabilityLayerKind | undefined,
): MissingCapability {
  const proposal = decision.proposal!
  const manifest = (proposal.manifest ?? {}) as Record<string, unknown>
  const propsContract = isRecord(manifest.props_contract) ? manifest.props_contract : {}
  const defaultParams = isRecord(manifest.defaultParams)
    ? manifest.defaultParams
    : isRecord(manifest.default_params)
      ? manifest.default_params
      : {}

  return {
    id: proposal.plugin_id,
    description:
      proposal.component_summary?.trim() ||
      `Seed-authored ${decision.plugin_family} plugin for atom ${decision.atom_id}`,
    suggested_contract: {
      ...propsContract,
      ...defaultParams,
      target_layer: decision.target_layer,
      layerKind: resolveSeedManifestLayerKind(manifest, atomLayerKind),
      must_match: decision.must_match,
      can_adapt: decision.can_adapt,
      plugin_family: decision.plugin_family,
      seed_manifest: manifest,
    },
  }
}

export async function authorSeedPluginProposals(
  input: AuthorSeedPluginProposalsInput,
): Promise<AuthorSeedPluginProposalsOutput> {
  const byAtomId = new Map<string, SeedAuthoringByAtomEntry>()
  const rawOutputs: string[] = []
  const validationResults: unknown[] = []
  const generateDecisions = input.mappingDecisionsSeed.decisions.filter(
    (decision) => decision.decision === 'generate_plugin' && decision.proposal?.manifest,
  )

  if (
    generateDecisions.length === 0 ||
    !env.enableRemotionComponentAuthoring ||
    !env.enableSeedPluginAuthoring
  ) {
    return { byAtomId, invoked: false, raw_outputs: rawOutputs, validation_results: validationResults }
  }

  const debugDir = taskDebugDir(input.taskId)
  const atomLayerKindById = new Map<string, CapabilityLayerKind>()
  for (const segment of input.effectRoadmap.segments) {
    for (const atom of segment.atoms) {
      atomLayerKindById.set(atom.id, atom.layerKind)
    }
  }

  await writeJson(debugDir, '07-seed-component-authoring-input.json', {
    task_id: input.taskId,
    generate_plugin_count: generateDecisions.length,
    atom_ids: generateDecisions.map((decision) => decision.atom_id),
  })

  for (const decision of generateDecisions) {
    const proposal = decision.proposal!
    const manifest = hydrateSeedPluginManifest(
      proposal.manifest as Record<string, unknown>,
      atomLayerKindById.get(decision.atom_id),
    )
    if (!manifest) continue

    const atomLayerKind = atomLayerKindById.get(decision.atom_id)
    const layerKind = resolveSeedManifestLayerKind(manifest, atomLayerKind)
    const fallbackPreset =
      inferFallbackPresetFromSeedManifest({ manifest, atomLayerKind }) ??
      fallbackPresetForLayer(layerKind)
    const capability = capabilityFromSeedDecision(decision, atomLayerKind)
    const segmentIds = resolveSegmentIdsForSeedAtom(decision.atom_id, input.effectRoadmap)
    const componentProps = buildComponentProps(capability, segmentIds, layerKind)
    const componentId = `gen_${safeId(proposal.plugin_id)}`
    const artifactPrefix = `seed-${safeId(decision.atom_id)}-`

    const generated = await generateComponent({
      capability,
      segmentIds,
      layerKind,
      componentProps,
      fallbackPreset,
      debugDir,
      componentIdOverride: componentId,
      debugArtifactPrefix: artifactPrefix,
      seedProposal: {
        plugin_id: proposal.plugin_id,
        plugin_family: decision.plugin_family,
        manifest,
        component_summary: proposal.component_summary,
        must_match: decision.must_match as Record<string, unknown>,
        can_adapt: decision.can_adapt,
      },
    })

    rawOutputs.push(generated.raw)
    validationResults.push(generated.validation)

    const entry: SeedAuthoringByAtomEntry = {
      atom_id: decision.atom_id,
      component_id: generated.componentId,
      ok: generated.validation.ok,
      layerKind,
      fallback_preset: fallbackPreset,
      component_props: componentProps,
      reason: generated.validation.ok
        ? `Seed proposal ${proposal.plugin_id} authored as ${generated.componentId}.`
        : `Seed proposal ${proposal.plugin_id} authoring failed; compile will use primitive fallback ${fallbackPreset}.`,
    }
    byAtomId.set(decision.atom_id, entry)
  }

  await writeJson(debugDir, '07-seed-component-authoring-report.json', {
    task_id: input.taskId,
    results: [...byAtomId.values()],
  })

  return { byAtomId, invoked: true, raw_outputs: rawOutputs, validation_results: validationResults }
}

async function readVerifiedRegistryEntries(): Promise<Array<GeneratedComponentManifest & { directory_name: string }>> {
  const dir = generatedComponentsDir()
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const manifests: Array<GeneratedComponentManifest & { directory_name: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const manifestPath = path.join(dir, entry.name, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    if (!resolveComponentSourcePath(path.join(dir, entry.name), entry.name)) continue
    try {
      const raw = await readFile(manifestPath, 'utf8')
      const manifest = normalizeGeneratedComponentManifest(
        JSON.parse(raw) as GeneratedComponentManifest,
      )
      if (manifest.id && manifest.status === 'verified') {
        manifests.push({ ...manifest, directory_name: entry.name })
      }
    } catch {
      // Ignore malformed manifests.
    }
  }
  return manifests
}

async function rebuildGeneratedRegistry(
  extraEntries: Array<GeneratedComponentManifest & { directory_name: string }> = [],
): Promise<void> {
  const manifests = [...(await readVerifiedRegistryEntries()), ...extraEntries].filter(
    (manifest) => manifest.status === 'verified',
  )
  const imports = manifests
    .map((manifest, index) => {
      const id = safeId(manifest.id)
      return `import Component${index} from './${manifest.directory_name}/component'`
    })
    .join('\n')
  const items = manifests
    .map((manifest, index) => {
      const normalizedManifest = normalizeGeneratedComponentManifest(manifest)
      const id = safeId(normalizedManifest.id)
      return `  {
    id: ${JSON.stringify(id)},
    label: ${JSON.stringify(normalizedManifest.label ?? id)},
    status: 'verified',
    layerKind: ${JSON.stringify(normalizedManifest.layer_kind ?? 'composite')},
    targetLayer: ${JSON.stringify(normalizedManifest.target_layer ?? 'effect')},
    component: Component${index},
    fallbackPreset: ${JSON.stringify(normalizedManifest.fallback_preset ?? BUILTIN_FALLBACK_PRESET)},
    capabilities: ${JSON.stringify(normalizedManifest.capabilities ?? [])},
    requiredParams: [],
    defaultParams: {},
    compatibleLayers: [],
    supportedAssetTypes: ${JSON.stringify(normalizedManifest.supported_asset_types ?? ['image', 'video', 'generated_video'])},
    acceptedAssetTypes: ${JSON.stringify(normalizedManifest.supported_asset_types ?? ['image', 'video', 'generated_video'])},
  },`
    })
    .join('\n')
  const content = `// Registers verified AI-authored Remotion components for runtime lookup.
import type { GeneratedComponentRegistryItem } from '../component-registry'
${imports ? `\n${imports}\n` : ''}
export const GENERATED_COMPONENT_REGISTRY: GeneratedComponentRegistryItem[] = [
${items}
]
`
  await mkdir(generatedComponentsDir(), { recursive: true })
  await writeFile(path.join(generatedComponentsDir(), 'registry.generated.ts'), content, 'utf8')
}

export async function resolveRenderCapabilities(
  input: ResolveRenderCapabilitiesInput,
): Promise<ResolveRenderCapabilitiesOutput> {
  const debugDir = taskDebugDir(input.taskId)
  const grounding = extractGrounding(input.structure)
  const missingCapabilities =
    grounding?.remotion_capability_plan.missing_capabilities ?? []
  const matchedPlugins = grounding?.remotion_capability_plan.matched_plugins ?? []
  const componentTools = createComponentCapabilityToolset({ remotionRoot: remotionRoot() })
  const knowledgeBase = await componentTools.buildKnowledgeBase()
  const generatedKnowledgeCount = knowledgeBase.items.filter(
    (item) => item.source === 'generated_component',
  ).length

  await writeJson(debugDir, '01-component-knowledge-summary.json', {
    task_id: input.taskId,
    schema_version: knowledgeBase.schema_version,
    trace_verbosity: env.traceVerbosity,
    skill: {
      name: COMPONENT_AUTHORING_SKILL.name,
      version: COMPONENT_AUTHORING_SKILL.version,
    },
    missing_capability_count: missingCapabilities.length,
    matched_plugin_count: matchedPlugins.length,
    knowledge_base: {
      item_count: knowledgeBase.item_count,
      builtin_count: knowledgeBase.item_count - generatedKnowledgeCount,
      generated_count: generatedKnowledgeCount,
    },
    semantic_anchors: input.structure.semantic_anchors.map((anchor) => ({
      anchor_id: anchor.anchor_id,
      start_sec: anchor.start_sec,
      end_sec: anchor.end_sec,
      role: anchor.logic_intent.marketing_role,
    })),
  })

  let structure = input.structure
  const decisions: RenderPlanComponentResolutionDecision[] = []
  const retrievalSummaries: unknown[] = []
  const retrievalDebugReports: ComponentRetrievalResult[] = []
  const gapReports: ComponentGapReport[] = []
  const validationResults: unknown[] = []
  const rawOutputs: string[] = []
  let authoringPromptWritten = false

  for (const capability of missingCapabilities) {
    const capabilityText = `${capability.id} ${capability.description} ${JSON.stringify(capability.suggested_contract)}`
    const segmentIds = extractSegmentIds(capability, structure)
    const targetLayerKind = inferCapabilityLayerKind({
      capabilityText,
      contract: capability.suggested_contract,
    })
    const componentProps = buildComponentProps(capability, segmentIds, targetLayerKind)
    const overlayCapability = isOverlayCapability(capabilityText)

    if (overlayCapability) {
      retrievalSummaries.push({
        capability_id: capability.id,
        target_layer_kind: targetLayerKind,
        segment_ids: segmentIds,
        decision: 'overlay_injection',
        component_props: componentProps,
      })
      rawOutputs.push(`Overlay capability ${capability.id} resolved by RenderPlan overlay injection.`)
      decisions.push({
        capability_id: capability.id,
        segment_ids: segmentIds,
        decision: 'reuse',
        target_layer: 'overlay',
        layer_kind: 'overlay',
        component_props: componentProps,
        reason: 'Overlay capability resolved through RenderPlan overlay injection; no visual effect fallback applied.',
      })
      continue
    }

    const retrieval = componentTools.searchKnowledge({
      capabilityText,
      targetLayer: targetLayerKind,
      segmentIds,
      knowledgeBase,
      matchedPlugins,
    })
    const gapReport = componentTools.buildGapReport({
      capability: {
        id: capability.id,
        description: capability.description,
        suggested_contract: capability.suggested_contract,
      },
      targetLayer: targetLayerKind,
      retrieval,
      authoringEnabled: env.enableRemotionComponentAuthoring,
    })
    const authoringGate = evaluateComponentAuthoringGate({
      authoringEnabled: env.enableRemotionComponentAuthoring,
      gapReport,
    })
    const fallback = retrieval.fallback
    retrievalSummaries.push({
      capability_id: capability.id,
      component_props: componentProps,
      retrieval: componentTools.compactRetrieval(retrieval),
      gap_report: {
        decision: gapReport.decision,
        gap_type: gapReport.gap_type,
        reuse_rejection: gapReport.reuse_rejection,
        validation_metrics: gapReport.validation_contract.metrics,
        authoring_gate: authoringGate,
      },
    })
    if (env.traceVerbosity === 'debug') retrievalDebugReports.push(retrieval)
    gapReports.push(gapReport)

    if (retrieval.generatedReuse) {
      decisions.push({
        capability_id: capability.id,
        segment_ids: segmentIds,
        decision: 'reuse',
        target_layer: 'effect',
        layer_kind: retrieval.generatedReuse.layerKind,
        preset: 'generated_component',
        component_id: retrieval.generatedReuse.component_id,
        component_props: componentProps,
        fallback_preset: (retrieval.generatedReuse.fallback_preset ?? fallback.preset) as SceneEffects['preset'],
        reason: retrieval.generatedReuse.reason,
      })
      continue
    }

    if (retrieval.generatedAdapt) {
      decisions.push({
        capability_id: capability.id,
        segment_ids: segmentIds,
        decision: 'adapt',
        target_layer: 'effect',
        layer_kind: retrieval.generatedAdapt.layerKind,
        preset: 'generated_component',
        component_id: retrieval.generatedAdapt.component_id,
        component_props: componentProps,
        fallback_preset: (retrieval.generatedAdapt.fallback_preset ?? fallback.preset) as SceneEffects['preset'],
        reason: retrieval.generatedAdapt.reason,
      })
      continue
    }

    if (retrieval.presetReuse?.preset) {
      structure = ensureSceneEffectRecipe(structure, segmentIds, retrieval.presetReuse.preset, componentProps)
      decisions.push({
        capability_id: capability.id,
        segment_ids: segmentIds,
        decision: 'reuse',
        target_layer: 'effect',
        layer_kind: retrieval.presetReuse.layerKind,
        preset: retrieval.presetReuse.preset,
        component_id: retrieval.presetReuse.item_id,
        component_props: componentProps,
        reason: retrieval.presetReuse.reason,
      })
      continue
    }

    if (authoringGate.allow) {
      const generatedComponent = await generateComponent({
        capability,
        segmentIds,
        layerKind: targetLayerKind,
        componentProps,
        fallbackPreset: fallback.preset as SceneEffects['preset'],
        debugDir,
        validationContract: gapReport.validation_contract,
      })
      authoringPromptWritten = true
      rawOutputs.push(generatedComponent.raw)
      validationResults.push(generatedComponent.validation)

      if (generatedComponent.validation.ok) {
        decisions.push({
          capability_id: capability.id,
          segment_ids: segmentIds,
          decision: 'generate',
          target_layer: 'effect',
          layer_kind: targetLayerKind,
          preset: 'generated_component',
          component_id: generatedComponent.componentId,
          component_props: componentProps,
          fallback_preset: fallback.preset as SceneEffects['preset'],
          reason: 'Generated and validated a new Remotion component after gap_report approved generation.',
        })
      } else {
        structure = ensureSceneEffectRecipe(structure, segmentIds, fallback.preset as SceneEffects['preset'], componentProps)
        decisions.push({
          capability_id: capability.id,
          segment_ids: segmentIds,
          decision: 'fallback',
          target_layer: 'effect',
          layer_kind: fallback.layerKind,
          preset: fallback.preset,
          fallback_preset: fallback.preset,
          reason: `Generated component failed validation; fallback to ${fallback.preset}.`,
        })
      }
    } else {
      structure = ensureSceneEffectRecipe(structure, segmentIds, fallback.preset as SceneEffects['preset'], componentProps)
      rawOutputs.push(
        `${authoringGate.reason} Fallback used for ${capability.id}.`,
      )
      decisions.push({
        capability_id: capability.id,
        segment_ids: segmentIds,
        decision: 'fallback',
        target_layer: 'effect',
        layer_kind: fallback.layerKind,
        preset: fallback.preset,
        fallback_preset: fallback.preset,
        reason: `${authoringGate.reason} ${gapReport.reasons.join(' ')} Fallback to ${fallback.preset}.`,
      })
    }
  }

  await writeJson(debugDir, '02-component-retrieval-summary.json', {
    task_id: input.taskId,
    trace_verbosity: env.traceVerbosity,
    data: retrievalSummaries,
  })
  await writeJson(debugDir, '02-component-gap-report.json', {
    task_id: input.taskId,
    data: gapReports,
  })
  if (env.traceVerbosity === 'debug') {
    await writeJson(debugDir, '02-component-retrieval-debug.json', {
      task_id: input.taskId,
      data: retrievalDebugReports,
    })
  }
  if (!authoringPromptWritten) {
    await writeText(debugDir, '03-authoring-prompt.txt', 'No component authoring prompt needed.\n')
  }
  await writeText(
    debugDir,
    '04-llm-output.raw.txt',
    rawOutputs.length ? `${rawOutputs.join('\n\n')}\n` : 'No component authoring output.\n',
  )
  if (!validationResults.length) {
    await writeJson(debugDir, '05-validation.json', {
      component_authoring_enabled: env.enableRemotionComponentAuthoring,
      generated_components: [],
    })
  } else {
    const validationRecords = validationResults.filter(isRecord)
    await writeJson(debugDir, '05-validation-summary.json', {
      task_id: input.taskId,
      component_authoring_enabled: env.enableRemotionComponentAuthoring,
      generated_components: validationRecords.map((record) => ({
        component_id: record.component_id,
        ok: record.ok,
        registry_updated: record.registry_updated === true,
        promotion_blocked: record.promotion_blocked === true,
        fallback_reason: record.fallback_reason,
        parse_source: isRecord(record.parse) ? record.parse.source : undefined,
      })),
      promoted_count: validationRecords.filter(
        (record) => record.ok === true && record.registry_updated === true,
      ).length,
      blocked_count: validationRecords.filter(
        (record) => record.promotion_blocked === true || record.ok !== true,
      ).length,
    })
  }

  const componentResolution: RenderPlanComponentResolution = {
    enabled: true,
    authoring_enabled: env.enableRemotionComponentAuthoring,
    decisions,
    debug_dir: debugDir,
  }
  await writeJson(debugDir, '06-component-resolution.report.json', componentResolution)

  return { structure, componentResolution }
}

function buildGeneratedComponentSceneEffects(
  decision: RenderPlanComponentResolutionDecision,
  scene: RenderPlanV1['scenes'][number],
): GeneratedComponentEffects {
  return {
    preset: 'generated_component',
    component_id: decision.component_id!,
    props: {
      ...(decision.component_props ?? {}),
      capability_id: decision.capability_id,
      source_anchor_id: scene.source_anchor_id,
    },
    fallback_preset: decision.fallback_preset,
  }
}

function applyPresetResolutionToScene(
  scene: RenderPlanV1['scenes'][number],
  decision: RenderPlanComponentResolutionDecision,
): RenderPlanV1['scenes'][number] {
  if (!decision.preset || decision.preset === 'generated_component') return scene
  const baseEffect = createDefaultEffect(decision.preset)
  if (!baseEffect) return scene
  const pluginId = decision.component_id ?? pluginIdForPreset(decision.preset) ?? decision.capability_id
  const manifest = getRenderPluginManifest(pluginId)
  const layerKind = decision.layer_kind ?? manifest?.layerKind ?? 'composite'
  const effects = baseEffect

  return {
    ...scene,
    effects,
    effect_layers: [
      {
        id: `effect_${scene.source_anchor_id}_${decision.preset}`,
        layerKind,
        kind: layerKind,
        plugin_id: pluginId,
        preset: decision.preset,
        effects,
        source: 'component_resolution',
        is_primary: true,
        reason: decision.reason,
        resolution: decision.decision === 'fallback' ? 'fallback' : 'compiled',
      },
      ...(scene.effect_layers ?? []).map((layer) => ({
        ...layer,
        is_primary: false,
      })),
    ] satisfies RenderEffectLayer[],
  }
}

export function applyComponentResolutionToRenderPlan(
  plan: RenderPlanV1,
  componentResolution: RenderPlanComponentResolution | undefined,
): RenderPlanV1 {
  if (!componentResolution?.decisions.length) {
    return componentResolution ? { ...plan, component_resolution: componentResolution } : plan
  }

  const scenes = plan.scenes.map((scene) => {
    const decision = componentResolution.decisions.find((item) =>
      item.segment_ids.includes(scene.source_anchor_id),
    )
    if (decision?.target_layer === 'overlay') {
      const props = decision.component_props ?? {}
      const subtype =
        typeof props.overlay_subtype === 'string' ? props.overlay_subtype : 'caption'
      const text =
        typeof props.text_content === 'string' && props.text_content.trim()
          ? props.text_content.trim()
          : scene.overlays[0]?.text ?? ''
      const color =
        typeof props.color_hex === 'string' && props.color_hex.trim()
          ? props.color_hex.trim()
          : '#ffffff'
      const displayDuration =
        typeof props.display_duration_before_unlock === 'number'
          ? props.display_duration_before_unlock
          : Math.min(1.2, scene.end_sec - scene.start_sec)
      const opacity =
        typeof props.opacity === 'number'
          ? Math.min(1, Math.max(0, props.opacity))
          : subtype === 'watermark'
            ? 0.34
            : undefined
      const overlay =
        subtype === 'watermark'
          ? {
              id: `overlay_watermark_${scene.source_anchor_id}`,
              type: 'subtitle' as const,
              start_sec: scene.start_sec,
              end_sec: scene.end_sec,
              text,
              layout: {
                position: 'bottom' as const,
                align: 'center' as const,
                max_width_pct: 82,
              },
              style: {
                font_size: 22,
                font_weight: 'regular' as const,
                color: '#ffffff',
                shadow: true,
                opacity,
              },
              animation: {
                in: 'fade_in' as const,
                out: 'fade_out' as const,
              },
            }
          : subtype === 'color_label'
            ? {
                id: `overlay_color_label_${scene.source_anchor_id}`,
                type: 'subtitle' as const,
                start_sec: scene.start_sec,
                end_sec: Math.min(scene.end_sec, scene.start_sec + displayDuration),
                text,
                layout: {
                  position: 'center' as const,
                  align: 'center' as const,
                  max_width_pct: 42,
                },
                style: {
                  font_size: 42,
                  font_weight: 'black' as const,
                  color: '#ffffff',
                  stroke: '#111111',
                  shadow: true,
                  opacity,
                  color_label: {
                    square_color: color,
                    square_size_px: 26,
                    gap_px: 12,
                  },
                },
                animation: {
                  in: 'fade_in' as const,
                  out: 'fade_out' as const,
                },
              }
            : {
                id: `overlay_caption_${scene.source_anchor_id}`,
                type: 'subtitle' as const,
                start_sec: scene.start_sec,
                end_sec: Math.min(scene.end_sec, scene.start_sec + displayDuration),
                text,
                layout: {
                  position: 'bottom' as const,
                  align: 'center' as const,
                  max_width_pct: 88,
                },
                style: {
                  font_size: 34,
                  font_weight: 'bold' as const,
                  color: '#ffffff',
                  stroke: '#111111',
                  shadow: true,
                  opacity,
                },
                animation: {
                  in: 'fade_in' as const,
                  out: 'fade_out' as const,
                },
              }

      return {
        ...scene,
        overlays: [
          overlay,
          ...scene.overlays.filter((item) => item.text.trim() && item.text.trim() !== text),
        ],
      }
    }

    if (!decision) return scene

    if (
      (decision.decision === 'reuse' ||
        decision.decision === 'adapt' ||
        decision.decision === 'generate') &&
      decision.preset === 'generated_component' &&
      decision.component_id
    ) {
      const effects = buildGeneratedComponentSceneEffects(decision, scene)
      return {
        ...scene,
        effects,
        effect_layers: [
          {
            id: `effect_${scene.source_anchor_id}_${decision.component_id}`,
            layerKind: decision.layer_kind ?? 'composite',
            kind: decision.layer_kind ?? 'composite',
            plugin_id: decision.component_id ?? decision.capability_id,
            preset: 'generated_component',
            effects,
            source: 'component_resolution',
            is_primary: true,
            reason: decision.reason,
            resolution: 'compiled',
          },
          ...(scene.effect_layers ?? []).map((layer) => ({
            ...layer,
            is_primary: false,
          })),
        ] satisfies RenderEffectLayer[],
      }
    }

    if (
      (decision.decision === 'reuse' ||
        decision.decision === 'adapt' ||
        decision.decision === 'fallback') &&
      decision.preset &&
      decision.preset !== 'generated_component'
    ) {
      return applyPresetResolutionToScene(scene, decision)
    }

    return scene
  })

  return {
    ...plan,
    scenes,
    component_resolution: componentResolution,
  }
}

export async function validateRenderPlanComponents(plan: RenderPlanV1): Promise<RenderPlanV1> {
  const manifests = [
    ...readBuiltinComponentManifests(),
    ...(await readGeneratedComponentManifests(remotionRoot())),
  ]
  const verifiedIds = new Set(
    manifests.filter((manifest) => manifest.status === 'verified').map((manifest) => manifest.id),
  )

  return {
    ...plan,
    scenes: plan.scenes.map((scene) => {
      if (scene.effects?.preset !== 'generated_component') return scene
      if (verifiedIds.has(scene.effects.component_id)) return scene

      const fallbackPreset = scene.effects.fallback_preset
      const fallbackEffect = fallbackPreset
        ? createDefaultEffect(fallbackPreset as SceneEffects['preset'])
        : undefined
      if (!fallbackEffect) {
        return { ...scene, effects: undefined }
      }
      return {
        ...scene,
        effects: fallbackEffect,
      }
    }),
  }
}
