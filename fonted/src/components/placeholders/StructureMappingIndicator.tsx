import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'

const MAPPING_STEPS = [
  { id: 'analyze', label: '结构分析', status: 'done' as const },
  { id: 'match', label: '素材匹配', status: 'active' as const },
  { id: 'compose', label: '成片合成', status: 'pending' as const },
]

export function StructureMappingIndicator() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">结构映射</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-4">
        <ul className="flex w-full max-w-[200px] flex-col gap-4">
          {MAPPING_STEPS.map((step, index) => (
            <li key={step.id} className="flex items-center gap-3">
              {step.status === 'done' ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : step.status === 'active' ? (
                <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500/40" />
                  <Circle className="relative h-5 w-5 fill-violet-500/20 text-violet-400" />
                </span>
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-zinc-600" />
              )}
              <span
                className={
                  step.status === 'active'
                    ? 'text-sm font-medium text-violet-300'
                    : step.status === 'done'
                      ? 'text-sm text-zinc-400'
                      : 'text-sm text-zinc-600'
                }
              >
                {step.label}
              </span>
              {index < MAPPING_STEPS.length - 1 && (
                <ArrowRight className="ml-auto h-4 w-4 text-zinc-700" />
              )}
            </li>
          ))}
        </ul>
        <div className="w-full max-w-[180px] space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full w-[45%] rounded-full bg-violet-500" />
          </div>
          <p className="text-center text-[10px] text-zinc-500">映射进度 45%</p>
        </div>
      </div>
    </div>
  )
}
