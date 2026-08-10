export interface FormalCommandResult {
  id: string
  ok: boolean
  status?: number | null
  stderr?: string
}

export interface FormalTurnResult {
  caseId: string
  run: number
  turn: number
  deterministicPass: boolean
  deterministicFailures?: unknown
  judgePass?: boolean
  judgeFailure?: unknown
  traceDir?: string
}

export type FormalFailure =
  | { source: 'smoke'; id: string; status?: number | null; stderr?: string }
  | {
      source: 'turn'
      id: string
      caseId: string
      run: number
      turn: number
      deterministicFailures?: unknown
      judgeFailure?: unknown
      traceDir?: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function summarizeFormalExecution(input: {
  commandResults: FormalCommandResult[]
  turns: FormalTurnResult[]
  renderDetails?: unknown
}): {
  failures: FormalFailure[]
  renderScenarioCount: number
  renderDelivery: { successes: number; total: number; rate: number } | null
} {
  const smokeFailures: FormalFailure[] = input.commandResults
    .filter((result) => !result.ok)
    .map((result) => ({
      source: 'smoke',
      id: result.id,
      status: result.status,
      stderr: result.stderr,
    }))
  const turnFailures: FormalFailure[] = input.turns
    .filter((turn) => !turn.deterministicPass || turn.judgePass === false)
    .map((turn) => ({
      source: 'turn',
      id: turn.caseId,
      caseId: turn.caseId,
      run: turn.run,
      turn: turn.turn,
      deterministicFailures: turn.deterministicFailures,
      judgeFailure: turn.judgeFailure,
      traceDir: turn.traceDir,
    }))

  const scenarios = isRecord(input.renderDetails) && Array.isArray(input.renderDetails.scenarios)
    ? input.renderDetails.scenarios.filter(isRecord)
    : []
  const deliveryScenarios = scenarios.filter((scenario) => typeof scenario.expectedFailure !== 'string')
  const successfulRenders = deliveryScenarios.filter(
    (scenario) => scenario.ok === true && typeof scenario.outputPath === 'string' && scenario.outputPath.length > 0,
  ).length
  const renderDelivery = deliveryScenarios.length > 0
    ? {
        successes: successfulRenders,
        total: deliveryScenarios.length,
        rate: successfulRenders / deliveryScenarios.length,
      }
    : null

  const remotionCommand = input.commandResults.find((result) => result.id === 'remotion_delivery')
  if (remotionCommand?.ok && !renderDelivery) {
    smokeFailures.push({
      source: 'smoke',
      id: remotionCommand.id,
      status: remotionCommand.status,
      stderr: 'Remotion delivery completed without a parseable scenario report.',
    })
  }

  return {
    failures: [...smokeFailures, ...turnFailures],
    renderScenarioCount: scenarios.length,
    renderDelivery,
  }
}
