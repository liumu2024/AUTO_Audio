import { mkdir } from 'node:fs/promises'
import path from 'node:path'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

const suiteName = argument('--suite') ?? 'core.v2'
const explicitSuiteFile = argument('--suite-file')
const runs = Number(argument('--runs') ?? 1)
const caseIds = (argument('--case') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const regradeFile = argument('--regrade')
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error('--runs must be a positive integer.')
}

const outputDir = path.resolve(
  argument('--output')
    ?? (regradeFile
      ? path.dirname(regradeFile)
      : path.join('tmp', 'v2-agent-evaluations', `${suiteName}_${timestamp()}`)),
)
const localDataDir = path.join(outputDir, 'local-data')
const traceDir = path.join(outputDir, 'traces')

await mkdir(outputDir, { recursive: true })
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = localDataDir
process.env.V2_DIRECTOR_SESSION_DIR = path.join(localDataDir, 'director-sessions')
process.env.V2_TRACE_BASE_DIR = traceDir
process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.ENABLE_AGENT_TRACE = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'false'
process.env.V2_VIDEO_GENERATION_PROVIDER = 'none'

const evaluation = await import('../src/evaluation-v2/agent-evaluation.js')
const suiteFile = explicitSuiteFile
  ? path.resolve(explicitSuiteFile)
  : path.resolve('evals', 'v2-agent', `${suiteName}.json`)
const report = regradeFile
  ? await evaluation.regradeV2AgentEvaluation({
      reportFile: path.resolve(regradeFile),
      suiteFile,
    })
  : await evaluation.runV2AgentEvaluation({
      suiteFile,
      outputDir,
      runs,
      caseIds,
    })

console.log(JSON.stringify({
  report: path.join(outputDir, 'report.md'),
  turns: report.summary.turns,
  deterministicPassed: report.summary.deterministicPassed,
  releaseBlocked: report.summary.releaseBlocked,
}, null, 2))
