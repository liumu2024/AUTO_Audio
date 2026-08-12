import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { rescoreEvaluationReport } from './run.js'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const reportFile = argument('--report')
  const ratingsFile = argument('--ratings')
  if (!reportFile || !ratingsFile) throw new Error('Usage: --report <report.json> --ratings <ratings.json> [--dataset <dataset.json>] [--output <dir>]')
  const resolvedReport = path.resolve(reportFile)
  const result = await rescoreEvaluationReport({
    reportFile: resolvedReport,
    ratingsFile: path.resolve(ratingsFile),
    frozenFile: path.resolve(argument('--dataset') ?? path.join(path.dirname(resolvedReport), 'dataset.json')),
    outputDir: path.resolve(argument('--output') ?? path.join(path.dirname(resolvedReport), 'scored')),
  })
  console.log(JSON.stringify({ output: path.resolve(argument('--output') ?? path.join(path.dirname(resolvedReport), 'scored')), manualScoring: result.manualScoring }, null, 2))
  if (result.releaseBlocked || result.failures.length) process.exitCode = 1
}
