import { Play, Volume2 } from 'lucide-react'
import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import type {
  OverlayLayer,
  RenderAsset,
  RenderPlanV1,
  RenderScene,
  VisualLayer,
} from '@/types/render-plan'

interface RenderPlanPreviewProps {
  plan: RenderPlanV1
  currentTime: number
  isPlaying: boolean
  onTogglePlay: () => void
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function activeSceneAt(plan: RenderPlanV1, currentTime: number) {
  return (
    plan.scenes.find(
      (scene) => currentTime >= scene.start_sec && currentTime < scene.end_sec,
    ) ??
    plan.scenes[plan.scenes.length - 1] ??
    null
  )
}

function getAsset(assets: RenderAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

function visualTransform(
  visual: VisualLayer,
  progress: number,
  isPlaying: boolean,
) {
  const intensity = visual.motion?.intensity ?? 0
  switch (visual.motion?.preset) {
    case 'zoom_in':
    case 'push_in':
      return `scale(${1 + intensity * 0.14 * progress})`
    case 'pan':
      return `scale(1.08) translateX(${(progress - 0.5) * intensity * 8}%)`
    case 'shake': {
      const wave = isPlaying ? Math.sin(progress * Math.PI * 18) : 0
      return `scale(1.04) translateX(${wave * intensity * 10}px)`
    }
    default:
      return 'scale(1)'
  }
}

function overlayStyle(overlay: OverlayLayer, currentTime: number) {
  const enter = clamp01((currentTime - overlay.start_sec) / 0.28)
  const leave = clamp01((overlay.end_sec - currentTime) / 0.22)
  const visibility = Math.min(enter, leave)
  const pulse =
    overlay.animation.emphasis === 'scale_pulse'
      ? 1 + Math.sin(currentTime * Math.PI * 3) * 0.035
      : 1
  const shake =
    overlay.animation.emphasis === 'shake'
      ? Math.sin(currentTime * Math.PI * 16) * 5
      : 0

  return {
    opacity: visibility,
    transform: `translateX(${shake}px) scale(${(0.92 + visibility * 0.08) * pulse})`,
    color: overlay.style.color,
    WebkitTextStroke: overlay.style.stroke
      ? `1.5px ${overlay.style.stroke}`
      : undefined,
    textShadow: overlay.style.shadow
      ? '0 12px 28px rgba(0,0,0,0.45)'
      : undefined,
    fontSize: `clamp(22px, ${overlay.style.font_size / 13}vw, ${overlay.style.font_size}px)`,
    fontWeight:
      overlay.style.font_weight === 'black'
        ? 900
        : overlay.style.font_weight === 'bold'
          ? 800
          : 500,
    maxWidth: `${overlay.layout.max_width_pct}%`,
  } as const
}

function overlayPositionClass(position: OverlayLayer['layout']['position']) {
  if (position === 'top') return 'items-start justify-center pt-[12%]'
  if (position === 'bottom') return 'items-end justify-center pb-[12%]'
  if (position === 'left') return 'items-center justify-start pl-[8%]'
  if (position === 'right') return 'items-center justify-end pr-[8%]'
  return 'items-center justify-center'
}

function SceneVisual({
  scene,
  asset,
  progress,
  isPlaying,
}: {
  scene: RenderScene
  asset?: RenderAsset
  progress: number
  isPlaying: boolean
}) {
  const transform = visualTransform(scene.visual, progress, isPlaying)
  const objectFit = scene.visual.fit === 'contain' ? 'contain' : 'cover'

  if (asset?.type === 'image') {
    return (
      <img
        src={asset.url}
        alt={asset.name}
        className="h-full w-full"
        style={{ transform, objectFit }}
      />
    )
  }

  if (asset?.type === 'video' || asset?.type === 'generated_video') {
    return (
      <video
        key={asset.id}
        src={asset.url}
        className="h-full w-full"
        muted
        playsInline
        loop
        autoPlay={isPlaying}
        style={{ transform, objectFit }}
      />
    )
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[#161616] px-10 text-center"
      style={{ transform }}
    >
      <div className="max-w-[82%]">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-300">
          {scene.role}
        </p>
        <p className="mt-4 text-3xl font-black leading-tight text-zinc-50">
          {scene.visual.visual_prompt}
        </p>
      </div>
    </div>
  )
}

export function RenderPlanPreview({
  plan,
  currentTime,
  isPlaying,
  onTogglePlay,
}: RenderPlanPreviewProps) {
  const scene = useMemo(() => activeSceneAt(plan, currentTime), [plan, currentTime])
  const asset = getAsset(plan.assets, scene?.visual.asset_id)

  if (!scene) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        RenderPlan 暂无可预览段落
      </div>
    )
  }

  const sceneDuration = Math.max(0.01, scene.end_sec - scene.start_sec)
  const sceneProgress = clamp01((currentTime - scene.start_sec) / sceneDuration)
  const overlays = scene.overlays.filter(
    (overlay) => currentTime >= overlay.start_sec && currentTime <= overlay.end_sec,
  )
  const activeAudio = scene.audio.find(
    (audio) =>
      currentTime >= audio.start_sec &&
      currentTime <= (audio.end_sec ?? scene.end_sec),
  )

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-zinc-950">
      <SceneVisual
        scene={scene}
        asset={asset}
        progress={sceneProgress}
        isPlaying={isPlaying}
      />

      {overlays.map((overlay) => (
        <div
          key={overlay.id}
          className={cn(
            'pointer-events-none absolute inset-0 flex px-6 text-center',
            overlayPositionClass(overlay.layout.position),
          )}
        >
          <div
            className={cn(
              'rounded-md px-4 py-2 leading-[1.05] transition-opacity duration-100',
              overlay.style.background ? 'shadow-2xl' : '',
            )}
            style={{
              ...overlayStyle(overlay, currentTime),
              background: overlay.style.background,
            }}
          >
            {overlay.text}
          </div>
        </div>
      ))}

      {activeAudio ? (
        <div className="absolute left-3 top-3 flex max-w-[72%] items-center gap-2 rounded-md border border-zinc-700/80 bg-zinc-950/85 px-2.5 py-1.5 text-xs text-zinc-300 shadow-lg backdrop-blur">
          <Volume2 className="h-3.5 w-3.5 text-teal-300" />
          <span className="truncate">
            {activeAudio.emotion_vibe ?? 'BGM'} · {activeAudio.sfx_type ?? activeAudio.type}
          </span>
        </div>
      ) : null}

      {!isPlaying ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/30">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-teal-300/30 bg-zinc-950/80 shadow-xl">
            <Play className="h-7 w-7 fill-teal-200 text-teal-200" />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0"
        onClick={(event) => {
          event.stopPropagation()
          onTogglePlay()
        }}
        aria-label={isPlaying ? '暂停预览' : '播放预览'}
      />

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-zinc-700/70 bg-zinc-950/80 px-2 py-1 font-mono text-[10px] text-zinc-400 backdrop-blur">
        {scene.name} · {currentTime.toFixed(1)}s
      </div>
    </div>
  )
}
