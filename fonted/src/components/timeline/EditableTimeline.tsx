import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { Film, Music2, Sparkles, Type } from 'lucide-react'
import { useCallback } from 'react'

import { TimelineRuler } from '@/components/timeline/TimelineRuler'
import { TimelineTrackRow } from '@/components/timeline/TimelineTrackRow'
import {
  PIXELS_PER_SECOND,
  RULER_HEIGHT,
  TRACK_HEADER_WIDTH,
  TRACK_HEIGHT,
} from '@/components/timeline/constants'
import { extractBeatMarkers } from '@/lib/render-effect-ui'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTimelineStore } from '@/stores/timelineStore'
import type { TimelineMode } from '@/stores/editorStore'
import type { TimelineClip } from '@/types/timeline'

const TRACK_ICONS = {
  video: Film,
  overlay: Type,
  audio: Music2,
  effect: Sparkles,
} as const

const SAMPLE_TRACK_LABELS = {
  video: { label: '样例画面', sublabel: '镜头 / 场景 / 运镜' },
  overlay: { label: '文字线索', sublabel: '字幕 / 屏幕文字' },
  audio: { label: '样例配乐', sublabel: '节拍 / 情绪' },
  effect: { label: '视觉效果', sublabel: '样例中的特效线索' },
} as const

const GENERATION_TRACK_LABELS = {
  video: { label: '画面轨', sublabel: '素材 / 镜头运动 / 裁剪' },
  overlay: { label: '文字轨', sublabel: '字幕 / 花字 / 水印 / 角标' },
  effect: { label: '效果轨', sublabel: '插件 / 遮罩 / 畸变 / 调色' },
  audio: { label: '音频轨', sublabel: '配乐 / 节拍 / 音效 / 口播' },
} as const

interface EditableTimelineProps {
  mode?: TimelineMode
}

export function EditableTimeline({ mode = 'generation' }: EditableTimelineProps) {
  const project = useTimelineStore((s) => s.project)
  const selectClip = useTimelineStore((s) => s.selectClip)
  const updateClipTime = useTimelineStore((s) => s.updateClipTime)
  const renderPlan = useRenderPlanStore((s) => s.plan)
  const beatMarkers = extractBeatMarkers(renderPlan)
  const visibleTracks =
    mode === 'generation'
      ? project.tracks
      : project.tracks.filter((track) => track.id === 'video' || track.id === 'audio')

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, delta } = event
      const data = active.data.current as
        | { type: 'clip'; clip: TimelineClip }
        | undefined
      if (!data?.clip) return
      if (mode === 'sample') return

      const clip = data.clip
      const duration = clip.end_sec - clip.start_sec
      const deltaSec = delta.x / PIXELS_PER_SECOND
      let newStart = clip.start_sec + deltaSec
      newStart = Math.max(
        0,
        Math.min(newStart, project.duration_sec - duration),
      )
      const roundedStart = Math.round(newStart * 10) / 10
      updateClipTime(clip.id, roundedStart, roundedStart + duration)
    },
    [mode, project.duration_sec, updateClipTime],
  )

  const timelineWidth = project.duration_sec * PIXELS_PER_SECOND
  const headersHeight = RULER_HEIGHT + visibleTracks.length * TRACK_HEIGHT

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0 min-w-0 flex-1">
        <div
          className="flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          <div
            className="shrink-0 border-b border-zinc-800 bg-zinc-900"
            style={{ height: RULER_HEIGHT }}
          />
          {visibleTracks.map((track) => {
            const Icon = TRACK_ICONS[track.id as keyof typeof TRACK_ICONS] ?? Film
            const labels =
              mode === 'sample' ? SAMPLE_TRACK_LABELS : GENERATION_TRACK_LABELS
            const sampleLabel = labels[track.id as keyof typeof labels]
            const label =
              mode === 'sample' && sampleLabel
                ? sampleLabel.label
                : track.label
            const sublabel =
              mode === 'sample' && sampleLabel
                ? sampleLabel.sublabel
                : track.sublabel
            return (
              <div
                key={track.id}
                className="flex items-center gap-2 border-b border-zinc-800/80 px-3"
                style={{ height: TRACK_HEIGHT }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-zinc-300">
                    {label}
                  </p>
                  <p className="truncate text-[9px] text-zinc-600">
                    {sublabel}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        <div
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onClick={() => selectClip(null)}
        >
          <div
            className="relative"
            style={{ width: timelineWidth, minHeight: headersHeight }}
          >
            <div
              className="pointer-events-none absolute left-0 z-[1]"
              style={{
                top: RULER_HEIGHT,
                width: timelineWidth,
                height: visibleTracks.length * TRACK_HEIGHT,
              }}
            >
              {beatMarkers.map((marker, index) => (
                <div
                  key={`${marker.source}-${marker.time}-${index}`}
                  className="absolute top-0 h-full"
                  style={{
                    left: marker.time * PIXELS_PER_SECOND,
                    width: marker.source === 'beat' ? 1 : 2,
                    opacity: marker.intensity,
                    background:
                      marker.source === 'peak'
                        ? 'rgba(34, 211, 238, 0.72)'
                        : marker.source === 'strong'
                          ? 'rgba(168, 85, 247, 0.68)'
                          : 'rgba(250, 204, 21, 0.35)',
                    boxShadow:
                      marker.source === 'peak'
                        ? '0 0 10px rgba(34, 211, 238, 0.65)'
                        : undefined,
                  }}
                />
              ))}
            </div>
            <TimelineRuler
              durationSec={project.duration_sec}
              pixelsPerSecond={PIXELS_PER_SECOND}
            />
            {visibleTracks.map((track) => (
              <TimelineTrackRow
                key={track.id}
                track={track}
                clips={project.clips}
                durationSec={project.duration_sec}
                pixelsPerSecond={PIXELS_PER_SECOND}
              />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}
