import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface V2TraceWriter {
  taskId: string
  rootDir: string
  sessionRootDir?: string
  operationId?: string
  writeJson(stage: string, fileName: string, payload: unknown): Promise<string>
  writeText(stage: string, fileName: string, content: string): Promise<string>
  writeSummary(lines: string[]): Promise<string>
  appendSessionEvent(payload: Record<string, unknown>): Promise<string>
}

export interface V2TraceContext {
  sessionId: string
  operationId: string
}

export type V2TraceMode = 'compact' | 'verbose'

const appendQueues = new Map<string, Promise<void>>()

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

const compactTraceFiles = [
  /^turn-input\.json$/,
  /^creative-(?:memory|knowledge)-retrieval\.json$/,
  /^model-call\.json$/,
  /^skill-tool-execution-plan\.json$/,
  /^tool-.+\.json$/,
  /^turn-result\.json$/,
  /^timeline-planner-input\.json$/,
  /^planning-decision\.json$/,
  /^timeline-revision-fragment\.json$/,
  /^timeline-(?:outcome-review|outcome-correction-review)\.json$/,
  /^timeline-(?:spec|validation)\.json$/,
  /^revision-(?:diff|preservation)\.json$/,
  /^timeline-review\.json$/,
  /^sample-understanding-input\.json$/,
  /^audio-visual-hints\.json$/,
  /^sample-understanding\.json$/,
  /^creative-learning\.json$/,
  /^timeline-material-resolution\.json$/,
  /^delivery-readiness\.json$/,
  /^timeline-standardized-assets\.json$/,
  /^timeline-render-validation\.json$/,
  /^timeline-render-result\.json$/,
  /^timeline-evaluation\.json$/,
]

function shouldWriteCompactTrace(fileName: string): boolean {
  return /(?:error|failure|repair|diagnostic)/i.test(fileName)
    || compactTraceFiles.some((pattern) => pattern.test(fileName))
}

export function createV2TraceWriter(input: {
  taskId: string
  baseDir?: string
  cwd?: string
  sessionId?: string
  operationId?: string
  mode?: V2TraceMode
}): V2TraceWriter {
  const cwd = input.cwd ?? process.cwd()
  // A test process may set this once so every V2 trace it triggers shares one
  // named session folder. Production callers keep the established default.
  const configuredBaseDir = process.env.V2_TRACE_BASE_DIR?.trim()
  const baseDir = input.baseDir ?? configuredBaseDir ?? 'tmp/v2-traces'
  const resolvedBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(cwd, baseDir)
  const sessionRootDir = input.sessionId
    ? path.join(resolvedBaseDir, 'sessions', safePart(input.sessionId))
    : undefined
  const operationId = input.operationId ?? input.taskId
  const mode = input.mode ?? (process.env.V2_TRACE_MODE === 'verbose' ? 'verbose' : 'compact')
  const rootDir = sessionRootDir
    ? path.join(sessionRootDir, 'operations', safePart(operationId))
    : path.join(resolvedBaseDir, 'tasks', safePart(input.taskId))

  async function write(stage: string, fileName: string, content: string): Promise<string> {
    const dir = path.join(rootDir, safePart(stage))
    const filePath = path.join(dir, fileName)
    if (mode === 'compact' && !shouldWriteCompactTrace(fileName)) return filePath
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, content, 'utf8')
    return filePath
  }

  async function appendSessionEvent(payload: Record<string, unknown>): Promise<string> {
    const eventRoot = sessionRootDir ?? rootDir
    await mkdir(eventRoot, { recursive: true })
    if (sessionRootDir) {
      await writeFile(path.join(sessionRootDir, 'session.json'), `${JSON.stringify({
        schema_version: 'v2_trace_session.v1',
        session_id: input.sessionId,
        event_stream: 'events.jsonl',
        operation_layout: 'operations/<operation-id>/',
      }, null, 2)}\n`, 'utf8')
    }
    const filePath = path.join(eventRoot, 'events.jsonl')
    const line = `${JSON.stringify({
      at: new Date().toISOString(),
      task_id: input.taskId,
      operation_id: operationId,
      ...payload,
    })}\n`
    const previous = appendQueues.get(filePath) ?? Promise.resolve()
    const pending = previous.then(() => appendFile(filePath, line, 'utf8'))
    appendQueues.set(filePath, pending)
    try {
      await pending
    } finally {
      if (appendQueues.get(filePath) === pending) appendQueues.delete(filePath)
    }
    return filePath
  }

  return {
    taskId: input.taskId,
    rootDir,
    sessionRootDir,
    operationId,
    writeJson: (stage, fileName, payload) =>
      write(stage, fileName, `${JSON.stringify(payload, null, 2)}\n`),
    writeText: (stage, fileName, content) => write(stage, fileName, content),
    writeSummary: (lines) => write('00-summary', 'summary.zh.md', `${lines.join('\n')}\n`),
    appendSessionEvent,
  }
}
