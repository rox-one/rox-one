import { useEffect, useRef, useState } from 'react'
import type { PersonalTask } from '@craft-agent/core/tasks/personal'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'
import { PersonalTaskCreationError } from '@/lib/personal-tasks-sync'

/** Source-owned conversion: a durable task receipt precedes every link or success message. */
export function useConfirmedTaskConversion(options: {
  sourceKey: string
  source: unknown
  workspaceId: string | null
  input: { title: string; notes?: string; list?: 'inbox' | 'today' }
  onConfirmed?: (task: PersonalTask, isCurrent: () => boolean) => Promise<boolean>
}) {
  const sourceKey = JSON.stringify([options.workspaceId, options.sourceKey, options.input])
  const scope = useRef({ key: sourceKey, source: options.source })
  if (scope.current.key !== sourceKey || scope.current.source !== options.source) scope.current = { key: sourceKey, source: options.source }
  const marker = scope.current
  const mounted = useRef(false)
  const lifecycle = useRef(0)
  const attempt = useRef<{ marker: typeof marker; actor: string; task?: PersonalTask; accepted: boolean } | null>(null)
  const running = useRef<typeof marker | null>(null)
  const [state, setState] = useState<{ marker: typeof marker; busy: boolean; taskId: string | null; failed: boolean }>({ marker, busy: false, taskId: null, failed: false })
  useEffect(() => {
    mounted.current = true
    const off = window.electronAPI?.onIdentityChanged?.(() => {
      lifecycle.current++
      scope.current = { ...scope.current }
      attempt.current = null; running.current = null
      setState({ marker: scope.current, busy: false, taskId: null, failed: false })
    })
    return () => { mounted.current = false; lifecycle.current++; off?.() }
  }, [])
  const convert = async (): Promise<PersonalTask | null> => {
    const own = scope.current
    if (!mounted.current || own !== marker) return null
    if (running.current === own || state.marker === own && state.taskId) return null
    const epoch = lifecycle.current
    const current = () => mounted.current && scope.current === own && lifecycle.current === epoch
    running.current = own
    setState({ marker: own, busy: true, taskId: null, failed: false })
    let saved = attempt.current?.marker === own ? attempt.current : null
    try {
      const readActor = async () => {
        const identity = await window.electronAPI?.getOrgIdentity?.()
        const workspaceId = await window.electronAPI?.getWindowWorkspace?.()
        if (!identity || !['native', 'local'].includes(identity.authority)
          || typeof identity.userId !== 'string' || !identity.userId.trim()
          || identity.authority === 'native' && (typeof identity.issuer !== 'string' || !identity.issuer.trim() || !options.workspaceId)
          || options.workspaceId !== null && workspaceId !== options.workspaceId) throw new Error('Task conversion authority unavailable')
        return JSON.stringify([identity.authority, identity.issuer, identity.userId, workspaceId])
      }
      const actor = await readActor()
      if (!current()) return null
      if (!saved || saved.actor !== actor) saved = { marker: own, actor, accepted: false }
      attempt.current = saved
      if (!saved.accepted) {
        saved.task = await createPersonalTaskConfirmed(options.input, saved.task)
        saved.accepted = true
      }
      if (!current()) return null
      if (await readActor() !== actor || !current()) throw new Error('Task conversion caller changed')
      const task = saved.task!
      if (options.onConfirmed && !await options.onConfirmed(task, current)) throw new Error('Task conversion link was not confirmed')
      if (!current()) return null
      setState({ marker: own, busy: false, taskId: task.id, failed: false })
      return task
    } catch (error) {
      if (current()) {
        if (error instanceof PersonalTaskCreationError && saved) saved.task = error.task
        setState({ marker: own, busy: false, taskId: null, failed: true })
      }
      return null
    } finally { if (running.current === own) running.current = null }
  }
  return { convert, busy: state.marker === marker && state.busy, taskId: state.marker === marker ? state.taskId : null, failed: state.marker === marker && state.failed }
}
