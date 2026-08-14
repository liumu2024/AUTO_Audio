import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { v2TransitionDisplayText } from '@/lib/v2-timeline-ui'
import {
  buildV2PlanPresentation,
  resolveV2PlanSceneIdFromClip,
  v2DeliveryStateLabel,
  type V2PlanScenePresentation,
  type V2PlanVisibleText,
} from '@/services/director/v2DirectorDraftWorkspace'
import { useCreationStore } from '@/stores/creationStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

/** V2-only inspector for the editable timeline. */
export function PropertyEditorPanel() {
  return <V2TimelinePropertyInspector />
}

function V2TimelinePropertyInspector() {
  const spec = useV2TimelineStore((state) => state.spec)
  const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
  const updateSpec = useV2TimelineStore((state) => state.updateSpec)
  const setInputText = useCreationStore((state) => state.setInputText)
  const sceneId = spec ? resolveV2PlanSceneIdFromClip(spec, selectedClipId) : undefined
  const scene = sceneId ? spec?.scenes.find((item) => item.id === sceneId) : undefined
  const presentation = spec ? buildV2PlanPresentation(spec) : undefined
  const sceneFacts = sceneId ? presentation?.scenes.find((item) => item.id === sceneId) : undefined
  const selectedOverlayId = selectedClipId?.startsWith('v2-overlay-')
    ? selectedClipId.slice('v2-overlay-'.length)
    : undefined

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-5 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-violet-300" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">创作详情</h2>
            <p className="mt-0.5 text-[10px] text-zinc-500">查看模型计划，并记录不会自动执行的镜头备注</p>
          </div>
        </div>
        {!spec ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-500">尚未生成视频方案。</p>
        ) : !scene ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-relaxed text-zinc-500">选择一个画面、文字或转场片段查看模型计划。</p>
        ) : (
          <div className="space-y-4">
            <section className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
              <p className="text-sm font-semibold text-violet-100">{sceneFacts?.title ?? scene.id}</p>
              <p className="mt-1 font-mono text-[10px] text-violet-200/70">{scene.start_sec.toFixed(2)}s – {(scene.start_sec + scene.duration_sec).toFixed(2)}s</p>
            </section>
            <Detail label="镜头内容" value={sceneFacts?.description} />
            {sceneFacts ? <SceneFacts scene={sceneFacts} selectedOverlayId={selectedOverlayId} /> : null}
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">镜头备注（不会自动执行）</span>
              <Textarea value={scene.note ?? ''} placeholder="例如：保留主体，改为更克制的字幕和更慢的运镜" className="min-h-[96px] text-xs" onChange={(event) => updateSpec((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, note: event.target.value } : item) }))} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!scene.note?.trim()}
                onClick={() => setInputText(`请修改镜头“${sceneFacts?.title ?? scene.id}”：${scene.note?.trim()}。保留未提及内容不变。`)}
              >
                将备注带入对话
              </Button>
            </label>
          </div>
        )}
      </div>
    </aside>
  )
}

function SceneFacts({
  scene,
  selectedOverlayId,
}: {
  scene: V2PlanScenePresentation
  selectedOverlayId?: string
}) {
  return (
    <>
      <section className="space-y-1.5">
        <h3 className="text-[10px] font-medium text-zinc-500">视觉呈现</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Fact label="画面方式" value={sceneTypeLabel(scene.sceneType)} />
          <Fact label="镜头职责" value={visualRoleLabel(scene.visualRole)} />
          <Fact label="素材/生成" value={scene.sourceLabel} />
          <Fact label="交付状态" value={v2DeliveryStateLabel(scene.deliveryState)} />
          <Fact label="镜头运动" value={motionLabel(scene.motion)} />
        </div>
        {scene.materialPlan?.prompt ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-xs leading-relaxed text-zinc-300">
            {scene.materialPlan.prompt}
          </div>
        ) : null}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[10px] font-medium text-zinc-500">
          成片可见文字 / 字幕（{scene.visibleTexts.length} 段）
        </h3>
        {scene.visibleTexts.length ? (
          <div className="space-y-2">
            {scene.visibleTexts.map((item, index) => (
              <InspectorVisibleText
                key={item.id}
                item={item}
                index={index}
                selected={item.id === selectedOverlayId}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
            这个镜头目前没有可见字幕或标题。
          </div>
        )}
      </section>

      <Detail
        label="镜头衔接"
        value={
          scene.transitionAfter
            ? v2TransitionDisplayText(scene.transitionAfter)
            : '直接结束或硬切到下一镜头'
        }
      />
    </>
  )
}

function InspectorVisibleText({
  item,
  index,
  selected,
}: {
  item: V2PlanVisibleText
  index: number
  selected: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${selected ? 'border-amber-400/60 bg-amber-500/10' : 'border-zinc-800 bg-zinc-900/55'}`}>
      <p className="text-[10px] text-zinc-500">
        {index + 1}. {overlayTypeLabel(item.type)} · {item.startSec.toFixed(1)}s–{item.endSec.toFixed(1)}s
      </p>
      <p className="mt-1.5 text-xs leading-5 text-zinc-100">“{item.text}”</p>
      <p className="mt-1.5 text-[10px] text-zinc-500">
        入场动画：{animationLabel(item.enterAnimation)}
        {` · ${backgroundLabel(item.background)}`}
        {` · 位置 ${Math.round(item.xPct)}%, ${Math.round(item.yPct)}%`}
      </p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-2">
      <p className="text-[9px] text-zinc-500">{label}</p>
      <p className="mt-1 text-zinc-300">{value ?? '未指定'}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <section className="space-y-1.5"><h3 className="text-[10px] font-medium text-zinc-500">{label}</h3><div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-xs leading-relaxed text-zinc-300">{value}</div></section>
}

function sceneTypeLabel(type: V2PlanScenePresentation['sceneType']) {
  return {
    user_video: '用户视频',
    ai_video: 'AI 视频',
    image_motion: '图片动效',
    remotion_card: '程序化画面',
    caption_scene: '文字场景',
    data_viz: '数据可视化',
  }[type]
}

function visualRoleLabel(role: V2PlanScenePresentation['visualRole']) {
  if (!role) return undefined
  return {
    hook: '开场吸引',
    proof: '事实证明',
    feature: '重点内容',
    transition: '内容衔接',
    cta: '结尾行动',
  }[role]
}

function motionLabel(motion: V2PlanScenePresentation['motion']) {
  if (!motion) return undefined
  return {
    none: '固定画面',
    slow_zoom_in: '缓慢推近',
    slow_zoom_out: '缓慢拉远',
    pan_left: '向左平移',
    pan_right: '向右平移',
  }[motion]
}

function overlayTypeLabel(type: V2PlanVisibleText['type']) {
  return {
    caption: '字幕',
    title: '标题',
    label: '标签',
    shape: '图形',
    image_badge: '图片角标',
    light_sweep: '扫光效果',
  }[type]
}

function animationLabel(animation: V2PlanVisibleText['enterAnimation']) {
  return {
    none: '无入场动画',
    fade: '渐显',
    slide_up_fade: '上移渐显',
    pop: '弹出',
    pulse: '脉冲',
    sweep: '扫光',
  }[animation ?? 'none']
}

function backgroundLabel(background: string | undefined) {
  if (!background || background === 'transparent') return '背景：无'
  const match = background.match(/rgba\([^)]*,\s*([\d.]+)\)/)
  const alpha = match ? Number(match[1]) : 1
  if (alpha <= 0.02) return '背景：透明'
  if (alpha < 1) return `背景：半透明(${Math.round(alpha * 100)}%)`
  return '背景：实底'
}
