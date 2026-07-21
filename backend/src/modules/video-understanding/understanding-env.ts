import { env, isUnderstandingConfigured } from '../../config/env.js'

/** 视频理解模块配置 — API Key 与 endpoint 均来自 backend/.env（见 config/env.ts） */
export const understandingEnv = {
  apiKey: env.videoUnderstandingApiKey,
  filesUrl: env.videoUnderstandingFilesUrl,
  responsesUrl: env.videoUnderstandingResponsesUrl,
  model: env.videoUnderstandingModel,
  preprocessVideoFps: env.videoUnderstandingPreprocessFps,
  timeoutMs: env.videoUnderstandingTimeoutMs,
  fileReadyTimeoutMs: env.videoUnderstandingFileReadyTimeoutMs,
  fileReadyPollIntervalMs: env.videoUnderstandingFileReadyPollIntervalMs,
  debugArtifactDir: env.videoUnderstandingDebugArtifactDir,
}

export { isUnderstandingConfigured }
