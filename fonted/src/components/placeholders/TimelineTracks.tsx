const TRACKS = [
  { id: 'video', label: '视频', color: 'bg-violet-500/70' },
  { id: 'audio', label: '音频', color: 'bg-emerald-500/70' },
  { id: 'text', label: '字幕', color: 'bg-amber-500/70' },
]

const CLIPS = [
  { track: 0, start: 0, width: 18 },
  { track: 0, start: 22, width: 28 },
  { track: 1, start: 4, width: 42 },
  { track: 2, start: 8, width: 24 },
  { track: 2, start: 38, width: 16 },
]

export function TimelineTracks() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">时间线</span>
        <span className="font-mono text-[10px] text-zinc-500">00:00 / 01:00</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex min-w-[120%] flex-1 flex-col">
          <div className="flex shrink-0 border-b border-zinc-800/80">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="flex h-6 min-w-[80px] flex-1 items-end justify-center border-r border-zinc-800/50 pb-1"
              >
                <span className="font-mono text-[10px] text-zinc-600">
                  {String(i * 5).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="flex w-16 shrink-0 flex-col border-r border-zinc-800">
              {TRACKS.map((track) => (
                <div
                  key={track.id}
                  className="flex h-12 items-center justify-center border-b border-zinc-800/80 text-[10px] text-zinc-500"
                >
                  {track.label}
                </div>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              {TRACKS.map((track, trackIndex) => (
                <div
                  key={track.id}
                  className="relative h-12 border-b border-zinc-800/80 bg-zinc-950/50"
                >
                  {CLIPS.filter((c) => c.track === trackIndex).map((clip, i) => (
                    <div
                      key={i}
                      className={`absolute top-1.5 bottom-1.5 rounded ${track.color}`}
                      style={{
                        left: `${clip.start}%`,
                        width: `${clip.width}%`,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
