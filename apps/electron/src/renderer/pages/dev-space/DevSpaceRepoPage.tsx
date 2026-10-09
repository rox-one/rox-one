import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { devSpaceErrorKey } from './components/errors'
import { DEV_SPACE_STATUS_KEYS, DEV_SPACE_STATUS_VARIANT, isRepositoryOutdated } from './components/status'

/** Surface stubs shipped in В1; artifact content lands in В2. */
const REPO_TABS = [
  { id: 'overview', labelKey: 'devSpace.repo.tabs.overview' },
  { id: 'wiki', labelKey: 'devSpace.repo.tabs.wiki' },
  { id: 'understanding', labelKey: 'devSpace.repo.tabs.understanding' },
  { id: 'graph', labelKey: 'devSpace.repo.tabs.graph' },
  { id: 'schemas', labelKey: 'devSpace.repo.tabs.schemas' },
  { id: 'knowledge', labelKey: 'devSpace.repo.tabs.knowledgeGraph' },
  { id: 'c4', labelKey: 'devSpace.repo.tabs.c4' },
] as const

/** Panel id for the controlled `role=tabpanel` of a repo surface tab. */
const repoPanelId = (id: string) => `dev-space-surface-panel-${id}`

export interface DevSpaceRepoPageProps { devSpaceRepoId?: string }

/** С-03 repo workspace — header + surface stubs (§B.3, В1 scope). */
export default function DevSpaceRepoPage({ devSpaceRepoId }: DevSpaceRepoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [record, setRecord] = useState<DevSpaceRepositoryRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [tab, setTab] = useState<string>(REPO_TABS[0].id)

  const load = useCallback(async () => {
    if (!workspaceId || !devSpaceRepoId) { setRecord(null); setLoading(false); return }
    setLoading(true)
    setErrorKey(null)
    try {
      const catalog = await window.electronAPI.listDevSpaceRepositories({ workspaceId })
      const list = catalog.repositories
      // The address is opaque: it may carry the catalog id or the project id
      // (project deep-link from the roadmap), so match either.
      setRecord(list.find((item) => item.id === devSpaceRepoId) ?? list.find((item) => item.projectId === devSpaceRepoId) ?? null)
    } catch (error) { setErrorKey(devSpaceErrorKey(error)) }
    finally { setLoading(false) }
  }, [workspaceId, devSpaceRepoId])

  useEffect(() => { void load() }, [load])

  const refresh = async () => {
    if (!workspaceId || !record) return
    const input = { workspaceId, repositoryId: record.id, requestId: crypto.randomUUID() }
    try { setRecord(await window.electronAPI.refreshDevSpaceRepository(input)) }
    catch (error) { setErrorKey(devSpaceErrorKey(error)) }
  }

  const outdated = record ? isRepositoryOutdated(record) : false
  const tabItems: TabItem[] = REPO_TABS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
    title: t(item.labelKey),
    controls: repoPanelId(item.id),
  }))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dev-space-repo">
      <PanelHeader
        title={record?.displayName ?? t('devSpace.repo.title')}
        badge={outdated ? <Badge variant="outline" data-testid="dev-space-outdated">{t('devSpace.repository.outdated')}</Badge> : undefined}
        actions={record ? <Button type="button" size="sm" variant="outline" data-testid="dev-space-repo-refresh" onClick={() => void refresh()}><RefreshCw className="icon-caption" aria-hidden />{t('devSpace.repository.refresh')}</Button> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {loading ? (
          <div className="space-y-3" aria-busy="true" data-testid="dev-space-repo-loading">
            <div className="h-8 w-64 animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none" />
            <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-border-subtle bg-surface-hover motion-reduce:animate-none" />
          </div>
        ) : errorKey ? (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-destructive">{t(errorKey)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t('devSpace.home.retry')}</Button>
          </div>
        ) : !record ? (
          <p className="text-sm text-muted-foreground" data-testid="dev-space-repo-not-found">{t('devSpace.repo.notFound')}</p>
        ) : (
          <div className="space-y-4">
            <Tabs
              items={tabItems}
              activeId={tab}
              variant="surface"
              density="compact"
              ariaLabel={t('devSpace.repo.title')}
              onSelect={setTab}
            />
            {REPO_TABS.map((item) => item.id === tab && (
              <section
                key={item.id}
                id={repoPanelId(item.id)}
                role="tabpanel"
                aria-labelledby={`dev-space-surface-title-${item.id}`}
                data-testid={`dev-space-surface-${item.id}`}
                className="rounded-[var(--radius-card)] border border-border-subtle p-6"
              >
                <h2 id={`dev-space-surface-title-${item.id}`} className="text-sm font-semibold">{t('devSpace.repo.stub.title')}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('devSpace.repo.stub.description')}</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={DEV_SPACE_STATUS_VARIANT[record.status]}>{t(DEV_SPACE_STATUS_KEYS[record.status])}</Badge>
                  <span>{t('devSpace.repo.stub.status', { status: t(DEV_SPACE_STATUS_KEYS[record.status]) })}</span>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}