import * as api from '@/lib/api'

/** blob: / data: 等本地 URL 先上传到后端，返回可访问的 HTTP URL */
export async function ensurePublicUrl(
  url: string,
  filename: string,
): Promise<string> {
  if (!url || (!url.startsWith('blob:') && !url.startsWith('data:'))) {
    return url
  }

  const res = await fetch(url)
  const blob = await res.blob()
  const file = new File([blob], filename, {
    type: blob.type || 'application/octet-stream',
  })
  const uploaded = await api.uploadFile(file)
  return uploaded.url
}
