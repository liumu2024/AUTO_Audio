import { classifyExternalUrlAccess } from '../../../shared/lib/external-url-access.js'
import { resolveUploadedAssetPath } from '../modules/upload/upload.service.js'
import {
  deleteArkImageFile,
  uploadArkImageFile,
  waitForArkImageFileReady,
} from './ark-file-input.js'

export type ArkResponsesImageInput =
  | { type: 'input_image'; image_url: string }
  | { type: 'input_image'; file_id: string }

export interface ArkImageMaterialInput {
  id: string
  name?: string
  source: string
  publicUrl?: string
}

export interface ArkImageInputReport {
  requested_image_material_count: number
  attached_image_input_count: number
  ark_file_input_count: number
  public_url_input_count: number
  attached_material_ids: string[]
  failed_material_ids: string[]
  omitted_material_ids: string[]
  warnings: string[]
}

export interface PreparedArkImageInputs {
  content: ArkResponsesImageInput[]
  temporaryFileIds: string[]
  warnings: string[]
  report: ArkImageInputReport
}

export type ServerImageAccess =
  | { kind: 'public_url'; value: string }
  | { kind: 'upload_path'; value: string }

export async function resolveServerImageAccess(source: string): Promise<ServerImageAccess | undefined> {
  const access = classifyExternalUrlAccess(source)
  if (access.ok) return { kind: 'public_url', value: access.normalizedUrl ?? source }
  const uploadedPath = await resolveUploadedAssetPath(source)
  return uploadedPath ? { kind: 'upload_path', value: uploadedPath } : undefined
}

export async function prepareArkImageInputs(input: {
  materials: ArkImageMaterialInput[]
  maxInputs: number
}): Promise<PreparedArkImageInputs> {
  const selected = input.materials.slice(0, Math.max(0, input.maxInputs))
  const content: ArkResponsesImageInput[] = []
  const temporaryFileIds: string[] = []
  const warnings: string[] = []
  const attachedMaterialIds: string[] = []
  const failedMaterialIds: string[] = []
  let publicUrlInputCount = 0

  for (const material of selected) {
    try {
      const preferredAccess = material.publicUrl
        ? await resolveServerImageAccess(material.publicUrl)
        : undefined
      const access = preferredAccess?.kind === 'public_url'
        ? preferredAccess
        : await resolveServerImageAccess(material.source)
      if (access?.kind === 'public_url') {
        content.push({ type: 'input_image', image_url: access.value })
        attachedMaterialIds.push(material.id)
        publicUrlInputCount += 1
        continue
      }

      if (!access) throw new Error('image is not a server-readable upload or reachable URL')
      const uploaded = await uploadArkImageFile({ localPath: access.value, originalName: material.name })
      try {
        await waitForArkImageFileReady(uploaded.fileId)
      } catch (error) {
        await deleteArkImageFile(uploaded.fileId)
        throw error
      }
      temporaryFileIds.push(uploaded.fileId)
      content.push({ type: 'input_image', file_id: uploaded.fileId })
      attachedMaterialIds.push(material.id)
    } catch (error) {
      failedMaterialIds.push(material.id)
      warnings.push(`${material.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    content,
    temporaryFileIds,
    warnings,
    report: {
      requested_image_material_count: input.materials.length,
      attached_image_input_count: content.length,
      ark_file_input_count: temporaryFileIds.length,
      public_url_input_count: publicUrlInputCount,
      attached_material_ids: attachedMaterialIds,
      failed_material_ids: failedMaterialIds,
      omitted_material_ids: input.materials.slice(selected.length).map((material) => material.id),
      warnings,
    },
  }
}

export async function releaseArkImageInputs(input: Pick<PreparedArkImageInputs, 'temporaryFileIds'>): Promise<void> {
  await Promise.all(input.temporaryFileIds.map((fileId) => deleteArkImageFile(fileId)))
}
