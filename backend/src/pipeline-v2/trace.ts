import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface V2TraceWriter {
  taskId: string
  rootDir: string
  writeJson(stage: string, fileName: string, payload: unknown): Promise<string>
  writeText(stage: string, fileName: string, content: string): Promise<string>
  writeSummary(lines: string[]): Promise<string>
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

export function createV2TraceWriter(input: {
  taskId: string
  baseDir?: string
  cwd?: string
}): V2TraceWriter {
  const cwd = input.cwd ?? process.cwd()
  // A test process may set this once so every V2 trace it triggers shares one
  // named session folder. Production callers keep the established default.
  const configuredBaseDir = process.env.V2_TRACE_BASE_DIR?.trim()
  const baseDir = input.baseDir ?? configuredBaseDir ?? 'tmp/v2-agent-trace'
  const rootDir = path.join(
    path.isAbsolute(baseDir) ? baseDir : path.resolve(cwd, baseDir),
    safePart(input.taskId),
  )

  async function write(stage: string, fileName: string, content: string): Promise<string> {
    const dir = path.join(rootDir, safePart(stage))
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, fileName)
    await writeFile(filePath, content, 'utf8')
    return filePath
  }

  return {
    taskId: input.taskId,
    rootDir,
    writeJson: (stage, fileName, payload) =>
      write(stage, fileName, `${JSON.stringify(payload, null, 2)}\n`),
    writeText: (stage, fileName, content) => write(stage, fileName, content),
    writeSummary: (lines) => write('00-summary', 'summary.zh.md', `${lines.join('\n')}\n`),
  }
}
