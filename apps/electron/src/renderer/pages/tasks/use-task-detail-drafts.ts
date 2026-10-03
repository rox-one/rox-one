import { useLayoutEffect, useReducer, useRef } from 'react'
import type { TaskLinkKind } from '@rox/core/tasks/personal'
import { capturePersonalTaskScope } from '@/lib/personal-tasks'

/** Unsubmitted form input only; durable task values stay in the canonical store. */
export interface TaskDetailDraft {
  tagDraft?: string
  linkId?: string
  linkKind?: TaskLinkKind
}

type DraftOwner = {
  workspaceId: string | undefined
  current: () => boolean
  mounted: boolean
  drafts: Map<string, TaskDetailDraft>
}

export function useTaskDetailDrafts(workspaceId: string | undefined) {
  const ownerRef = useRef<DraftOwner | null>(null)
  const [, redraw] = useReducer((revision: number) => revision + 1, 0)
  if (!ownerRef.current || ownerRef.current.workspaceId !== workspaceId || !ownerRef.current.current()) {
    ownerRef.current = { workspaceId, current: capturePersonalTaskScope(), mounted: false, drafts: new Map() }
  }
  const owner = ownerRef.current
  useLayoutEffect(() => {
    owner.mounted = true
    return () => { owner.mounted = false; owner.drafts.clear() }
  }, [owner])
  const current = () => owner === ownerRef.current && owner.mounted && owner.current()
  return {
    current,
    get: (id: string) => owner.current() ? owner.drafts.get(id) : undefined,
    patch(id: string, draft: Partial<TaskDetailDraft>) {
      if (!current()) return
      owner.drafts.set(id, { ...owner.drafts.get(id), ...draft })
      redraw()
    },
    clearSubmitted<K extends keyof TaskDetailDraft>(id: string, field: K, submitted: TaskDetailDraft[K]) {
      if (!current() || owner.drafts.get(id)?.[field] !== submitted) return
      const draft = { ...owner.drafts.get(id) }
      delete draft[field]
      if (Object.keys(draft).length) owner.drafts.set(id, draft)
      else owner.drafts.delete(id)
      redraw()
    },
  }
}
