import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import {
  buildComponentGapReport,
  buildComponentKnowledgeBase,
  compactComponentRetrievalResult,
  retrieveComponentCapabilities,
  type ComponentGapReport,
  type ComponentKnowledgeBase,
  type ComponentRetrievalResult,
  type ComponentValidationSummary,
  type GroundingMatchedPluginHint,
} from './component-knowledge.js'
import {
  validateComponentEffect,
  type ComponentEffectValidationContract,
} from './component-effect-validation.js'

export { validateComponentEffect }
export type { ComponentEffectValidationContract }

export interface ComponentCapabilityToolset {
  buildKnowledgeBase(): Promise<ComponentKnowledgeBase>
  searchKnowledge(input: {
    capabilityText: string
    targetLayer: CapabilityLayerKind
    segmentIds: string[]
    knowledgeBase: ComponentKnowledgeBase
    matchedPlugins?: GroundingMatchedPluginHint[]
  }): ComponentRetrievalResult
  buildGapReport(input: {
    capability: {
      id: string
      description: string
      suggested_contract: Record<string, unknown>
    }
    targetLayer: CapabilityLayerKind
    retrieval: ComponentRetrievalResult
    authoringEnabled: boolean
  }): ComponentGapReport
  compactRetrieval(result: ComponentRetrievalResult): Record<string, unknown>
  buildValidationSummary(input: {
    validation: Record<string, unknown> & { ok: boolean }
    layerKind: CapabilityLayerKind
    taskId?: string
  }): ComponentValidationSummary
  persistValidationHistory(input: {
    componentDir: string
    summary: ComponentValidationSummary
    validation: Record<string, unknown> & { ok: boolean }
  }): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validationOkField(value: unknown, field: string): boolean | undefined {
  if (!isRecord(value)) return undefined
  const child = value[field]
  if (!isRecord(child) || typeof child.ok !== 'boolean') return undefined
  return child.ok
}

function buildValidationSummary(input: {
  validation: Record<string, unknown> & { ok: boolean }
  layerKind: CapabilityLayerKind
  taskId?: string
}): ComponentValidationSummary {
  const effectValidation = isRecord(input.validation.effect_validation)
    ? input.validation.effect_validation
    : {}
  const failedCriteria = Array.isArray(effectValidation.failedCriteria)
    ? effectValidation.failedCriteria.filter((item): item is string => typeof item === 'string')
    : []
  return {
    typecheck_ok: validationOkField(input.validation, 'typescript_build'),
    sample_render_ok: validationOkField(input.validation, 'sample_render'),
    effect_validation_ok: validationOkField(input.validation, 'effect_validation'),
    layer_kind: input.layerKind,
    last_validated_at: new Date().toISOString(),
    last_task_id: input.taskId,
    failed_criteria: failedCriteria,
    metrics: isRecord(effectValidation.metrics)
      ? (effectValidation.metrics as Record<string, number | boolean>)
      : undefined,
  }
}

async function persistValidationHistory(input: {
  componentDir: string
  summary: ComponentValidationSummary
  validation: Record<string, unknown> & { ok: boolean }
}): Promise<void> {
  const historyPath = path.join(input.componentDir, 'validation-history.json')
  let history: unknown[] = []
  if (existsSync(historyPath)) {
    try {
      const raw = await readFile(historyPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      history = Array.isArray(parsed) ? parsed : []
    } catch {
      history = []
    }
  }
  history.push({
    ...input.summary,
    ok: input.validation.ok,
  })
  await writeFile(historyPath, `${JSON.stringify(history.slice(-20), null, 2)}\n`, 'utf8')
}

export function createComponentCapabilityToolset(input: {
  remotionRoot: string
}): ComponentCapabilityToolset {
  return {
    buildKnowledgeBase: () =>
      buildComponentKnowledgeBase({
        remotionRoot: input.remotionRoot,
      }),
    searchKnowledge: (toolInput) => retrieveComponentCapabilities(toolInput),
    buildGapReport: (toolInput) => buildComponentGapReport(toolInput),
    compactRetrieval: (result) => compactComponentRetrievalResult(result),
    buildValidationSummary,
    persistValidationHistory,
  }
}

