import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePropertyEditorStore } from '@/stores/propertyEditorStore'
import { useTimelineStore } from '@/stores/timelineStore'

export function UnsavedChangesDialog() {
  const open = usePropertyEditorStore((s) => s.unsavedDialogOpen)
  const confirmDiscardAndLoad = usePropertyEditorStore((s) => s.confirmDiscardAndLoad)
  const cancelPendingLoad = usePropertyEditorStore((s) => s.cancelPendingLoad)
  const pendingLoad = usePropertyEditorStore((s) => s.pendingLoad)

  const handleConfirm = () => {
    const clipId = pendingLoad?.clipId
    confirmDiscardAndLoad()
    if (clipId != null) {
      useTimelineStore.setState({ selectedClipId: clipId })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) cancelPendingLoad()
      }}
    >
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle>当前修改未保存</DialogTitle>
          <DialogDescription>
            是否丢弃未保存的编辑并切换到其他片段？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="secondary" onClick={cancelPendingLoad}>
            继续编辑
          </Button>
          <Button type="button" variant="highlight" onClick={handleConfirm}>
            丢弃并切换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
