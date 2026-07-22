import { Play } from 'lucide-react'
import { forwardRef } from 'react'

import { RenderPlanPreview } from '@/components/canvas/RenderPlanPreview'
import { SemanticProgressBar } from '@/components/canvas/SemanticProgressBar'
import { VideoPreviewFrame } from '@/components/canvas/VideoPreviewFrame'
import { cn } from '@/lib/utils'
import { resolveWorkbenchView, type TimelineMode } from '@/stores/editorStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useV2TimelineStore } from '@/stores/v2TimelineStore'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'

interface GeneratedPlayerProps {
  mode: TimelineMode
  project: MigrationProtocolV12
  onTimeUpdate: () => void
  onEnded: () => void
  onLoadedMetadata: (duration: number, source?: 'sample' | 'generated') => void
  onSeek: (time: number) => void
  onTogglePlay: () => void
}

export function hasGeneratedVideo(project: MigrationProtocolV12): boolean {
  const url = project.generated_video.url?.trim()
  if (!url) return false
  return url !== project.source_video.url
}

export const GeneratedPlayer = forwardRef<HTMLVideoElement, GeneratedPlayerProps>(
  function GeneratedPlayer(
    { mode, project, onTimeUpdate, onEnded, onLoadedMetadata, onSeek, onTogglePlay },
    ref,
  ) {
    const currentTime = usePlaybackStore((s) => s.currentTime)
    const duration = usePlaybackStore((s) => s.duration)
    const isPlaying = usePlaybackStore((s) => s.isPlaying)
    const renderPlan = useRenderPlanStore((s) => s.plan)
    const v2Preview = useV2TimelineStore((s) => s.preview)
    const ready = hasGeneratedVideo(project)
    const workbenchView = resolveWorkbenchView({
      timelineMode: mode,
      hasRenderPlan: Boolean(renderPlan?.scenes.length),
      hasRenderedVideo: ready,
    })

    const title =
      workbenchView === 'rendered_output'
        ? '生成成片'
        : v2Preview
          ? 'V2 Timeline 方案'
        : workbenchView === 'generation_edit'
          ? '时间线预览'
          : '待生成区域'

    const footerText =
      workbenchView === 'rendered_output'
        ? '已渲染 mp4 · 可继续调整 V2 Timeline 后再次渲染'
        : v2Preview
          ? 'V2 Timeline 预览 · 确认后可进入完整渲染'
        : workbenchView === 'generation_edit'
          ? '时间线预览 · 右侧修改后需再次点击「渲染」才会更新 mp4'
          : '样例风格拆解 · 等待生成成片'

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
        <h3 className="shrink-0 text-sm font-medium tracking-tight text-zinc-200">
          {title}
        </h3>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl',
            'border border-zinc-800 bg-zinc-900/50 shadow-lg shadow-black/25',
          )}
        >
          <div className="relative flex min-h-0 flex-1 flex-col p-4">
            {workbenchView === 'rendered_output' ? (
              <VideoPreviewFrame className="min-h-0 flex-1">
                <div className="relative h-full w-full">
                  <video
                    key={project.generated_video.url}
                    ref={ref}
                    className="h-full w-full object-contain"
                    src={project.generated_video.url}
                    preload="metadata"
                    playsInline
                    onTimeUpdate={onTimeUpdate}
                    onEnded={onEnded}
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration
                      if (Number.isFinite(d)) onLoadedMetadata(d, 'generated')
                    }}
                  />

                  {!isPlaying && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-900/40">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-violet-500/30 bg-zinc-800/90 shadow-md">
                        <Play className="h-7 w-7 fill-violet-300 text-violet-300" />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePlay()
                    }}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  />
                </div>
              </VideoPreviewFrame>
            ) : v2Preview ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 rounded-lg bg-zinc-950/80 px-6 py-5">
                <div>
                  <div className="inline-flex rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-medium text-blue-200">
                    V2 Timeline 方案
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    {v2Preview.review.summary_zh}
                  </p>
                  <p className="mt-2 break-all text-[10px] text-zinc-600">
                    trace: {v2Preview.traceDir}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <div className="space-y-2">
                    {v2Preview.review.scenes.map((scene, index) => (
                      <div
                        key={scene.id}
                        className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-zinc-200">
                            {index + 1}. {scene.role_zh}
                          </span>
                          <span className="font-mono text-zinc-500">
                            {scene.start_sec}s - {Number((scene.start_sec + scene.duration_sec).toFixed(2))}s
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          {scene.owner_zh} · {scene.source_zh}
                          {scene.transition_after ? ` · ${scene.transition_after}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : workbenchView === 'sample_breakdown' ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-zinc-950/80 px-8 text-center">
                <div className="rounded-md border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-medium text-violet-200">
                  样例风格拆解
                </div>
                <p className="text-sm font-semibold text-zinc-200">待生成成片</p>
                <p className="max-w-md text-xs leading-relaxed text-zinc-500">
                  样例理解已完成。这里不会提前展示生成草稿；补充创作素材并在对话中说「生成」后，会切换到
                  时间线预览。
                </p>
              </div>
            ) : renderPlan ? (
              <VideoPreviewFrame className="min-h-0 flex-1">
                <div className="relative h-full w-full">
                  <RenderPlanPreview
                    plan={renderPlan}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    onTogglePlay={onTogglePlay}
                  />
                </div>
              </VideoPreviewFrame>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-zinc-950/80 px-6 text-center">
                <p className="text-sm font-medium text-zinc-400">尚未生成时间线方案</p>
                <p className="text-xs leading-relaxed text-zinc-600">
                  在左侧对话中说「生成」，系统会按样例结构与创作素材编排时间线方案。
                </p>
              </div>
            )}
          </div>

          {workbenchView === 'rendered_output' ? (
            <SemanticProgressBar
              anchors={project.semantic_anchors}
              currentTime={currentTime}
              duration={duration}
              onSeek={onSeek}
            />
          ) : (
            <div className="shrink-0 border-t border-zinc-800/80 px-4 py-3 text-center text-[10px] text-zinc-600">
              {footerText}
            </div>
          )}
        </div>
      </div>
    )
  },
)
