import { useEffect, useState } from 'react'

/** Measured Conductor task slug count. Stays null until a successful fetch. */
export function useWorkspaceTaskCount(workspaceId: string | null | undefined): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!workspaceId || typeof window.electronAPI?.listTasks !== 'function') {
      setCount(null)
      return
    }
    let cancelled = false
    setCount(null)
    void window.electronAPI
      .listTasks(workspaceId)
      .then((ids) => {
        if (!cancelled) setCount(ids.length)
      })
      .catch(() => {
        if (!cancelled) setCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return count
}
