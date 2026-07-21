import {
  Check,
  ChevronDown,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EffectParameterControls } from '@/components/layout/EffectParameterControls'
import { CompositionStatusPanel } from '@/components/layout/CompositionStatusPanel'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { env } from '@/config/env'
import * as api from '@/lib/api'
import { creativeRoleLabel, slotTagLabel } from '@/lib/director-labels'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editorStore'
import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePropertyEditorStore } from '@/stores/propertyEditorStore'
import { useRenderPlanStore } from '@/stores/renderPlanStore'
import { useTaskStore } from '@/stores/taskStore'
import { useTimelineStore } from '@/stores/timelineStore'
import {
  EMOTION_VIBE_OPTIONS,
  NARRATIVE_ROLE_OPTIONS,
} from '@/types/anchor-editor'
import type {
  DirectorGroundingResult,
  DirectorTemporalEvent,
  DirectorVisualPhenomenon,
  SemanticAnchor,
  TimelineTransition,
} from '@/types/migration-protocol'
import type { OverlayLayer, RenderAsset, RenderScene, AudioLayer } from '@/types/render-plan'
import type { TimelineClip } from '@/types/timeline'
import {
  createDefaultEffect,
  isKnownEffectPreset,
  type EffectPresetId,
} from '@shared/lib/effect-registry'

type SectionId =
  | 'goal'
  | 'visual'
  | 'motion'
  | 'subtitles'
  | 'effects'
  | 'transition'
  | 'audio'

const EFFECT_CHOICES: Array<{
  value: '' | EffectPresetId
  label: string
  description: string
}> = [
  { value: '', label: '无效果', description: '普通画面，不叠加额外视觉效果' },
  {
    value: 'primitive_texture_grade',
    label: '电影质感',
    description: '调色、暗角、颗粒、轻微辉光，适合统一素材质感',
  },
  {
    value: 'primitive_beat_pulse',
    label: '节拍闪白',
    description: '跟随音乐节拍做轻微缩放、闪白和抖动',
  },
  {
    value: 'primitive_slice_reveal',
    label: '切片动效',
    description: '把画面切成横向或竖向片段做揭示/交错运动',
  },
].filter((effect) => effect.value !== 'primitive_beat_pulse') as Array<{
  value: '' | EffectPresetId
  label: string
  description: string
}>

const TRANSITION_PRESETS: Array<{
  id: 'cut' | 'fade' | 'slide'
  label: string
  summary: string
  patch: Partial<TimelineTransition>
}> = [
  {
    id: 'cut',
    label: '直接切',
    summary: '干净利落，适合强拍切换',
    patch: {
      presentation: 'cut',
      duration_sec: 0,
      timing: { type: 'linear' },
      overlay: { type: 'none' },
    },
  },
  {
    id: 'fade',
    label: '淡入淡出',
    summary: '柔和过渡，适合氛围段落',
    patch: {
      presentation: 'fade',
      duration_sec: 0.28,
      timing: { type: 'linear', easing: 'ease-in-out' },
      overlay: { type: 'none' },
    },
  },
  {
    id: 'slide',
    label: '滑动切换',
    summary: '有方向感，适合旅行/场景切换',
    patch: {
      presentation: 'slide',
      duration_sec: 0.36,
      direction: 'from-right',
      timing: { type: 'linear', easing: 'ease-out' },
      overlay: { type: 'none' },
    },
  },
]

function formatTime(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.0s'
  return `${value.toFixed(1)}s`
}

function roleLabel(value: string | undefined): string {
  return creativeRoleLabel(value)
}

function optionWithCurrent<T extends { value: string; label: string }>(
  options: T[],
  value: string,
  label = value,
): T[] {
  if (!value || options.some((option) => option.value === value)) return options
  return [{ value, label } as T, ...options]
}

function isGrounding(value: unknown): value is DirectorGroundingResult {
  return Boolean(value && typeof value === 'object')
}

function overlaps(
  start: number,
  end: number,
  item: { start_sec: number; end_sec: number },
): boolean {
  return item.start_sec < end && item.end_sec > start
}

function findTemporalEvent(
  grounding: DirectorGroundingResult | undefined,
  anchor: SemanticAnchor | undefined,
): DirectorTemporalEvent | undefined {
  if (!grounding?.temporal_events?.length || !anchor) return undefined
  return (
    grounding.temporal_events.find((event) => event.id === anchor.anchor_id) ??
    grounding.temporal_events.find(
      (event) =>
        Math.abs(event.start_sec - anchor.start_sec) < 0.2 ||
        overlaps(anchor.start_sec, anchor.end_sec, event),
    )
  )
}

function visualPhenomenaForAnchor(
  grounding: DirectorGroundingResult | undefined,
  anchor: SemanticAnchor | undefined,
): DirectorVisualPhenomenon[] {
  if (!grounding?.visual_phenomena?.length || !anchor) return []
  return grounding.visual_phenomena.filter((item) =>
    overlaps(anchor.start_sec, anchor.end_sec, item),
  )
}

