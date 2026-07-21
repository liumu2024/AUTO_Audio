import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorContext } from '../../../../shared/types/director-context.js'

export type DirectorSurfaceMode =
  | 'smalltalk'
  | 'help'
  | 'capability_intro'
  | 'creative_guide'
  | 'task'
  | 'edit'
  | 'repair'
  | 'unknown'

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

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

export function routeConversationSurface(
  input: DirectorSurfaceRouteInput,
): DirectorSurfaceRoute {
  const prompt = input.prompt.trim()

  if (!prompt) {
    return {
      mode: 'help',
      confidence: 0.85,
      shouldRunIntentRouter: true,
      publicThoughts: ['收到空输入，会结合当前上下文判断下一步，而不是直接触发生成。'],
    }
  }

  if (
    hasAny(prompt, [
      /失败|报错|崩|为什么不行|为什么失败|error|failed|bug/i,
    ])
  ) {
    return {
      mode: 'repair',
      confidence: 0.9,
      shouldRunIntentRouter: true,
      publicThoughts: ['检测到问题排查语气，会优先解释状态和修复路径。'],
    }
  }

  if (
    hasAny(prompt, [
      /改成|不要|去掉|保留|换成|更|字幕|画幅|比例|音乐|音频|adjust|change|revise/i,
    ])
  ) {
    return {
      mode: 'edit',
      confidence: 0.82,
      shouldRunIntentRouter: true,
      publicThoughts: ['检测到编辑意图，会检查当前是否已有可修改的方案。'],
    }
  }

  if (
    hasAny(prompt, [
      /解析|拆解|理解|生成|成片|渲染|导出|素材|样例|remotion|render|export|generate/i,
    ])
  ) {
    return {
      mode: 'task',
      confidence: 0.9,
      shouldRunIntentRouter: true,
      publicThoughts: ['检测到视频任务意图，会进入导演意图路由。'],
    }
  }

  if (
    hasAny(prompt, [/你是什么|你是谁|你能做什么|介绍一下|你的作用|who are you|what are you/i])
  ) {
    return {
      mode: 'capability_intro',
      confidence: 0.9,
      shouldRunIntentRouter: true,
      publicThoughts: ['这是能力咨询，我会用当前项目上下文回答。'],
    }
  }

  if (
    hasAny(prompt, [/怎么做|如何做|方案|思路|建议/]) &&
    hasAny(prompt, [/风景|风光|旅拍|混剪|自然|日落|山水|海边/])
  ) {
    return {
      mode: 'creative_guide',
      confidence: 0.86,
      shouldRunIntentRouter: true,
      publicThoughts: ['这是创作咨询，会给出可执行的剪辑/生成流程。'],
    }
  }

  return {
    mode: prompt.length <= 12 ? 'smalltalk' : 'unknown',
    confidence: prompt.length <= 12 ? 0.68 : 0.55,
    shouldRunIntentRouter: true,
    publicThoughts: ['这不是明确命令，会让意图模型结合上下文判断是否追问。'],
  }
}
