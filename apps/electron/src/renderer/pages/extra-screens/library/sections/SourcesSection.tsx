import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { navigate, routes } from '@/lib/navigate'
import { OverviewGroup, OverviewRow, sourceOverviewStatus } from '@/pages/connections-overview'
import type { LoadedSource } from '../../../../../shared/types'

/** Sources-only list for «Библиотека», reusing the overview row/group atoms. */
export default function SourcesSection({ workspaceId }: { workspaceId: string; rootPath?: string }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<LoadedSource[]>([])

  useEffect(() => {
    let stale = false
    const keep = (rows: LoadedSource[]) => rows.filter((source) => source.workspaceId === workspaceId)
    void window.electronAPI
      .getSources(workspaceId)
      .then((rows) => { if (!stale) setSources(keep(rows)) })
      .catch(() => { /* keep the last list */ })
    const off = window.electronAPI.onSourcesChanged((id, next) => { if (id === workspaceId) setSources(keep(next)) })
    return () => {
      stale = true
      off()
    }
  }, [workspaceId])

  const sorted = [...sources].sort((a, b) => a.config.name.localeCompare(b.config.name))

  return (
    <OverviewGroup
      title={t('connections.overview.sources')}
      count={sorted.length}
      action={
        <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.sources())}>
          {t('connections.overview.addSource')}
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <li className="px-4 py-3 text-sm text-muted-foreground">{t('connections.overview.noSources')}</li>
      ) : (
        sorted.map((source) => {
          const slug = source.config.slug
          const subtitle = [t(`connections.overview.sourceType.${source.config.type}`), source.config.connectionError || source.config.tagline]
            .filter(Boolean)
            .join(' · ')
          return (
            <OverviewRow
              key={slug}
              icon={<SourceAvatar source={source} size="sm" />}
              title={source.config.name}
              subtitle={subtitle}
              status={sourceOverviewStatus(source)}
            >
              <Button size="sm" variant="ghost" onClick={() => navigate(routes.view.sources({ sourceSlug: slug }))}>
                {t('common.open')}
              </Button>
            </OverviewRow>
          )
        })
      )}
    </OverviewGroup>
  )
}