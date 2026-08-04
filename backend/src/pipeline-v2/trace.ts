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

const appendQueues = new Map<string, Promise<void>>()

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

export function createV2TraceWriter(input: {
  taskId: string
  baseDir?: string
  cwd?: string
  sessionId?: string
  operationId?: string
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
  const rootDir = sessionRootDir
    ? path.join(sessionRootDir, 'operations', safePart(operationId))
    : path.join(resolvedBaseDir, 'tasks', safePart(input.taskId))

  async function write(stage: string, fileName: string, content: string): Promise<string> {
    const dir = path.join(rootDir, safePart(stage))
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, fileName)
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
