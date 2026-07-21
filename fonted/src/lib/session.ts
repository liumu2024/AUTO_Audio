const ACTIVE_TASK_KEY = 'dpl304:activeTaskId'

export function readSavedTaskId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TASK_KEY)
  } catch {
    return null
  }
}

export function saveTaskId(taskId: string | null): void {
  try {
    if (taskId) {
      localStorage.setItem(ACTIVE_TASK_KEY, taskId)
    } else {
      localStorage.removeItem(ACTIVE_TASK_KEY)
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const base = path.split('/').pop()
    return base || 'sample-video.mp4'
  } catch {
    return 'sample-video.mp4'
  }
}

export { filenameFromUrl }
