/**
 * useBackgroundTasks - Hook for managing active background tasks
 *
 * Tracks background agents and shells per session.
 * Updated via event handlers for task_backgrounded, shell_backgrounded, task_progress.
 */

import { useAtom } from 'jotai'
import { useCallback } from 'react'
import { backgroundTasksAtomFamily, type BackgroundTask } from '@/atoms/sessions'

export interface UseBackgroundTasksOptions {
  /** Session ID to track tasks for */
  sessionId: string
}

export interface UseBackgroundTasksResult {
  /** Active background tasks for this session */
  tasks: BackgroundTask[]
  /** Add a new background task */
  addTask: (task: Omit<BackgroundTask, 'elapsedSeconds'>) => void
  /** Update elapsed time for a task */
  updateTaskProgress: (toolUseId: string, elapsedSeconds: number) => void
  /** Remove a task chip (when completed, or hidden by the user). */
  removeTask: (toolUseId: string) => void
  /**
   * Stop a background SHELL task: ask the host to kill the underlying process
   * (`sessions:killShell`) and then drop the chip.
   *
   * There is deliberately no agent variant. A background AGENT task has no
   * renderer-reachable stop: its cancellation is owned by the agent runtime
   * (the model's own `TaskStop` tool, or the session-level Stop that aborts the
   * whole turn), so the UI never offers a kill for it. Use `removeTask` to hide
   * an agent chip without pretending the task was stopped.
   */
  stopShellTask: (shellId: string) => Promise<void>
}

/**
 * Hook for managing background tasks in a session
 */
export function useBackgroundTasks({ sessionId }: UseBackgroundTasksOptions): UseBackgroundTasksResult {
  const [tasks, setTasks] = useAtom(backgroundTasksAtomFamily(sessionId))

  const addTask = useCallback((task: Omit<BackgroundTask, 'elapsedSeconds'>) => {
    setTasks(prev => {
      // Check if task already exists (prevent duplicates)
      if (prev.some(t => t.toolUseId === task.toolUseId)) {
        return prev
      }
      // Add new task with 0 elapsed seconds
      return [...prev, { ...task, elapsedSeconds: 0 }]
    })
  }, [setTasks])

  const updateTaskProgress = useCallback((toolUseId: string, elapsedSeconds: number) => {
    setTasks(prev => prev.map(t =>
      t.toolUseId === toolUseId
        ? { ...t, elapsedSeconds }
        : t
    ))
  }, [setTasks])

  const removeTask = useCallback((toolUseId: string) => {
    setTasks(prev => prev.filter(t => t.toolUseId !== toolUseId))
  }, [setTasks])

  const stopShellTask = useCallback(async (shellId: string) => {
    // Ask the host to kill the shell process. The shell may already be gone —
    // that is fine: the user asked to stop it, so the chip still goes away.
    try {
      await window.electronAPI.killShell(sessionId, shellId)
    } catch {
      // Ignore — the chip is dropped below either way.
    }
    setTasks(prev => prev.filter(t => t.id !== shellId))
  }, [sessionId, setTasks])

  return {
    tasks,
    addTask,
    updateTaskProgress,
    removeTask,
    stopShellTask,
  }
}
