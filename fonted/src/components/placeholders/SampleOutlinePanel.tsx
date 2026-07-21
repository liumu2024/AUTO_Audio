import { usePipelineStore } from '@/stores/pipelineStore'

import { OutlineWidget } from '@/components/sidebar/OutlineWidget'

/** @deprecated 结构拆解已嵌入 AI 导演助理对话流；保留供独立引用 */
export function SampleOutlinePanel() {
  const outline = usePipelineStore((s) => s.bundle?.outline)

  if (!outline?.length) {
    return (
      <p className="text-xs text-zinc-600">
        在 AI 导演助理中上传样例并发送指令，拆解大纲将出现在对话流中。
      </p>
    )
  }

  return <OutlineWidget outline={outline} />
}
