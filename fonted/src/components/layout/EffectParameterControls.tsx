import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { RenderScene, SceneEffects } from '@/types/render-plan'

interface EffectParameterControlsProps {
  scene: RenderScene
  updateSceneEffect: (sceneId: string, effects?: SceneEffects) => void
}

type EffectRecord = Record<string, unknown>

function isRecord(value: unknown): value is EffectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeDeep(base: EffectRecord, patch: EffectRecord): EffectRecord {
  const next: EffectRecord = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key]
    next[key] =
      isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value
  }
  return next
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
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
        step={step ?? 0.01}
        className="h-8 text-xs"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[10px] font-medium text-zinc-500">{label}</span>
      <Select
        value={value ?? options[0]?.value}
        className="h-8 text-xs"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean | undefined
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-300">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        className="h-4 w-4 accent-violet-500"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

export function EffectParameterControls({
  scene,
  updateSceneEffect,
}: EffectParameterControlsProps) {
  const effects = scene.effects
  if (!effects) return null

  const patchEffects = (patch: EffectRecord) => {
    updateSceneEffect(
      scene.id,
      mergeDeep(
        effects as unknown as EffectRecord,
        patch,
      ) as unknown as SceneEffects,
    )
  }

  const controls = (() => {
    switch (effects.preset) {
      case 'primitive_texture_grade':
        return (
          <>
            <NumberControl
              label="Saturation"
              value={effects.color_grade?.saturate}
              min={0}
              max={2.5}
              step={0.01}
              onChange={(value) => patchEffects({ color_grade: { saturate: value } })}
            />
            <NumberControl
              label="Contrast"
              value={effects.color_grade?.contrast}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => patchEffects({ color_grade: { contrast: value } })}
            />
            <NumberControl
              label="Brightness"
              value={effects.color_grade?.brightness}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => patchEffects({ color_grade: { brightness: value } })}
            />
          </>
        )
      case 'primitive_vignette_overlay':
        return (
          <>
            <NumberControl
              label="Vignette"
              value={effects.vignette.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ vignette: { opacity: value } })}
            />
            <NumberControl
              label="Radius"
              value={effects.vignette.radius_pct}
              min={10}
              max={100}
              step={1}
              onChange={(value) => patchEffects({ vignette: { radius_pct: value } })}
            />
          </>
        )
      case 'primitive_grain_overlay':
        return (
          <>
            <NumberControl
              label="Grain"
              value={effects.grain.opacity}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(value) => patchEffects({ grain: { opacity: value } })}
            />
            <NumberControl
              label="Size"
              value={effects.grain.size_px}
              min={1}
              max={20}
              step={1}
              onChange={(value) => patchEffects({ grain: { size_px: value } })}
            />
          </>
        )
      case 'primitive_bloom_overlay':
        return (
          <>
            <NumberControl
              label="Bloom"
              value={effects.bloom.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ bloom: { opacity: value } })}
            />
            <NumberControl
              label="Blur"
              value={effects.bloom.blur_px}
              min={0}
              max={80}
              step={1}
              onChange={(value) => patchEffects({ bloom: { blur_px: value } })}
            />
          </>
        )
      case 'cinematic_grade_pack':
        return (
          <>
            <NumberControl
              label="Saturation"
              value={effects.color_grade?.saturate}
              min={0}
              max={2.5}
              step={0.01}
              onChange={(value) => patchEffects({ color_grade: { saturate: value } })}
            />
            <NumberControl
              label="Contrast"
              value={effects.color_grade?.contrast}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => patchEffects({ color_grade: { contrast: value } })}
            />
            <NumberControl
              label="Vignette"
              value={effects.vignette?.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ vignette: { opacity: value } })}
            />
            <NumberControl
              label="Grain"
              value={effects.grain?.opacity}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(value) => patchEffects({ grain: { opacity: value } })}
            />
            <NumberControl
              label="Bloom"
              value={effects.bloom?.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ bloom: { opacity: value } })}
            />
          </>
        )
      case 'primitive_beat_pulse':
        return (
          <>
            <NumberControl
              label="Beat scale"
              value={effects.pulse?.scale}
              min={0}
              max={0.2}
              step={0.005}
              onChange={(value) => patchEffects({ pulse: { scale: value } })}
            />
            <NumberControl
              label="Shake"
              value={effects.shake?.amplitude_px}
              min={0}
              max={40}
              step={1}
              onChange={(value) => patchEffects({ shake: { amplitude_px: value } })}
            />
          </>
        )
      case 'primitive_beat_flash_overlay':
        return (
          <>
            <NumberControl
              label="Flash"
              value={effects.flash.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ flash: { opacity: value } })}
            />
            <ToggleControl
              label="Enable flash"
              checked={effects.flash.enabled}
              onChange={(value) => patchEffects({ flash: { enabled: value } })}
            />
          </>
        )
      case 'audio_reactive_cut_driver':
        return (
          <>
            <NumberControl
              label="Beat scale"
              value={effects.pulse?.scale}
              min={0}
              max={0.2}
              step={0.005}
              onChange={(value) => patchEffects({ pulse: { scale: value } })}
            />
            <NumberControl
              label="Flash"
              value={effects.flash?.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => patchEffects({ flash: { opacity: value } })}
            />
            <NumberControl
              label="Shake"
              value={effects.shake?.amplitude_px}
              min={0}
              max={40}
              step={1}
              onChange={(value) => patchEffects({ shake: { amplitude_px: value } })}
            />
            <ToggleControl
              label="Enable flash"
              checked={effects.flash?.enabled}
              onChange={(value) => patchEffects({ flash: { enabled: value } })}
            />
          </>
        )
      case 'primitive_slice_reveal':
      case 'mask_slice_transition':
        return (
          <>
            <NumberControl
              label="Slice count"
              value={effects.slice_count}
              min={1}
              max={24}
              step={1}
              onChange={(value) => patchEffects({ slice_count: Math.round(value) })}
            />
            <NumberControl
              label="Duration"
              value={effects.duration_sec}
              min={0.05}
              max={3}
              step={0.01}
              onChange={(value) => patchEffects({ duration_sec: value })}
            />
            <NumberControl
              label="Stagger"
              value={effects.stagger_sec}
              min={0}
              max={0.25}
              step={0.005}
              onChange={(value) => patchEffects({ stagger_sec: value })}
            />
            <SelectControl
              label="Direction"
              value={effects.direction}
              options={[
                { value: 'vertical', label: 'Vertical' },
                { value: 'horizontal', label: 'Horizontal' },
              ]}
              onChange={(value) => patchEffects({ direction: value })}
            />
            <SelectControl
              label="Mode"
              value={effects.mode}
              options={[
                { value: 'shuffle', label: 'Shuffle' },
                { value: 'reveal', label: 'Reveal' },
                { value: 'cover', label: 'Cover' },
              ]}
              onChange={(value) => patchEffects({ mode: value })}
            />
          </>
        )
      default:
        return (
          <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
            This primitive currently uses presets only.
          </p>
        )
    }
  })()

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <Label>Common parameters</Label>
      <div className="grid grid-cols-2 gap-2">{controls}</div>
    </div>
  )
}
