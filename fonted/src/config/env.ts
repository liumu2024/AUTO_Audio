/** 本机联调：在 .env.development 中配置 */

const apiBase = import.meta.env.VITE_API_BASE ?? ''
const useBackend =
  import.meta.env.VITE_USE_BACKEND === 'true' ||
  import.meta.env.VITE_USE_BACKEND === '1'

export const env = {
  /** 是否走后端 API（false 时保持纯前端 Mock） */
  useBackend,
  apiBase: apiBase.replace(/\/$/, '') || 'http://localhost:3001',
  userId: Number(import.meta.env.VITE_USER_ID ?? 1),
  sampleVideoUrl:
    import.meta.env.VITE_SAMPLE_VIDEO_URL ??
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
}
