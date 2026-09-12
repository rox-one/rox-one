import { useEffect, useState } from 'react'

export interface PromoInsights {
  loaded: boolean
  onboarded?: boolean
  totalLessons?: number
}

export function usePromoInsights(workspaceId?: string): PromoInsights {
  const [state, setState] = useState<PromoInsights>({ loaded: false })

  useEffect(() => {
    let cancelled = false
    setState({ loaded: false })
    if (typeof window.electronAPI?.listInsights !== 'function') {
      return () => {
        cancelled = true
      }
    }
    void window.electronAPI
      .listInsights(workspaceId)
      .then((insights) => {
        if (!cancelled) {
          setState({
            loaded: true,
            onboarded: insights.onboarded,
            totalLessons: insights.totalLessons,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ loaded: false })
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return state
}
