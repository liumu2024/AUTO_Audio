import type { MetricDefinition } from './schema.js'

export interface MetricScore {
  id: string
  label: string
  scale: MetricDefinition['scale']
  value: number | null
  status: 'measured' | 'unrated' | 'not_observed'
  numerator?: number
  denominator?: number
  sampleSize?: number
  confidence95?: { low: number; high: number }
  evidence: string[]
}

export interface RateEvidence {
  metricId: string
  numerator: number
  denominator: number
  evidence?: string
  clusters?: Array<{ numerator: number; denominator: number }>
}

function clusteredInterval(observations: Array<{ numerator: number; denominator: number }>) {
  if (!observations.length || observations.some((item) => item.denominator <= 0)) return undefined
  if (observations.length === 1) return undefined
  let state = 0x9e3779b9
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const samples = Array.from({ length: 2_000 }, () => {
    let numerator = 0
    let denominator = 0
    for (let index = 0; index < observations.length; index += 1) {
      const selected = observations[Math.floor(random() * observations.length)]!
      numerator += selected.numerator
      denominator += selected.denominator
    }
    return numerator / denominator
  }).sort((a, b) => a - b)
  return { low: samples[49]!, high: samples[1949]! }
}

export function scoreEvaluationEvidence(input: {
  metricCatalog: MetricDefinition[]
  binary: Array<{ metricId: string; passed: boolean; evidence?: string }>
  rates: RateEvidence[]
  means?: Array<{ metricId: string; total: number; observations: number; evidence?: string }>
  score10: Array<{ metricId: string; value: number; evidence?: string }>
  counts?: Array<{ metricId: string; value: number; evidence?: string }>
}) {
  const metrics = input.metricCatalog.map<MetricScore>((definition) => {
    const evidence: string[] = []
    if (definition.scale === 'binary') {
      const observations = input.binary.filter((item) => item.metricId === definition.id)
      evidence.push(...observations.flatMap((item) => item.evidence ? [item.evidence] : []))
      return observations.length
        ? {
            id: definition.id, label: definition.label, scale: definition.scale,
            value: observations.every((item) => item.passed) ? 1 : 0,
            status: 'measured', numerator: observations.filter((item) => item.passed).length,
            denominator: observations.length, sampleSize: observations.length, evidence,
          }
        : { id: definition.id, label: definition.label, scale: definition.scale, value: null, status: 'not_observed', evidence }
    }
    if (definition.scale === 'rate') {
      const observations = input.rates.filter((item) => item.metricId === definition.id)
      const clusters = observations.flatMap((item) => item.clusters ?? [{ numerator: item.numerator, denominator: item.denominator }])
      const numerator = observations.reduce((sum, item) => sum + item.numerator, 0)
      const denominator = observations.reduce((sum, item) => sum + item.denominator, 0)
      evidence.push(...observations.flatMap((item) => item.evidence ? [item.evidence] : []))
      return denominator
        ? { id: definition.id, label: definition.label, scale: definition.scale, value: numerator / denominator, status: 'measured', numerator, denominator, sampleSize: clusters.length, confidence95: clusteredInterval(clusters), evidence }
        : { id: definition.id, label: definition.label, scale: definition.scale, value: null, status: 'not_observed', numerator, denominator, evidence }
    }
    if (definition.scale === 'mean') {
      const observations = (input.means ?? []).filter((item) => item.metricId === definition.id)
      const total = observations.reduce((sum, item) => sum + item.total, 0)
      const denominator = observations.reduce((sum, item) => sum + item.observations, 0)
      evidence.push(...observations.flatMap((item) => item.evidence ? [item.evidence] : []))
      return denominator
        ? { id: definition.id, label: definition.label, scale: definition.scale, value: total / denominator, status: 'measured', denominator, evidence }
        : { id: definition.id, label: definition.label, scale: definition.scale, value: null, status: 'not_observed', denominator, evidence }
    }
    if (definition.scale === 'score10') {
      const observations = input.score10.filter((item) => item.metricId === definition.id)
      evidence.push(...observations.flatMap((item) => item.evidence ? [item.evidence] : []))
      if (!observations.length) return { id: definition.id, label: definition.label, scale: definition.scale, value: null, status: 'unrated', evidence }
      if (observations.some((item) => !Number.isFinite(item.value) || item.value < 0 || item.value > 10)) {
        throw new Error(`Metric ${definition.id} has a score outside 0-10.`)
      }
      return { id: definition.id, label: definition.label, scale: definition.scale, value: observations.reduce((sum, item) => sum + item.value, 0) / observations.length, status: 'measured', denominator: observations.length, evidence }
    }
    const observations = (input.counts ?? []).filter((item) => item.metricId === definition.id)
    evidence.push(...observations.flatMap((item) => item.evidence ? [item.evidence] : []))
    return observations.length
      ? { id: definition.id, label: definition.label, scale: definition.scale, value: observations.reduce((sum, item) => sum + item.value, 0), status: 'measured', evidence }
      : { id: definition.id, label: definition.label, scale: definition.scale, value: null, status: 'not_observed', evidence }
  })
  return { metrics }
}

export function evaluateHardGates(
  catalog: MetricDefinition[],
  scores: MetricScore[],
  requiredMetricIds: readonly string[],
) {
  const required = new Set(requiredMetricIds)
  const definitions = new Map(catalog.map((metric) => [metric.id, metric]))
  const failures: string[] = []
  for (const metricId of required) {
    const definition = definitions.get(metricId)
    if (!definition?.hardGate) {
      failures.push(`${metricId}=invalid_gate_definition`)
      continue
    }
    const score = scores.find((item) => item.id === metricId)
    if (!score || score.status !== 'measured' || score.value === null) {
      failures.push(`${metricId}=not_observed`)
      continue
    }
    const passed = definition.scale === 'count' ? score.value === 0 : score.value === 1
    if (!passed) failures.push(`${metricId}=${score.value}`)
  }
  return { releaseBlocked: failures.length > 0, failures }
}

export function evaluateQualityGates(
  catalog: MetricDefinition[],
  scores: MetricScore[],
  gates: ReadonlyArray<{ metricId: string; minimum: number }>,
) {
  const definitions = new Map(catalog.map((metric) => [metric.id, metric]))
  const failures: string[] = []
  for (const gate of gates) {
    const definition = definitions.get(gate.metricId)
    if (!definition || definition.scale !== 'rate' || gate.minimum < 0 || gate.minimum > 1) {
      failures.push(`${gate.metricId}=invalid_quality_gate`)
      continue
    }
    const score = scores.find((item) => item.id === gate.metricId)
    if (!score || score.status !== 'measured' || score.value === null) {
      failures.push(`${gate.metricId}=not_observed`)
    } else if (score.value < gate.minimum) {
      failures.push(`${gate.metricId}=${score.value}<${gate.minimum}`)
    }
  }
  return { qualified: failures.length === 0, failures }
}
