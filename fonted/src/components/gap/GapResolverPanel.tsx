import {
  AlertTriangle,
  ArrowLeftRight,
  Loader2,
  Type,
  Wand2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getGapWarningMessage } from '@/lib/gap-utils'
import { cn } from '@/lib/utils'
import {
  useGapResolverStore,
  type GapStrategy,
} from '@/stores/gapResolverStore'

const STRATEGIES: {
  id: GapStrategy
  option: string
  title: string
  description: string
  icon: typeof ArrowLeftRight
  featured?: boolean
}[] = [
  {
    id: 'restructure',
    option: 'A',
    title: '智能结构重排',
    description: '自动调整脚本，降低对该镜头的依赖',
    icon: ArrowLeftRight,
  },
  {
    id: 'dynamic_packaging',
    option: 'B',
    title: '动态包装补全',
    description: '生成带转场特效的卖点花字替代画面',
    icon: Type,
  },
  {
    id: 'aigc',
    option: 'C',
    title: 'AIGC 画面生成',
    description: '调用文生视频补足缺失镜头',
    icon: Wand2,
    featured: true,
  },
]

export function GapResolverPanel() {
  const isOpen = useGapResolverStore((s) => s.isOpen)
  const gapAnchor = useGapResolverStore((s) => s.gapAnchor)
  const selectedStrategy = useGapResolverStore((s) => s.selectedStrategy)
  const isApplying = useGapResolverStore((s) => s.isApplying)
  const closeGap = useGapResolverStore((s) => s.dismissGap)
  const selectStrategy = useGapResolverStore((s) => s.selectStrategy)
  const applyStrategy = useGapResolverStore((s) => s.applyStrategy)

  const handleOpenChange = (open: boolean) => {
    if (!open) closeGap()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'left-auto right-6 top-1/2 max-h-[min(90vh,640px)] w-[min(420px,calc(100vw-2rem))] -translate-x-0 -translate-y-1/2 overflow-y-auto',
          'rounded-xl border-zinc-800/90 bg-zinc-950/95 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_48px_-12px_rgba(0,0,0,0.75),0_0_80px_-20px_rgba(239,68,68,0.15)]',
          'data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
        )}
      >
        <DialogHeader className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-left text-base font-semibold text-red-100">
                素材缺口补全
              </DialogTitle>
              <DialogDescription className="text-left text-sm leading-snug text-red-200/80">
                {gapAnchor
                  ? getGapWarningMessage(gapAnchor)
                  : '检测到结构缺口，请选择补全策略'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            选择补全策略
          </p>
          <div className="grid gap-2.5" role="radiogroup" aria-label="补全策略">
            {STRATEGIES.map((strategy) => {
              const Icon = strategy.icon
              const isSelected = selectedStrategy === strategy.id
              return (
                <button
                  key={strategy.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => selectStrategy(strategy.id)}
                  className={cn(
                    'group relative flex w-full items-start gap-3 rounded-lg border bg-zinc-900/80 p-3.5 text-left transition-all duration-200',
                    'hover:border-zinc-600 hover:bg-zinc-900 hover:shadow-md hover:shadow-black/30',
                    isSelected
                      ? 'border-violet-500/70 bg-zinc-900 ring-2 ring-violet-500/30'
                      : 'border-zinc-800',
                    strategy.featured &&
                      'shadow-[0_0_20px_-4px_rgba(167,139,250,0.35)]',
                    strategy.featured &&
                      !isSelected &&
                      'border-violet-500/40 hover:border-violet-400/60',
                    strategy.featured &&
                      isSelected &&
                      'border-violet-400 shadow-[0_0_28px_-4px_rgba(167,139,250,0.55)]',
                  )}
                >
                  {strategy.featured && (
                    <span
                      className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-violet-400/30 ring-inset"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors',
                      isSelected
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400 group-hover:border-zinc-600 group-hover:text-zinc-200',
                      strategy.featured && 'text-violet-300',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        {strategy.option}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          isSelected ? 'text-zinc-50' : 'text-zinc-200',
                        )}
                      >
                        {strategy.title}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-zinc-500 group-hover:text-zinc-400">
                      {strategy.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <DialogFooter className="border-t border-zinc-800/80 pt-4 sm:justify-stretch">
          <Button
            type="button"
            variant="highlight"
            className="w-full"
            disabled={!selectedStrategy || isApplying}
            onClick={() => void applyStrategy()}
          >
            {isApplying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在重新渲染…
              </>
            ) : (
              '确认应用并重新渲染'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
