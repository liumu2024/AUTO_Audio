import path from 'node:path'

import { env } from '../../config/env.js'
import type { AgentTracePhase } from '../../../../shared/types/agent-trace.v1.js'

export function safeTracePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

export function resolveAgentTraceBaseDir(baseDir = env.agentTraceDir): string {
  return path.isAbsolute(baseDir) ? baseDir : path.resolve(process.cwd(), baseDir)
}

export function agentTraceTaskDir(taskId: string, baseDir = env.agentTraceDir): string {
  return path.join(resolveAgentTraceBaseDir(baseDir), safeTracePathPart(taskId))
}

export function agentTraceArtifactsDir(
  taskId: string,
  phase: AgentTracePhase,
  baseDir = env.agentTraceDir,
): string {
  return path.join(agentTraceTaskDir(taskId, baseDir), 'artifacts', safeTracePathPart(phase))
}

export function toAgentTraceRelativePath(
  taskId: string,
  absolutePath: string,
  baseDir = env.agentTraceDir,
): string {
  const relative = path.relative(agentTraceTaskDir(taskId, baseDir), absolutePath)
  return relative.split(path.sep).join('/')
}
