/**
 * useCommandGateway — renderer hook for the owner's pending-command console
 * (RX-DOC-0032 phase 0). Loads the workspace's pending commands and exposes
 * approve/deny. Polls on an interval while the panel is mounted; degrades to
 * `available: false` when the transport lacks the handlers.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { RPC_CHANNELS } from '../../shared/types'
import type { PendingCommand } from '@craft-agent/server-core/command-gateway'

const POLL_MS = 10_000

export interface UseCommandGatewayResult {
  available: boolean
  isLoading: boolean
  commands: PendingCommand[]
  error: string | null
  refresh: () => void
  approve: (id: string) => Promise<void>
  deny: (id: string) => Promise<void>
}

export function useCommandGateway(workspaceId: string | undefined): UseCommandGatewayResult {
  const [available, setAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [commands, setCommands] = useState<PendingCommand[]>([])
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const api = window.electronAPI
    if (!api || !workspaceId) return
    try {
      const list = await api.listPendingCommands({ workspaceId })
      setCommands(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isChannelAvailable?.(RPC_CHANNELS.commandGateway.LIST)) {
      setAvailable(false)
      setIsLoading(false)
      return
    }
    if (!workspaceId) {
      setIsLoading(false)
      return
    }
    setAvailable(true)

    void load().finally(() => setIsLoading(false))
    timer.current = setInterval(() => void load(), POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [workspaceId, load])

  const decide = useCallback(
    async (kind: 'approve' | 'deny', id: string) => {
      const api = window.electronAPI
      if (!api || !workspaceId) return
      try {
        await (kind === 'approve'
          ? api.approveCommand({ workspaceId, id })
          : api.denyCommand({ workspaceId, id }))
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, load],
  )

  const approve = useCallback((id: string) => decide('approve', id), [decide])
  const deny = useCallback((id: string) => decide('deny', id), [decide])

  return { available, isLoading, commands, error, refresh: () => void load(), approve, deny }
}
