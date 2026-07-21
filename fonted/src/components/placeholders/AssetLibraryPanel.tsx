import { Film, ImageIcon, Music2 } from 'lucide-react'

import { usePipelineStore } from '@/stores/pipelineStore'
import type { UserMaterialDto } from '@/types/pipeline'

const TYPE_ICON = {
  VIDEO: Film,
  IMAGE: ImageIcon,
  AUDIO: Music2,
} as const

function materialTypeLabel(m: UserMaterialDto) {
  return m.material_type.toLowerCase() as keyof typeof TYPE_ICON
}

export function AssetLibraryPanel() {
  const materials = usePipelineStore((s) => s.bundle?.materials)

  return (
    <div className="scroll-area-y flex h-full min-h-0 flex-col gap-3 pr-1">
      <p className="text-xs text-zinc-500">
        上传的素材将出现在此处，可拖入时间线或画布区使用。
      </p>
      {!materials?.length ? (
        <p className="text-xs text-zinc-600">等待 Pipeline 加载…</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {materials.map((asset) => {
            const typeKey = materialTypeLabel(asset)
            const Icon = TYPE_ICON[typeKey] ?? Film
            return (
              <li
                key={asset.id}
                className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2"
              >
                <div className="flex aspect-video items-center justify-center rounded bg-zinc-800/80">
                  <Icon className="h-6 w-6 text-zinc-500" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-zinc-200">
                    {asset.label}
                  </p>
                  <p className="text-[10px] text-zinc-500">{asset.status}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
