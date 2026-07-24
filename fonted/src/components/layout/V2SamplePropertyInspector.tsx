import { SlidersHorizontal } from 'lucide-react'

import { v2SampleSegmentIdFromClipId } from '@/lib/v2-sample-ui'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <section className="space-y-1.5"><h3 className="text-[10px] font-medium text-zinc-500">{label}</h3><div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-xs leading-relaxed text-zinc-300">{value}</div></section>
}

/** Read-only V2 sample analysis details. It intentionally has no V1 store dependency. */
export function V2SamplePropertyInspector() {
  const session = useV2TimelineStore((state) => state.sampleSession)
  const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
  const segmentId = v2SampleSegmentIdFromClipId(selectedClipId)
  const segment = session?.understanding.segments.find((item) => item.id === segmentId)

  return <aside className="flex h-full min-h-0 w-full flex-col border-l border-zinc-800 bg-zinc-950 shadow-[-12px_0_32px_-12px_rgba(0,0,0,0.45)]"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-5 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-violet-300" /><div><h2 className="text-sm font-semibold text-zinc-100">样例解析详情</h2><p className="mt-0.5 text-[10px] text-zinc-500">仅展示模型理解，不会修改原片或生成方案</p></div></div>{!session ? <p className="text-xs text-zinc-500">尚未解析样例视频。</p> : !segment ? <div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-500">点击样例轨道中的片段，查看模型识别的画面、镜头、节奏与可复用边界。</div> : <div className="space-y-4"><section className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-3"><p className="text-sm font-semibold text-violet-100">{segment.title_zh}</p><p className="mt-1 font-mono text-[10px] text-violet-200/70">{segment.start_sec.toFixed(2)}s – {segment.end_sec.toFixed(2)}s</p></section><Detail label="画面内容" value={segment.visual_content_zh} /><Detail label="人物与主体" value={segment.characters_objects_zh} /><Detail label="镜头与运动" value={[segment.camera_zh, segment.motion_zh].filter(Boolean).join('；')} /><Detail label="氛围与节奏" value={[segment.atmosphere_zh, segment.rhythm_zh, segment.editing_zh].filter(Boolean).join('；')} /><Detail label="文字线索" value={segment.text_cues_zh} /><Detail label="后续转场" value={segment.transition_after_zh} /><Detail label="可复用创作要点" value={segment.reusable_style_zh} /><Detail label="素材建议" value={segment.material_hint_zh} /><Detail label="注意事项" value={segment.caution_zh} /></div>}</div></aside>
}
