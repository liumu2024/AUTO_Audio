import { Play } from 'lucide-react'
import { forwardRef, type ReactNode, useMemo } from 'react'

import { VideoPreviewFrame } from '@/components/canvas/VideoPreviewFrame'
import { env } from '@/config/env'
import { cn } from '@/lib/utils'
import {
  buildV2PlanPresentation,
  resolveV2PlanSceneIdFromClip,
  type V2PlanScenePresentation,
  type V2PlanVisibleText,
} from '@/services/director/v2DirectorDraftWorkspace'
import type { TimelineMode } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'

interface GeneratedPlayerProps {
  mode: TimelineMode
  onTimeUpdate: () => void
  onEnded: () => void
  onLoadedMetadata: (duration: number, source?: 'sample' | 'generated') => void
  onSeek: (time: number) => void
  onTogglePlay: () => void
}

/** V2 timeline preview and rendered output. */
export const GeneratedPlayer = forwardRef<HTMLVideoElement, GeneratedPlayerProps>(
  function GeneratedPlayer({ onTimeUpdate, onEnded, onLoadedMetadata, onSeek, onTogglePlay }, ref) {
    const currentTime = usePlaybackStore((state) => state.currentTime)
    const isPlaying = usePlaybackStore((state) => state.isPlaying)
    const spec = useV2TimelineStore((state) => state.spec)
    const preview = useV2TimelineStore((state) => state.preview)
    const result = useV2TimelineStore((state) => state.result)
    const selectedClipId = useV2TimelineStore((state) => state.selectedClipId)
    const selectClip = useV2TimelineStore((state) => state.selectClip)
    const outputUrl = result?.outputUrl ? `${env.apiBase}${result.outputUrl.startsWith('/') ? '' : '/'}${result.outputUrl}` : undefined
    const presentation = useMemo(
      () => spec ? buildV2PlanPresentation(spec, preview?.review.scenes) : undefined,
      [preview, spec],
    )
    const scenes = presentation?.scenes ?? []
    const selectedId = spec ? resolveV2PlanSceneIdFromClip(spec, selectedClipId) : undefined
    const active =
      scenes.find((scene) => scene.id === selectedId) ??
      scenes.find(
        (scene) =>
          currentTime >= scene.startSec &&
          currentTime < scene.startSec + scene.durationSec,
      ) ??
      scenes[0]

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <h3 className="shrink-0 text-sm font-medium tracking-tight text-zinc-200">
          {outputUrl ? 'V2 渲染成片' : 'V2 Timeline 方案'}
        </h3>
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 shadow-lg shadow-black/25')}>
          <div className="relative flex min-h-0 flex-1 flex-col p-4">
            {outputUrl ? (
              <VideoPreviewFrame className="min-h-0 flex-1">
                <div className="relative h-full w-full">
                  <video
                    ref={ref}
                    className="h-full w-full object-contain"
                    src={outputUrl}
                    preload="metadata"
                    playsInline
                    onTimeUpdate={onTimeUpdate}
                    onEnded={onEnded}
                    onLoadedMetadata={(event) =>
                      Number.isFinite(event.currentTarget.duration) &&
                      onLoadedMetadata(event.currentTarget.duration, 'generated')
                    }
                  />
                  {!isPlaying ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-900/40">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-violet-500/30 bg-zinc-800/90">
                        <Play className="h-7 w-7 fill-violet-300 text-violet-300" />
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0"
                    onClick={onTogglePlay}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  />
                </div>
              </VideoPreviewFrame>
            ) : (
              <V2PlanReview
                active={active}
                scenes={scenes}
                onSelect={(scene) => {
                  selectClip(`v2-scene-${scene.id}`)
                  onSeek(scene.startSec)
                }}
              />
            )}
          </div>
          <div className="shrink-0 border-t border-zinc-800/80 px-4 py-3 text-center text-[10px] text-zinc-600">
            {outputUrl ? '修改时间线后需重新渲染。' : '这是可审阅方案，尚未生成最终视频。'}
          </div>
        </div>
      </div>
    )
  },
)

