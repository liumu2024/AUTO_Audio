import path from 'node:path'

import { env } from '../../config/env.js'
import { agentTraceArtifactsDir, safeTracePathPart } from '../agent-trace/paths.js'

export function safeTaskId(taskId: string): string {
  return safeTracePathPart(taskId)
}

function resolveFromBackendCwd(relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(process.cwd(), relativeOrAbsolute)
}

export function effectDebugTaskDir(taskId: string): string {
  return agentTraceArtifactsDir(
    taskId,
    'effect_planning',
    resolveFromBackendCwd(env.effectDebugArtifactDir),
  )
}

export function remotionComponentAuthoringTaskDir(taskId: string): string {
  return agentTraceArtifactsDir(
    taskId,
    'component_authoring',
    resolveFromBackendCwd(env.remotionComponentAuthoringDebugDir),
  )
}
