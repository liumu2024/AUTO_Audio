import { Sparkles, Upload, Wand2 } from 'lucide-react'

export function EditorEmptyState() {
  return (
    <div className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        aria-hidden
      >
        <div className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full bg-fuchsia-600/10 blur-3xl" />
      </div>

      <div className="editor-empty-shimmer relative z-10 w-full max-w-lg">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="border-b border-white/5 px-6 py-4">
            <EditorEmptyIllustration />
          </div>

          <div className="space-y-4 px-6 py-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 ring-1 ring-violet-400/30">
              <Sparkles className="h-5 w-5 text-violet-300" />
            </div>
            <div className="space-y-2">
              <h2 className="text-base font-semibold tracking-tight text-zinc-100">
                开启你的 AI 视频复刻
              </h2>
              <p className="text-sm leading-relaxed text-zinc-400">
                上传样例视频，AI 将拆解营销结构与节奏；在左侧配置创作指令后，一键解析并生成时间线。
              </p>
            </div>

            <ul className="mx-auto max-w-sm space-y-2 text-left text-xs text-zinc-500">
              <li className="flex items-start gap-2">
                <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                <span>创作配置 → 上传样例与参考素材</span>
              </li>
              <li className="flex items-start gap-2">
                <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                <span>解析样例 → 语义锚点与时间线自动就绪</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditorEmptyIllustration() {
  return (
    <svg
      viewBox="0 0 400 160"
      className="mx-auto h-32 w-full max-w-md text-zinc-600"
      aria-hidden
    >
      <defs>
        <linearGradient id="emptyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#d946ef" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect
        x="24"
        y="28"
        width="140"
        height="88"
        rx="8"
        fill="url(#emptyGrad)"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
      <rect
        x="236"
        y="28"
        width="140"
        height="88"
        rx="8"
        fill="#18181b"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <circle cx="94" cy="72" r="18" fill="#27272a" stroke="#52525b" />
      <polygon
        points="88,72 100,66 100,78"
        fill="#a78bfa"
        fillOpacity="0.8"
      />
      <path
        d="M180 72 L220 72"
        stroke="#71717a"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <circle cx="220" cy="72" r="4" fill="#a78bfa" />
      <rect x="260" y="48" width="92" height="8" rx="2" fill="#3f3f46" />
      <rect x="260" y="64" width="72" height="6" rx="2" fill="#27272a" />
      <rect x="260" y="88" width="48" height="16" rx="4" fill="#8b5cf6" fillOpacity="0.25" />
      <text
        x="200"
        y="148"
        textAnchor="middle"
        fill="currentColor"
        fillOpacity="0.35"
        fontSize="11"
        fontFamily="system-ui,sans-serif"
      >
        Sample → Structure → Generate
      </text>
    </svg>
  )
}