function effectChoiceLabel(value: string | undefined): string {
  return (
    EFFECT_CHOICES.find((choice) => choice.value === value)?.label ??
    (value ? '高级效果' : '无效果')
  )
}

const LAYER_KIND_LABELS: Record<string, string> = {
  motion_driver: '运动驱动',
  mask_reveal: '遮罩揭示',
  distortion: '形变/水波',
  color_grade: '调色质感',
  layout: '分屏布局',
  overlay: '文字覆盖',
  audio_driver: '音频驱动',
  composite: '组合效果',
}

const RESOLUTION_LABELS: Record<string, string> = {
  compiled: '精确匹配',
  fallback: '近似 fallback',
  missing: '缺失能力',
}

function layerKindLabel(value: string | undefined): string {
  if (!value) return '未标注层'
  return LAYER_KIND_LABELS[value] ?? value
}

function resolutionLabel(value: string | undefined): string {
  if (!value) return '未记录'
  return RESOLUTION_LABELS[value] ?? value
}

function transitionChoiceLabel(value: string | undefined): string {
  return (
    TRANSITION_PRESETS.find((choice) => choice.id === value)?.label ??
    (value ? '其他转场' : '无转场')
  )
}

function assetName(assets: RenderAsset[], id: string | undefined): string {
  if (!id) return '未绑定素材'
  return assets.find((asset) => asset.id === id)?.name ?? id
}

function overlayFromClip(
  scene: RenderScene | undefined,
  clip: TimelineClip | undefined,
): OverlayLayer | undefined {
  if (!scene || !clip || clip.track_id !== 'overlay') return undefined
  const overlayId = clip.id.startsWith('clip-o-') ? clip.id.slice(7) : clip.id
  return scene.overlays.find((item) => item.id === overlayId)
}

function audioFromClip(
  scene: RenderScene | undefined,
  clip: TimelineClip | undefined,
): AudioLayer | undefined {
  if (!scene || !clip || clip.track_id !== 'audio') return undefined
  if (clip.id === 'clip-a-bgm') return scene.audio[0]
  const audioId = clip.id.startsWith('clip-a-') ? clip.id.slice(7) : clip.id
  return scene.audio.find((item) => item.id === audioId) ?? scene.audio[0]
}

const TRACK_PANEL_LABELS = {
  video: '画面轨',
  overlay: '文字轨',
  effect: '效果轨',
  audio: '音频轨',
} as const

function createOverlay(scene: RenderScene, index: number): OverlayLayer {
  return {
    id: `overlay_${scene.source_anchor_id}_${Date.now()}`,
    type: index === 0 ? 'big_caption' : 'subtitle',
    start_sec: scene.start_sec,
    end_sec: scene.end_sec,
    text: index === 0 ? '输入标题' : '输入字幕',
    layout: {
      position: index === 0 ? 'center' : 'bottom',
      align: 'center',
      max_width_pct: index === 0 ? 86 : 92,
    },
    style: {
      font_size: index === 0 ? 64 : 38,
      font_weight: index === 0 ? 'black' : 'bold',
      color: '#ffffff',
      background: index === 0 ? '#7c3aed' : undefined,
      stroke: '#111111',
      shadow: true,
    },
    animation: {
      in: index === 0 ? 'pop' : 'fade_in',
      out: 'fade_out',
      emphasis: index === 0 ? 'scale_pulse' : undefined,
    },
  }
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full flex-col',
        'border-l border-zinc-800 bg-zinc-950',
        'shadow-[-12px_0_32px_-12px_rgba(0,0,0,0.45)]',
      )}
    >
      {children}
    </aside>
  )
}

function EmptyPanel({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <PanelShell>
      <div className="flex h-full items-center justify-center px-5">
        <div className="max-w-[260px] text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 text-violet-200">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {description}
          </p>
        </div>
      </div>
    </PanelShell>
  )
}

function InfoBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-zinc-200">{title}</h3>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-xs leading-relaxed text-zinc-300">
        {children}
      </div>
    </section>
  )
}

function CollapsibleSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId
  title: string
  summary: string
  open: boolean
  onToggle: (id: SectionId) => void
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/45">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
        onClick={() => onToggle(id)}
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-zinc-500 transition-transform',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-zinc-100">{title}</h3>
          <p className="mt-0.5 truncate text-[10px] text-zinc-500">{summary}</p>
        </div>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-zinc-800 px-3 py-3">
          {children}
        </div>
      ) : null}
    </section>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string
  value: number | undefined
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[10px] font-medium text-zinc-500">{label}</span>
      <Input
        type="number"
        value={value ?? 0}
        min={min}
        max={max}
        step={step}
        className="h-8 text-xs"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function PropertyEditorPanel() {
  const timelineMode = useEditorStore((s) => s.timelineMode)
  const draft = usePropertyEditorStore((s) => s.draft)
  const isDirty = usePropertyEditorStore((s) => s.isDirty)
  const lastSavedAt = usePropertyEditorStore((s) => s.lastSavedAt)
  const updateDraft = usePropertyEditorStore((s) => s.updateDraft)
  const save = usePropertyEditorStore((s) => s.save)
  const selectedClip = useTimelineStore((s) =>
    s.project.clips.find((clip) => clip.id === s.selectedClipId),
  )
  const renderPlan = useRenderPlanStore((s) => s.plan)
  const renderPlanDirty = useRenderPlanStore((s) => s.isDirty)
  const renderPlanSyncStatus = useRenderPlanStore((s) => s.syncStatus)
  const renderPlanSyncError = useRenderPlanStore((s) => s.lastSyncError)
  const renderPlanChangeSummary = useRenderPlanStore((s) => s.lastChangeSummary)
  const scene = useRenderPlanStore((s) =>
    s.getSceneByAnchor(selectedClip?.anchor_id),
  )
  const updateSceneIntent = useRenderPlanStore((s) => s.updateSceneIntent)
  const updateSceneVisual = useRenderPlanStore((s) => s.updateSceneVisual)
  const updateSceneEffect = useRenderPlanStore((s) => s.updateSceneEffect)
  const addOverlay = useRenderPlanStore((s) => s.addOverlay)
  const updateOverlay = useRenderPlanStore((s) => s.updateOverlay)
  const removeOverlay = useRenderPlanStore((s) => s.removeOverlay)
  const updateAudio = useRenderPlanStore((s) => s.updateAudio)
  const updateRenderTransition = useRenderPlanStore((s) => s.updateTransition)
  const migrationProject = useMigrationProjectStore((s) => s.project)
  const updateAnchor = useMigrationProjectStore((s) => s.updateAnchor)
  const updateMigrationTransition = useMigrationProjectStore(
    (s) => s.updateTransition,
  )
  const selectedAnchor = useMigrationProjectStore((s) =>
    selectedClip?.anchor_id ? s.getAnchor(selectedClip.anchor_id) : undefined,
  )
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    goal: false,
    visual: true,
    motion: false,
    subtitles: false,
    effects: false,
    transition: false,
    audio: false,
  })

  const grounding = useMemo(
    () =>
      isGrounding(migrationProject.director_grounding)
        ? migrationProject.director_grounding
        : undefined,
    [migrationProject.director_grounding],
  )
  const temporalEvent = useMemo(
    () => findTemporalEvent(grounding, selectedAnchor),
    [grounding, selectedAnchor],
  )
  const visualPhenomena = useMemo(
    () => visualPhenomenaForAnchor(grounding, selectedAnchor),
    [grounding, selectedAnchor],
  )
  const transition = useMemo(() => {
    if (!selectedAnchor) return undefined
    return renderPlan?.transitions?.find(
      (item) => item.from_anchor_id === selectedAnchor.anchor_id,
    )
  }, [renderPlan?.transitions, selectedAnchor])
  const audioAssets = (renderPlan?.assets ?? []).filter(
    (asset) => asset.type === 'audio',
  )
  const visualAssets = (renderPlan?.assets ?? []).filter(
    (asset) => asset.type !== 'audio',
  )

  const toggleSection = (id: SectionId) => {
    setOpenSections((state) => ({ ...state, [id]: !state[id] }))
  }

  const patchSelectedAnchor = (patch: Partial<SemanticAnchor>) => {
    if (!selectedAnchor) return
    updateAnchor(selectedAnchor.anchor_id, patch)
  }

  const patchReplication = (
    patch: Partial<SemanticAnchor['replication_instructions']>,
  ) => {
    if (!selectedAnchor) return
    patchSelectedAnchor({
      replication_instructions: {
        ...selectedAnchor.replication_instructions,
        ...patch,
      },
    })
  }

  const syncTimelineFromDraft = () => {
    const { draft } = usePropertyEditorStore.getState()
    const { project } = useTimelineStore.getState()
    useTimelineStore.setState({
      project: {
        ...project,
        clips: project.clips.map((clip) =>
          clip.anchor_id === draft.anchor_id
            ? {
                ...clip,
                visual_generation_prompt: draft.visual_generation_prompt,
                content_rewrite_instruction: draft.overlay_rewrite_instruction,
              }
            : clip,
        ),
      },
    })
  }

  const syncToBackend = async () => {
    if (!env.useBackend) return
    const taskId = useTaskStore.getState().activeTaskId
    if (!taskId) return
    const currentRenderPlan = useRenderPlanStore.getState().plan
    if (timelineMode === 'generation') {
      useRenderPlanStore.getState().markSaving()
    }
    try {
      if (timelineMode === 'generation') {
        if (currentRenderPlan) {
          const changeSummary = useRenderPlanStore.getState().lastChangeSummary ?? ''
          const { renderPlan: savedRenderPlan } = await api.patchTaskRenderPlan(taskId, currentRenderPlan)
          useRenderPlanStore.getState().setPlan(savedRenderPlan)
          useTaskStore
            .getState()
            .addLog(
              `[编辑] RenderPlan revision ${savedRenderPlan.plan_revision ?? currentRenderPlan.plan_revision ?? 1} 已同步到后端。${changeSummary}`,
            )
        }
      } else {
        const project = useMigrationProjectStore.getState().project
        await api.patchTaskStructure(taskId, project)
      }
      useTaskStore.getState().addLog('[编辑] 已同步到后端')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (timelineMode === 'generation') {
        useRenderPlanStore.getState().markSyncFailed(message)
      }
      useTaskStore.getState().addLog(
        `同步失败: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  if (timelineMode === 'sample') {
    if (!selectedAnchor) {
      return (
        <EmptyPanel
          title="选择一个样例片段"
          description="点击下方样例画面轨中的片段，查看 AI 对这一段的画面、节奏和复刻要点。"
        />
      )
    }

    const textCue =
      temporalEvent?.overlay_text ||
      selectedAnchor.replication_instructions.overlay_rewrite_instruction
    const phenomenonText = visualPhenomena.length
      ? visualPhenomena.map((item) => item.description).join('；')
      : temporalEvent?.visual_prompt ||
        selectedAnchor.replication_instructions.visual_generation_prompt
    const critique = [
      ...(grounding?.critique?.likely_failure_points ?? []),
      ...(grounding?.critique?.repair_notes ?? []),
    ].slice(0, 3)

    return (
      <PanelShell>
        <header className="shrink-0 border-b border-zinc-800 px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-zinc-500">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium uppercase">
              样例分析
            </span>
          </div>
          <h2 className="text-sm font-semibold text-zinc-100">
            {roleLabel(temporalEvent?.creative_role ?? selectedAnchor.logic_intent.marketing_role)}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">
            {formatTime(selectedAnchor.start_sec)} - {formatTime(selectedAnchor.end_sec)}
          </p>
        </header>

        <div className="scroll-area-y min-h-0 flex-1 space-y-5 px-4 py-4">
          <InfoBlock title="这一段在做什么">
            <p>
              {temporalEvent?.description ||
                selectedAnchor.replication_instructions.overlay_rewrite_instruction ||
                'AI 将这一段识别为一个可复刻的画面段落。'}
            </p>
          </InfoBlock>

          <InfoBlock title="画面特点">
            <p>{phenomenonText || '暂未识别到明确画面特点。'}</p>
            {temporalEvent?.camera || temporalEvent?.motion ? (
              <p className="mt-2 text-zinc-500">
                {[temporalEvent.camera, temporalEvent.motion]
                  .filter(Boolean)
                  .join(' / ')}
              </p>
            ) : null}
          </InfoBlock>

          <InfoBlock title="节奏依据">
            <p>
              {grounding?.style_summary?.audio_sync_logic ||
                grounding?.audio_visual_evidence?.beat_summary ||
                '这一段主要根据画面边界和样例节奏切分。'}
            </p>
          </InfoBlock>

          <InfoBlock title="复刻建议">
            <p>
              {(temporalEvent?.slot_tags?.length
                ? `适合使用：${temporalEvent.slot_tags.map(slotTagLabel).join('、')}`
                : selectedAnchor.match.asset_name
                  ? `当前匹配素材：${selectedAnchor.match.asset_name}`
                  : '建议选择和样例画面主体、色彩、构图接近的素材。')}
            </p>
          </InfoBlock>

          <InfoBlock title="文字线索">
            <p>{textCue || '这一段主要靠画面和节奏表达，没有明显文字线索。'}</p>
          </InfoBlock>

          {critique.length ? (
            <InfoBlock title="需要注意">
              <ul className="space-y-1">
                {critique.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </InfoBlock>
          ) : null}
        </div>
      </PanelShell>
    )
  }

  if (!renderPlan) {
    return (
      <EmptyPanel
        title="尚未生成 RenderPlan"
        description="在左侧对话中说「生成」，系统会按样例结构与创作素材编排 RenderPlan，然后才能编辑各轨道参数。"
      />
    )
  }

  if (!selectedClip || !selectedAnchor || !scene) {
    return (
      <EmptyPanel
        title="选择一个轨道片段"
        description="在下方时间轴选择画面、文字、效果或音频轨上的片段，右侧会显示对应参数。"
      />
    )
  }

  const trackId = selectedClip.track_id
  const selectedOverlay = overlayFromClip(scene, selectedClip)
  const selectedAudio = audioFromClip(scene, selectedClip)
  const trackLabel = TRACK_PANEL_LABELS[trackId as keyof typeof TRACK_PANEL_LABELS] ?? '轨道'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (trackId === 'video') {
      save()
      syncTimelineFromDraft()
    }
    await syncToBackend()
  }

  const applyTransitionPatch = (patch: Partial<TimelineTransition>) => {
    if (!transition) return
    updateRenderTransition(transition.id, patch)
    updateMigrationTransition(transition.id, patch)
  }

  return (
    <PanelShell>
      <header className="shrink-0 border-b border-zinc-800 px-4 py-4">
        <div className="mb-2 flex items-center gap-2 text-zinc-500">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="text-[10px] font-medium uppercase">
            {trackLabel}
          </span>
        </div>
        <h2 className="text-sm font-semibold text-zinc-100">
          {trackId === 'overlay'
            ? selectedOverlay?.text || '文字层'
            : trackId === 'effect'
              ? effectChoiceLabel(scene.effects?.preset)
              : trackId === 'audio'
                ? selectedAudio
                  ? assetName(renderPlan.assets, selectedAudio.asset_id)
                  : '音频层'
                : roleLabel(draft.marketing_role)}
        </h2>
        <p className="mt-1 font-mono text-[10px] text-zinc-600">
          {formatTime(scene.start_sec)} - {formatTime(scene.end_sec)}
          {(isDirty || renderPlanDirty) && (
            <span className="ml-2 text-amber-500/90">未保存</span>
          )}
          {lastSavedAt && !isDirty && !renderPlanDirty && (
            <span className="ml-2 text-emerald-500/80">
              已保存 {lastSavedAt}
            </span>
          )}
        </p>
      </header>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="scroll-area-y min-h-0 flex-1 space-y-3 px-4 py-4">
          {trackId === 'video' ? (
            <>
          <CollapsibleSection
            id="goal"
            title="段落定位"
            summary={`${roleLabel(draft.marketing_role)} · ${draft.emotion_vibe || '默认氛围'}`}
            open={openSections.goal}
            onToggle={toggleSection}
          >
            <FieldGrid>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  结构位置
                </span>
                <Select
                  value={draft.marketing_role}
                  onChange={(event) => {
                    const value = event.target.value
                    updateDraft('marketing_role', value)
                    patchSelectedAnchor({
                      logic_intent: {
                        ...selectedAnchor.logic_intent,
                        marketing_role: value,
                      },
                    })
                    updateSceneIntent(scene.id, { marketing_role: value })
                  }}
                >
                  {optionWithCurrent(
                    NARRATIVE_ROLE_OPTIONS,
                    draft.marketing_role,
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  情绪氛围
                </span>
                <Select
                  value={draft.emotion_vibe}
                  onChange={(event) => {
                    const value = event.target.value
                    updateDraft('emotion_vibe', value)
                    patchSelectedAnchor({
                      logic_intent: {
                        ...selectedAnchor.logic_intent,
                        emotion_vibe: value,
                      },
                    })
                    updateSceneIntent(scene.id, { emotion_vibe: value })
                  }}
                >
                  {optionWithCurrent(
                    EMOTION_VIBE_OPTIONS,
                    draft.emotion_vibe,
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            </FieldGrid>
          </CollapsibleSection>

          <CollapsibleSection
            id="visual"
            title="素材"
            summary={`${assetName(renderPlan.assets, scene.visual.asset_id)} · ${scene.visual.fit === 'contain' ? '完整显示' : '铺满画面'}`}
            open={openSections.visual}
            onToggle={toggleSection}
          >
            <FieldGrid>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  素材来源
                </span>
                <Select
                  value={scene.visual.mode}
                  onChange={(event) =>
                    updateSceneVisual(scene.id, {
                      mode: event.target.value as typeof scene.visual.mode,
                    })
                  }
                >
                  <option value="material_clip">使用素材</option>
                  <option value="image_motion">图片动态包装</option>
                  <option value="solid_bg">纯色包装背景</option>
                  <option value="ai_generated">AI 素材占位</option>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  裁剪 / 显示
                </span>
                <Select
                  value={scene.visual.fit}
                  onChange={(event) =>
                    updateSceneVisual(scene.id, {
                      fit: event.target.value as typeof scene.visual.fit,
                    })
                  }
                >
                  <option value="cover">铺满画面</option>
                  <option value="contain">完整显示</option>
                </Select>
              </label>
            </FieldGrid>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">
                当前素材
              </span>
              <Select
                value={scene.visual.asset_id ?? ''}
                onChange={(event) =>
                  updateSceneVisual(scene.id, {
                    asset_id: event.target.value || undefined,
                  })
                }
              >
                <option value="">不绑定素材</option>
                {visualAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">
                画面描述
              </span>
              <Textarea
                className="min-h-[112px] text-xs leading-relaxed"
                value={draft.visual_generation_prompt}
                onChange={(event) => {
                  const value = event.target.value
                  updateDraft('visual_generation_prompt', value)
                  updateSceneVisual(scene.id, { visual_prompt: value })
                  patchReplication({ visual_generation_prompt: value })
                }}
              />
            </label>
          </CollapsibleSection>

          <CollapsibleSection
            id="motion"
            title="镜头运动"
            summary={`${scene.visual.motion?.preset ?? 'static'} · ${Math.round((scene.visual.motion?.intensity ?? 0) * 100)}%`}
            open={openSections.motion}
            onToggle={toggleSection}
          >
            <FieldGrid>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  运动方式
                </span>
                <Select
                  value={scene.visual.motion?.preset ?? 'static'}
                  onChange={(event) =>
                    updateSceneVisual(scene.id, {
                      motion: {
                        preset: event.target
                          .value as NonNullable<typeof scene.visual.motion>['preset'],
                        intensity: scene.visual.motion?.intensity ?? 0.3,
                        easing: scene.visual.motion?.easing ?? 'ease-out',
                        driver: 'useCurrentFrame',
                      },
                    })
                  }
                >
                  <option value="static">静止</option>
                  <option value="push_in">缓慢推近</option>
                  <option value="zoom_in">拉近强调</option>
                  <option value="pan">横向平移</option>
                  <option value="shake">轻微抖动</option>
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-medium text-zinc-500">
                  缓动方式
                </span>
                <Select
                  value={scene.visual.motion?.easing ?? 'ease-out'}
                  onChange={(event) =>
                    updateSceneVisual(scene.id, {
                      motion: {
                        preset: scene.visual.motion?.preset ?? 'push_in',
                        intensity: scene.visual.motion?.intensity ?? 0.3,
                        easing: event.target.value,
                        driver: 'useCurrentFrame',
                      },
                    })
                  }
                >
                  <option value="linear">匀速</option>
                  <option value="ease-out">自然减速</option>
                  <option value="ease-in-out">柔和进出</option>
                  <option value="overshoot">轻微回弹</option>
                </Select>
              </label>
            </FieldGrid>
            <NumberField
              label="运动强度"
              value={scene.visual.motion?.intensity ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) =>
                updateSceneVisual(scene.id, {
                  motion: {
                    preset: scene.visual.motion?.preset ?? 'push_in',
                    intensity: value,
                    easing: scene.visual.motion?.easing ?? 'ease-out',
                    driver: 'useCurrentFrame',
                  },
                })
              }
            />
          </CollapsibleSection>

          <CollapsibleSection
            id="effects"
            title="视觉效果"
            summary={effectChoiceLabel(scene.effects?.preset)}
            open={openSections.effects}
            onToggle={toggleSection}
          >
            <CompositionStatusPanel status={scene.composition_status} />
            {scene.effect_layers?.length ? (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    插件匹配状态
                  </span>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                    {scene.effect_layers.length} 层
                  </span>
                </div>
                <div className="space-y-1.5">
                  {scene.effect_layers.map((layer) => (
                    <div
                      key={layer.id}
                      className="rounded-md border border-zinc-800/80 bg-zinc-900/70 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-zinc-200">
                          {layer.plugin_id}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                            layer.resolution === 'fallback'
                              ? 'bg-amber-500/10 text-amber-300'
                              : layer.resolution === 'missing'
                                ? 'bg-red-500/10 text-red-300'
                                : 'bg-emerald-500/10 text-emerald-300',
                          )}
                        >
                          {resolutionLabel(layer.resolution)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
                        <span>{layerKindLabel(layer.layerKind)}</span>
                        <span>·</span>
                        <span>{effectChoiceLabel(layer.preset)}</span>
                        {layer.is_primary ? (
                          <>
                            <span>·</span>
                            <span>主效果</span>
                          </>
                        ) : null}
                      </div>
                      {layer.reason ? (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">
                          {layer.reason}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">
                效果预设
              </span>
              <Select
                value={scene.effects?.preset ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  updateSceneEffect(
                    scene.id,
                    value && isKnownEffectPreset(value)
                      ? createDefaultEffect(value as EffectPresetId)
                      : undefined,
                  )
                }}
              >
                {EFFECT_CHOICES.map((choice) => (
                  <option key={choice.value || 'none'} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </label>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {
                EFFECT_CHOICES.find(
                  (choice) => choice.value === (scene.effects?.preset ?? ''),
                )?.description
              }
              {' '}
              详细插件参数请在效果轨片段中调整。
            </p>
          </CollapsibleSection>

          <CollapsibleSection
            id="transition"
            title="转场"
            summary={transition ? transitionChoiceLabel(transition.presentation) : '最后一段没有转场'}
            open={openSections.transition}
            onToggle={toggleSection}
          >
            {transition ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {TRANSITION_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={cn(
                        'rounded-md border px-2 py-2 text-left transition',
                        transition.presentation === preset.id
                          ? 'border-violet-500/60 bg-violet-500/15 text-violet-100'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700',
                      )}
                      onClick={() => applyTransitionPatch(preset.patch)}
                    >
                      <span className="block text-xs font-semibold">
                        {preset.label}
                      </span>
                      <span className="mt-1 block text-[9px] leading-snug text-zinc-500">
                        {preset.summary}
                      </span>
                    </button>
                  ))}
                </div>
                <FieldGrid>
                  <NumberField
                    label="转场时长"
                    value={transition.duration_sec}
                    min={0}
                    max={1.5}
                    step={0.05}
                    onChange={(value) =>
                      applyTransitionPatch({ duration_sec: value })
                    }
                  />
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-medium text-zinc-500">
                      方向
                    </span>
                    <Select
                      value={transition.direction ?? 'from-right'}
                      disabled={transition.presentation !== 'slide'}
                      onChange={(event) =>
                        applyTransitionPatch({
                          direction: event.target
                            .value as TimelineTransition['direction'],
                        })
                      }
                    >
                      <option value="from-right">从右侧</option>
                      <option value="from-left">从左侧</option>
                      <option value="from-top">从顶部</option>
                      <option value="from-bottom">从底部</option>
                    </Select>
                  </label>
                </FieldGrid>
              </>
            ) : (
              <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                当前是最后一个段落，没有到下一段的转场。
              </p>
            )}
          </CollapsibleSection>
            </>
          ) : null}

          {trackId === 'overlay' ? (
          <CollapsibleSection
            id="subtitles"
            title="字幕 / 花字 / 水印"
            summary={selectedOverlay?.text || '未选择文字层'}
            open={openSections.subtitles}
            onToggle={toggleSection}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => addOverlay(scene.id, createOverlay(scene, scene.overlays.length))}
            >
              <Plus className="h-3.5 w-3.5" />
              添加文字层
            </Button>
            {selectedOverlay ? (
              <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                <Textarea
                  className="min-h-[72px] text-xs"
                  value={selectedOverlay.text}
                  onChange={(event) =>
                    updateOverlay(scene.id, selectedOverlay.id, {
                      text: event.target.value,
                    })
                  }
                />
                <FieldGrid>
                  <NumberField
                    label="开始时间"
                    value={selectedOverlay.start_sec}
                    min={scene.start_sec}
                    max={scene.end_sec}
                    step={0.1}
                    onChange={(value) =>
                      updateOverlay(scene.id, selectedOverlay.id, { start_sec: value })
                    }
                  />
                  <NumberField
                    label="结束时间"
                    value={selectedOverlay.end_sec}
                    min={scene.start_sec}
                    max={scene.end_sec}
                    step={0.1}
                    onChange={(value) =>
                      updateOverlay(scene.id, selectedOverlay.id, { end_sec: value })
                    }
                  />
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-medium text-zinc-500">
                      位置
                    </span>
                    <Select
                      value={selectedOverlay.layout.position}
                      onChange={(event) =>
                        updateOverlay(scene.id, selectedOverlay.id, {
                          layout: {
                            ...selectedOverlay.layout,
                            position: event.target
                              .value as OverlayLayer['layout']['position'],
                          },
                        })
                      }
                    >
                      <option value="top">顶部</option>
                      <option value="center">居中</option>
                      <option value="bottom">底部</option>
                      <option value="left">左侧</option>
                      <option value="right">右侧</option>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-medium text-zinc-500">
                      类型
                    </span>
                    <Select
                      value={selectedOverlay.type}
                      onChange={(event) =>
                        updateOverlay(scene.id, selectedOverlay.id, {
                          type: event.target.value as OverlayLayer['type'],
                        })
                      }
                    >
                      <option value="subtitle">字幕</option>
                      <option value="big_caption">花字 / 大标题</option>
                      <option value="sticker">角标 / 标签</option>
                      <option value="cta">水印 / 署名</option>
                    </Select>
                  </label>
                  <NumberField
                    label="字号"
                    value={selectedOverlay.style.font_size}
                    min={12}
                    max={96}
                    step={1}
                    onChange={(value) =>
                      updateOverlay(scene.id, selectedOverlay.id, {
                        style: { ...selectedOverlay.style, font_size: value },
                      })
                    }
                  />
                  <NumberField
                    label="透明度"
                    value={selectedOverlay.style.opacity ?? 1}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(value) =>
                      updateOverlay(scene.id, selectedOverlay.id, {
                        style: { ...selectedOverlay.style, opacity: value },
                      })
                    }
                  />
                </FieldGrid>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-300 hover:text-red-200"
                    onClick={() => removeOverlay(scene.id, selectedOverlay.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                在文字轨选择一个片段，或点击上方添加字幕、花字、水印或角标。
              </p>
            )}
          </CollapsibleSection>
          ) : null}

          {trackId === 'effect' ? (
          <CollapsibleSection
            id="effects"
            title="插件参数"
            summary={effectChoiceLabel(scene.effects?.preset)}
            open={openSections.effects}
            onToggle={toggleSection}
          >
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-zinc-500">
                效果插件
              </span>
              <Select
                value={scene.effects?.preset ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  updateSceneEffect(
                    scene.id,
                    value && isKnownEffectPreset(value)
                      ? createDefaultEffect(value as EffectPresetId)
                      : undefined,
                  )
                }}
              >
                {EFFECT_CHOICES.map((choice) => (
                  <option key={choice.value || 'none'} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </label>
            {scene.effects ? (
              <EffectParameterControls
                scene={scene}
                updateSceneEffect={updateSceneEffect}
              />
            ) : (
              <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                请选择一个效果插件，然后调整遮罩、畸变、调色等参数。
              </p>
            )}
          </CollapsibleSection>
          ) : null}

          {trackId === 'audio' ? (
          <CollapsibleSection
            id="audio"
            title="配乐 / 音效 / 口播"
            summary={
              selectedAudio
                ? `${assetName(renderPlan.assets, selectedAudio.asset_id)} · ${Math.round(selectedAudio.volume * 100)}%`
                : '当前片段无音频'
            }
            open={openSections.audio}
            onToggle={toggleSection}
          >
            {selectedAudio ? (
              <>
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-medium text-zinc-500">
                    音频类型
                  </span>
                  <Select
                    value={selectedAudio.type}
                    onChange={(event) =>
                      updateAudio(scene.id, selectedAudio.id, {
                        type: event.target.value as AudioLayer['type'],
                      })
                    }
                  >
                    <option value="bgm">配乐</option>
                    <option value="sfx">音效</option>
                    <option value="voiceover">口播</option>
                  </Select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-medium text-zinc-500">
                    音频素材
                  </span>
                  <Select
                    value={selectedAudio.asset_id ?? ''}
                    onChange={(event) =>
                      updateAudio(scene.id, selectedAudio.id, {
                        asset_id: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">无素材</option>
                    {audioAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <FieldGrid>
                  <NumberField
                    label="音量"
                    value={selectedAudio.volume}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(value) =>
                      updateAudio(scene.id, selectedAudio.id, { volume: value })
                    }
                  />
                  <NumberField
                    label="开始时间"
                    value={selectedAudio.start_sec}
                    min={0}
                    max={renderPlan.duration_sec}
                    step={0.1}
                    onChange={(value) =>
                      updateAudio(scene.id, selectedAudio.id, {
                        start_sec: value,
                      })
                    }
                  />
                </FieldGrid>
              </>
            ) : (
              <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                当前片段没有可编辑音频层。
              </p>
            )}
          </CollapsibleSection>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-zinc-800 bg-zinc-950/90 px-4 py-4">
          <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">
                RenderPlan revision {renderPlan.plan_revision ?? 1}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-medium text-[0px]',
                  renderPlanSyncStatus === 'synced' && 'bg-emerald-500/10 text-emerald-300',
                  renderPlanSyncStatus === 'dirty' && 'bg-amber-500/10 text-amber-300',
                  renderPlanSyncStatus === 'syncing' && 'bg-blue-500/10 text-blue-300',
                  renderPlanSyncStatus === 'failed' && 'bg-red-500/10 text-red-300',
                )}
              >
                <span className="text-[11px]">
                  {renderPlanSyncStatus === 'synced'
                    ? '已同步后端'
                    : renderPlanSyncStatus === 'dirty'
                      ? '未同步'
                      : renderPlanSyncStatus === 'syncing'
                        ? '同步中'
                        : '同步失败'}
                </span>
                {renderPlanSyncStatus === 'synced'
                  ? '已同步后端'
                  : renderPlanSyncStatus === 'dirty'
                    ? '未同步'
                    : renderPlanSyncStatus === 'syncing'
                      ? '同步中'
                      : '同步失败'}
              </span>
            </div>
            {renderPlanChangeSummary ? (
              <p className="mt-1 line-clamp-2 text-zinc-500">{renderPlanChangeSummary}</p>
            ) : null}
            {renderPlanSyncError ? (
              <p className="mt-1 line-clamp-2 text-red-300">{renderPlanSyncError}</p>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full text-[0px]"
            disabled={renderPlanSyncStatus === 'syncing' || (!isDirty && !renderPlanDirty)}
          >
            <Check className="h-4 w-4" />
            <span className="text-sm">保存 RenderPlan</span>
            保存 RenderPlan
          </Button>
          <p className="mt-2 text-center text-[10px] leading-relaxed text-zinc-600">
            保存后只更新 RenderPlan，不会自动重新渲染 mp4。如需更新成片，请在对话中说「渲染」。
          </p>
        </footer>
      </form>
    </PanelShell>
  )
}
