export type NoteCommentDraft = { quote: string; body: string }
export const EMPTY_COMMENT_DRAFT: NoteCommentDraft = { quote: '', body: '' }

export function noteCommentDraftKey(workspaceId: string | null, noteId: string | null): string | null {
  return workspaceId && noteId ? JSON.stringify([workspaceId, noteId]) : null
}

/** Editing a second note, or the same path in another workspace, cannot retarget an unsent comment. */
export function updateCommentDraft(
  drafts: ReadonlyMap<string, NoteCommentDraft>,
  key: string | null,
  patch: Partial<NoteCommentDraft>,
): ReadonlyMap<string, NoteCommentDraft> {
  if (!key) return drafts
  const next = new Map(drafts)
  const draft = { ...(drafts.get(key) ?? EMPTY_COMMENT_DRAFT), ...patch }
  if (!draft.body && !draft.quote) next.delete(key)
  else next.set(key, draft)
  return next
}
