export const manifest = {
  id: 'v2-render-delivery',
  version: '1.1.0',
  card: '超出预置集的效果（自定义滤镜、合成、动画、转场）：由导演模型自行生成沙箱化组件源码并通过 render.author 提交注册（不得要求用户提供源码），再在 timeline 的 custom_render 引用；检查当前 V2 草稿、授权与交付条件后提交正式渲染。',
  stage: 'delivery',
  tools: ['render.author', 'timeline.render'],
  dependencies: ['official.remotion-render'],
  prerequisites: ['当前 V2 草稿与修订版本', '本轮导演模型确认的交付意图'],
  requiredFacts: ['draftId', 'revision', '结构校验状态'],
  outputRequirements: ['返回实际渲染结果和 trace，不预告成功'],
  validation: ['草稿版本一致', '只读取 V2 状态', '交付 Tool 使用 execute 模式'],
  recovery: '保留草稿和失败原因，修复后由用户重新确认交付。',
} as const
