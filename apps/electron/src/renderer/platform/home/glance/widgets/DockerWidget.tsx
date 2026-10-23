/** Local docker containers (read-only, via the main process engine socket). */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { homeFetchApi } from '@/lib/home-fetch'
import type { HomeDockerResult } from '../../../../../shared/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, StatusDot, usePoll, useOnScreen } from './net/kit'

export default function DockerWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const load = React.useCallback(() => homeFetchApi()?.docker() ?? Promise.resolve<HomeDockerResult>({ status: 'error', reason: 'unavailable' }), [])
  const { data } = usePoll<HomeDockerResult>(load, 30_000, visible)
  const runningOnly = config.runningOnly === true
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-docker="">
      {!data ? <ListSkeleton rows={3} /> : data.status === 'error' ? (
        <p className="text-sm text-muted-foreground" role="status">{t('glance.net.dockerUnavailable')}</p>
      ) : (() => {
        const list = data.containers.filter((c) => !runningOnly || c.state === 'running').sort((a, b) => a.name.localeCompare(b.name))
        if (list.length === 0) return <p className="text-sm text-muted-foreground">{t('entities.ui.tree.empty')}</p>
        return (
          <ul className="flex flex-col gap-0.5">
            {list.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2 px-1 py-0.5" title={c.image}>
                <StatusDot ok={c.state === 'running' ? true : c.state === 'exited' || c.state === 'dead' ? false : null} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{c.name}</span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        )
      })()}
    </div>
  )
}
