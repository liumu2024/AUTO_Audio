import { SlidersHorizontal } from 'lucide-react'

import { V2SamplePropertyInspector } from '@/components/layout/V2SamplePropertyInspector'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore } from '@/stores/editorStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

/** V2-only inspector. Sample facts are read-only; timeline scene text stays editable. */
export function PropertyEditorPanel() {
  const mode = useEditorStore((state) => state.timelineMode)
  if (mode === 'sample') return <V2SamplePropertyInspector />
  return <V2TimelinePropertyInspector />
}

function V2TimelinePropertyInspector() {
  const spec = useV2TimelineStore((state) => state.spec)
  const preview = useV2TimelineStore((state) => state.preview)
  const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
  const updateSpec = useV2TimelineStore((state) => state.updateSpec)
  const sceneId = selectedClipId?.replace(/^v2-(?:scene|overlay|transition)-/, '')
  const scene = sceneId ? spec?.scenes.find((item) => item.id === sceneId) : undefined
  const review = sceneId ? preview?.review.scenes.find((item) => item.id === sceneId) : undefined

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-5 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-violet-300" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">V2 创作详情</h2>
            <p className="mt-0.5 text-[10px] text-zinc-500">查看模型计划，并补充本镜头的修改要求</p>
          </div>
        </div>
        {!spec ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-500">尚未生成 V2 Timeline 方案。</p>
        ) : !scene ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-500">选择一个画面、文字或转场片段查看模型计划。</p>
        ) : (
          <div className="space-y-4">
            <section className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
              <p className="text-sm font-semibold text-violet-100">{scene.creative_intent?.title ?? scene.title ?? scene.id}</p>
              <p className="mt-1 font-mono text-[10px] text-violet-200/70">{scene.start_sec.toFixed(2)}s – {(scene.start_sec + scene.duration_sec).toFixed(2)}s</p>
            </section>
            <Detail label="模型创作说明" value={scene.creative_intent?.description ?? scene.body ?? review?.description_zh ?? review?.source_zh} />
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">我的修改要求</span>
              <Textarea value={scene.note ?? ''} placeholder="例如：保留主体，改为更克制的字幕和更慢的运镜" className="min-h-[96px] text-xs" onChange={(event) => updateSpec((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, note: event.target.value } : item) }))} />
            </label>
            <Detail label="模型预览" value={review?.description_zh ?? review?.source_zh} />
            <Detail label="镜头运动" value={review?.motion_zh} />
            <Detail label="素材使用" value={review?.material_usage_zh ?? review?.asset_label_zh} />
            <Detail label="字幕/文字" value={review?.overlay_texts_zh?.join(' / ')} />
          </div>
        )}
      </div>
    </aside>
  )
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <section className="space-y-1.5"><h3 className="text-[10px] font-medium text-zinc-500">{label}</h3><div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-xs leading-relaxed text-zinc-300">{value}</div></section>
}
