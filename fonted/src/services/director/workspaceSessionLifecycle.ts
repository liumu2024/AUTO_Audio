export const ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY =
  'v2.director.active-workspace-session-id'
export const LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY =
  'v2.director.workspace-session-id'

export interface WorkspaceSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const VALID_WORKSPACE_SESSION_ID = /^[a-zA-Z0-9_-]{8,100}$/

export function resolveActiveDirectorWorkspaceSessionId(input: {
  sessionStorage: WorkspaceSessionStorage
  legacyStorage: WorkspaceSessionStorage
  createId: () => string
}): string {
  input.legacyStorage.removeItem(LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY)

  const existing = input.sessionStorage.getItem(
    ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY,
  )
  if (existing && VALID_WORKSPACE_SESSION_ID.test(existing)) return existing

  const id = input.createId()
  input.sessionStorage.setItem(ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY, id)
  return id
}

export function rememberActiveDirectorWorkspaceSessionId(
  storage: WorkspaceSessionStorage,
  id: string,
): void {
  if (!VALID_WORKSPACE_SESSION_ID.test(id)) return
  storage.setItem(ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY, id)
}

export function replaceActiveDirectorWorkspaceSession(input: {
  sessionStorage: WorkspaceSessionStorage
  createId: () => string
}): string {
  const id = input.createId()
  rememberActiveDirectorWorkspaceSessionId(input.sessionStorage, id)
  return id
}

export function browserWorkspaceSessionId(): string {
  return resolveActiveDirectorWorkspaceSessionId({
    sessionStorage: window.sessionStorage,
    legacyStorage: window.localStorage,
    createId: () => `v2_director_${crypto.randomUUID()}`,
  })
}

export async function restoreWorkspaceDraft<TDraft>(input: {
  workspace: { draftId?: string }
  loadDraft: (draftId: string) => Promise<TDraft>
  openDraft: (draft: TDraft) => void
}): Promise<boolean> {
  if (!input.workspace.draftId) return false
  const draft = await input.loadDraft(input.workspace.draftId)
  input.openDraft(draft)
  return true
}
