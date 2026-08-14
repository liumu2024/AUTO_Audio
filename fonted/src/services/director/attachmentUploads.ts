import { browserWorkspaceSessionId } from '@/services/director/workspaceSessionLifecycle'
import type { AttachmentUpload, InputAttachment } from '@/stores/creationStore'
import { useCreationStore } from '@/stores/creationStore'
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore'

function attachmentTypeFromMime(mime: string): InputAttachment['type'] | null {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  return null
}

async function uploadAttachment(
  upload: Pick<AttachmentUpload, 'id' | 'file' | 'type'>,
  workspaceSessionId: string,
) {
  if (!upload.file) return
  const store = useCreationStore.getState()
  try {
    const material = await useMaterialLibraryStore.getState().addFromFileWithHash(upload.file)
    if (browserWorkspaceSessionId() !== workspaceSessionId) {
      store.completeAttachmentUpload(upload.id)
      return
    }
    store.addAttachment({
      id: `att_${material.id}`,
      name: material.name,
      type: upload.type,
      url: material.url,
      source: 'upload',
      materialId: material.id,
      tags: material.tags,
    })
    store.completeAttachmentUpload(upload.id)
  } catch (error) {
    if (browserWorkspaceSessionId() !== workspaceSessionId) {
      store.completeAttachmentUpload(upload.id)
      return
    }
    store.failAttachmentUpload(
      upload.id,
      error instanceof Error ? error.message : '上传失败',
    )
  }
}

export function ingestAttachmentFiles(files: FileList | File[] | null) {
  if (!files?.length) return
  const store = useCreationStore.getState()
  const workspaceSessionId = browserWorkspaceSessionId()
  const uploads = Array.from(files).flatMap((file) => {
    const type = attachmentTypeFromMime(file.type)
    return type
      ? [{ id: `upload_${crypto.randomUUID()}`, name: file.name, type, file }]
      : []
  })
  for (const upload of uploads) store.beginAttachmentUpload(upload)
  for (const upload of uploads) void uploadAttachment(upload, workspaceSessionId)
}

export function retryAttachmentFileUpload(upload: AttachmentUpload) {
  if (!upload.file) return
  useCreationStore.getState().retryAttachmentUpload(upload.id)
  void uploadAttachment(upload, browserWorkspaceSessionId())
}
