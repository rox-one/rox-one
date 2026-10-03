import * as React from 'react'
import type { SessionModelCatalog, StartupRuntimeSummary } from '@craft-agent/shared/protocol'

type CatalogState = { status: 'pending' | 'error' | 'ready'; catalog?: SessionModelCatalog | null }

/** Each session/workspace/connection transition owns its read, including A → B → A. */
export function useSessionModelCatalog(workspaceId: string | null, sessionId: string, connection: string | undefined, runtimeSummary?: StartupRuntimeSummary | null): CatalogState & { connectionUnavailable: boolean } {
  const scope = React.useMemo(() => ({ workspaceId, sessionId, connection, runtimeSummary }), [workspaceId, sessionId, connection, runtimeSummary])
  const [result, setResult] = React.useState<{ scope: typeof scope; state: CatalogState }>()
  React.useEffect(() => {
    if (!runtimeSummary || !workspaceId) return
    let current = true
    void window.electronAPI.getSessionModelCatalog(sessionId).then(catalog => {
      if (!current) return
      if (catalog && (catalog.sessionId !== sessionId || catalog.workspaceId !== workspaceId || connection && catalog.slug !== connection)) {
        setResult({ scope, state: { status: 'error' } })
        return
      }
      setResult({ scope, state: { status: 'ready', catalog } })
    }).catch(() => {
      if (current) setResult({ scope, state: { status: 'error' } })
    })
    return () => { current = false }
  }, [scope])
  const state: CatalogState = result?.scope === scope ? result.state : { status: 'pending' }
  return { ...state, connectionUnavailable: !!runtimeSummary && !!connection && state.status === 'ready' && state.catalog === null }
}
