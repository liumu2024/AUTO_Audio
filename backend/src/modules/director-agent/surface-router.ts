import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorContext } from '../../../../shared/types/director-context.js'
import type { DirectorSurfaceMode } from '../../../../shared/types/director-stream.js'

export interface DirectorSurfaceRouteInput {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
}

export interface DirectorSurfaceRoute {
  mode: DirectorSurfaceMode
  confidence: number
  shouldRunIntentRouter: boolean
  directMessage?: string
  publicThoughts?: string[]
}

export function routeConversationSurface(
  input: DirectorSurfaceRouteInput,
): DirectorSurfaceRoute {
  const prompt = input.prompt.trim()

  if (!prompt) {
    if (input.context.materials.length || input.context.sampleVideo) {
      return {
        mode: 'task',
        confidence: 0.86,
        shouldRunIntentRouter: true,
        publicThoughts: ['本轮包含素材，会结合素材判断用户希望讨论、分析还是创建方案。'],
      }
    }
    return {
      mode: 'help',
      confidence: 0.85,
      shouldRunIntentRouter: true,
      publicThoughts: ['收到空输入，会结合当前上下文判断下一步，而不是直接触发生成。'],
    }
  }

  return {
    mode: 'unknown',
    confidence: 0.5,
    shouldRunIntentRouter: true,
    publicThoughts: ['会结合当前输入和项目上下文判断这是讨论、澄清还是需要执行的创作任务。'],
  }
}
