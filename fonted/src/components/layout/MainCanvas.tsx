import { MigrationCanvas } from '@/components/canvas/MigrationCanvas'

export function MainCanvas() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <MigrationCanvas />
    </div>
  )
}
