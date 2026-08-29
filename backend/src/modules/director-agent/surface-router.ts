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

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
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

  const discussionPatterns = [
    /是什么意思|这种说法|这句话|如何理解|会有什么(?:风险|问题)|有何(?:风险|问题)|(?:是否|更)?(?:自然|合适|合理|靠谱)吗/u,
  ]
  const actionPatterns = [
    /(?:帮我|替我|直接|按照|按(?:照)?(?:你的|这个|上述|这些)?(?:建议|方案|要求)?|基于这些要求|然后|顺便)[^。！？\n]{0,24}(?:创建|生成|制作|修改|调整|改成|渲染|导出|执行|做(?:个|一版|一个)?(?:视频|方案))/u,
    /^(?:(?:请|现在|直接|麻烦)(?:帮我)?[，,\s]*)?(?:创建|生成|制作|修改|调整|改成|渲染|导出|执行|做(?:个|一版|一个)?(?:视频|方案))/u,
    /^(?:(?:请|现在|直接|麻烦)[，,\s]*)?(?:把|将).{1,60}(?:改成|修改|调整|替换|删除|去掉|设为)/u,
    /^(?:(?:请|现在|直接|麻烦)[，,\s]*)?采用.{1,60}(?:方案|版本|文案|风格)/u,
    /\b(?:please|now|directly|then|also)\b[^.!?\n]{0,40}\b(?:create|generate|make|revise|change|render|export|execute)\b/iu,
  ]
  const discussesActionWording = hasAny(prompt, discussionPatterns)
  const asksForGuidance = discussesActionWording || hasAny(prompt, [
    /有什么.{0,12}建议|有何.{0,12}建议|给.{0,12}建议|(?:请|能否|能不能|你能|可以|可否|麻烦|帮忙|帮我).{0,8}推荐|(?:有什么|有何).{0,8}推荐|推荐(?:几|一|哪|什么|适合|可选|一下|吗)|如何(?:做|设计|安排|选择)|怎么(?:做|设计|安排|选择)|思路|你觉得|你认为|would you suggest|(?:can|could) you recommend|what do you recommend|how should/i,
  ])
  const explicitlyRequestsAction = prompt
    .split(/[。！？!?；;，,\n]+/u)
    .some((clause) => clause.trim()
      && !hasAny(clause, discussionPatterns)
      && hasAny(clause, actionPatterns))
  if (asksForGuidance && !explicitlyRequestsAction) {
    return {
      mode: 'creative_guide',
      confidence: 0.9,
      shouldRunIntentRouter: true,
      publicThoughts: ['这是创作咨询，会先回答问题，不自动创建或修改方案。'],
    }
  }

  if (
    hasAny(prompt, [
      /改成|不要|去掉|保留|换成|采用|更|字幕|画幅|比例|音乐|音频|adjust|change|revise/i,
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
    explicitlyRequestsAction || hasAny(prompt, [
      /解析|拆解|理解|分析|视频结构|创作手法|生成|成片|渲染|导出|素材|样例|remotion|render|export|generate/i,
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

  const isSmalltalk = hasAny(prompt, [
    /^(?:你好|您好|嗨|哈喽|早上好|下午好|晚上好|谢谢|多谢|再见|拜拜)[呀啊哦！!。,.，\s]*$/u,
    /^(?:hi|hello|hey|thanks|thank you|bye)[!.,\s]*$/iu,
  ])
  return {
    mode: isSmalltalk ? 'smalltalk' : 'unknown',
    confidence: isSmalltalk ? 0.9 : 0.55,
    shouldRunIntentRouter: true,
    publicThoughts: ['这不是明确命令，会让意图模型结合上下文判断是否追问。'],
  }
}