function V2PlanReview({
  active,
  scenes,
  onSelect,
}: {
  active?: V2PlanScenePresentation
  scenes: V2PlanScenePresentation[]
  onSelect: (scene: V2PlanScenePresentation) => void
}) {
  if (!active) {
    return (
      <div className="min-h-0 flex-1 rounded-lg bg-zinc-950/80 p-4 text-sm text-zinc-500">
        当前方案没有可展示的镜头。
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden rounded-lg bg-zinc-950/80 p-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-zinc-100">{active.title}</h4>
            <FactBadge>{formatTimeRange(active.startSec, active.startSec + active.durationSec)}</FactBadge>
            <FactBadge>{sceneTypeLabel(active.sceneType)}</FactBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {active.description ?? '该镜头尚未填写创作说明。'}
          </p>
        </section>

        <PlanFactSection title="画面规划">
          <div className="grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
            <PlanFact label="画面方式" value={sceneTypeLabel(active.sceneType)} />
            <PlanFact label="镜头职责" value={visualRoleLabel(active.visualRole)} />
            <PlanFact label="素材来源" value={active.assetLabel ?? materialPlanLabel(active)} />
            <PlanFact label="镜头运动" value={motionLabel(active.motion)} />
          </div>
          {active.materialPlan?.prompt ? (
            <p className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs leading-5 text-zinc-400">
              生成画面要求：{active.materialPlan.prompt}
            </p>
          ) : null}
        </PlanFactSection>

        <PlanFactSection title={`成片可见文字 / 字幕（${active.visibleTexts.length} 段）`}>
          {active.visibleTexts.length ? (
            <div className="space-y-2">
              {active.visibleTexts.map((item, index) => (
                <VisibleTextRow key={item.id} item={item} index={index} />
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-500">
              这个镜头目前没有可见字幕或标题。
            </p>
          )}
        </PlanFactSection>

        <PlanFactSection title="镜头衔接">
          <p className="text-xs text-zinc-300">
            {active.transitionAfter
              ? `${transitionLabel(active.transitionAfter.type)} · ${active.transitionAfter.duration_sec}s${active.transitionAfter.direction ? ` · ${active.transitionAfter.direction}` : ''}`
              : '直接结束或硬切到下一镜头'}
          </p>
        </PlanFactSection>
      </div>

      <nav className="min-h-0 space-y-2 overflow-y-auto border-l border-zinc-800/80 pl-3" aria-label="方案镜头">
        <p className="sticky top-0 bg-zinc-950/95 pb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          全部镜头 · {scenes.length}
        </p>
        {scenes.map((scene, index) => (
          <button
            key={scene.id}
            type="button"
            className={cn(
              'w-full rounded-md border px-3 py-2 text-left text-xs transition-colors',
              active.id === scene.id
                ? 'border-violet-400/70 bg-violet-500/10 text-violet-100'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700',
            )}
            onClick={() => onSelect(scene)}
          >
            <span className="block font-medium">{index + 1}. {scene.title}</span>
            <span className="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>{formatTimeRange(scene.startSec, scene.startSec + scene.durationSec)}</span>
              <span>{scene.visibleTexts.length} 段文字</span>
            </span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function VisibleTextRow({ item, index }: { item: V2PlanVisibleText; index: number }) {
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
        <span className="font-medium text-amber-200">{index + 1}. {overlayTypeLabel(item.type)}</span>
        <span>{formatTimeRange(item.startSec, item.endSec)}</span>
        <span>{animationLabel(item.enterAnimation)}</span>
        {item.maxLines ? (
          <span>
            {item.maxLinesSource === 'track_default' ? '方案轨道设置（可修改）' : '本段设置'}：最多 {item.maxLines} 行
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-5 text-zinc-100">“{item.text}”</p>
    </div>
  )
}

function PlanFactSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h5 className="mb-2 text-[11px] font-medium text-zinc-500">{title}</h5>
      {children}
    </section>
  )
}

function PlanFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/55 p-2">
      <span className="text-zinc-500">{label}：</span>
      <span>{value ?? '未指定'}</span>
    </div>
  )
}

function FactBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400">{children}</span>
}

function formatTimeRange(startSec: number, endSec: number) {
  return `${startSec.toFixed(1)}s – ${endSec.toFixed(1)}s`
}

function sceneTypeLabel(type: V2PlanScenePresentation['sceneType']) {
  return {
    user_video: '用户视频',
    ai_video: 'AI 视频',
    image_motion: '图片动效',
    remotion_card: 'Remotion 程序化画面',
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

function materialPlanLabel(scene: V2PlanScenePresentation) {
  if (!scene.materialPlan) return 'Remotion 直接编排'
  return {
    reuse_asset: '复用已有素材',
    generate_video: '计划生成 AI 视频',
    request_user_material: '等待用户素材',
  }[scene.materialPlan.type]
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

function transitionLabel(type: NonNullable<V2PlanScenePresentation['transitionAfter']>['type']) {
  return {
    cut: '硬切',
    fade: '淡化',
    slide: '滑动',
    wipe: '擦除',
    light_flash: '闪光',
  }[type]
}
