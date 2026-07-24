import { directorActionFromIntentResult } from '../../../../shared/lib/director-action-engine.js'
import { routeDirectorIntentWithLlm } from './llm-intent-router.js'
import { routeConversationSurface } from './surface-router.js'
import type {
  DirectorAgentChatRequest,
  DirectorAgentStreamEvent,
} from './director-agent.types.js'

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function materialLabel(count: number, hasVisualMaterial: boolean) {
  if (!count) return '没有创作素材'
  if (!hasVisualMaterial) return `收到 ${count} 个素材，但缺少可用于画面的图片或视频`
  return `收到 ${count} 个候选创作素材`
}

function sampleLabel(input: DirectorAgentChatRequest) {
  if (input.runtime.isSampleParsed) return '样例视频已完成结构和风格解析'
  if (input.runtime.sampleUrl) return '样例视频已上传，尚未解析'
  return '尚未上传样例视频'
}

function actionLabel(type: string) {
  const labels: Record<string, string> = {
    ANALYZE_SAMPLE: '解析样例视频',
    ANALYZE_MATERIALS: '分析创作素材',
    GENERATE_TIMELINE: '生成 V2 时间线方案',
    REVISE_TIMELINE: '修改当前时间线方案',
    RENDER_VIDEO: '提交 V2 渲染',
    ASK_USER: '回复并等待用户补充',
    REQUEST_PLUGIN: '记录缺失 Remotion 能力',
  }
  return labels[type] ?? type
}

export async function* streamDirectorAgentChat(
  input: DirectorAgentChatRequest,
): AsyncGenerator<DirectorAgentStreamEvent> {
  const surface = routeConversationSurface(input)

  yield {
    type: 'surface',
    mode: surface.mode,
    confidence: surface.confidence,
    shouldRunIntentRouter: surface.shouldRunIntentRouter,
    directMessage: surface.directMessage,
  }
  await wait(10)

  for (const thought of surface.publicThoughts ?? []) {
    yield {
      type: 'thought',
      title: '对话入口',
      content: thought,
    }
    await wait(15)
  }

  yield {
    type: 'thought',
    title: '读取上下文',
    content: `${sampleLabel(input)}；${materialLabel(
      input.runtime.materialCount,
      input.runtime.hasVisualMaterial,
    )}；当前画幅 ${input.context.slots.aspectRatio}。`,
  }
  await wait(20)

  yield {
    type: 'thought',
    title: '区分样例和素材',
    content:
      '样例视频只作为结构、节奏和风格来源；reference materials 才是成片候选素材。',
  }
  await wait(20)

  const routed = await routeDirectorIntentWithLlm(input)
  for (const thought of routed.publicThoughts) {
    yield {
      type: 'thought',
      title:
        routed.source === 'context_fallback'
          ? '上下文保留'
          : routed.source === 'llm_unstructured_safe_reply'
            ? '自由回复'
            : '导演判断',
      content: thought,
    }
    await wait(20)
  }

  const action = directorActionFromIntentResult({
    prompt: input.prompt,
    context: input.context,
    runtime: input.runtime,
    result: routed.result,
  })
  const shouldExecute =
    routed.result.executionEffect !== undefined &&
    routed.result.executionEffect !== 'none' &&
    action.type !== 'ASK_USER'

  yield {
    type: 'intent',
    intent: action.result.intent,
    confidence: action.result.confidence,
    contentDomain: action.result.contentDomain,
    source: routed.source,
  }
  await wait(15)

  yield {
    type: 'slot_update',
    slots: action.slots,
    missingSlots: action.payload?.missingSlots ?? [],
  }
  await wait(15)

  if (shouldExecute) {
    yield {
      type: 'thought',
      title: '执行建议',
      content: `${actionLabel(action.type)}。${action.message}`,
    }
    await wait(15)

    yield {
      type: 'action_plan',
      action,
    }
    await wait(5)

    if (input.context.directorState) {
      yield {
        type: 'state_update',
        state: input.context.directorState,
      }
      await wait(5)
    }

    yield {
      type: 'done',
      action,
    }
    return
  }

  yield {
    type: 'done',
    message: routed.result.assistantMessage,
  }
}
