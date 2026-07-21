import { MaterialLibraryManager } from '@/components/sidebar/MaterialLibraryManager'

/** 全屏素材 / 作品库管理 */
export function AssetsShellView() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-800 px-8 py-6">
        <h1 className="text-xl font-semibold text-zinc-100">我的素材 / 作品库</h1>
        <p className="mt-1 text-sm text-zinc-500">
          管理本地参考素材；解析任务时可将素材同步至后端
        </p>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden px-8 py-4">
        <MaterialLibraryManager embedded />
      </div>
    </div>
  )
}
