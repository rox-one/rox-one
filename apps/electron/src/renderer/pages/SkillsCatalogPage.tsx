import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp, ChevronDown, ChevronRight, PackageOpen, Search, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { Button } from '@/components/ui/button'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { skillSelection } from '@/hooks/useEntitySelection'
import { navigate, routes } from '@/lib/navigate'
import { buildCapabilityCatalog, CAPABILITY_CATEGORIES, filterCapabilityCatalog, setCatalogPackEnabled, type CapabilityCategory } from '@/lib/capability-catalog'
import type { CapabilityRef } from '@rox/core/runtime-trace'
import type { SkillUsageMap } from '@rox/shared/memory/types'
import type { LoadedSkill, BundledSkillPackStatus } from '../../shared/types'

export interface SkillsCatalogPageProps {
  workspaceId: string
  workingDirectory?: string
  workspaceRootPath?: string
  usedCapabilities?: CapabilityRef[]
}
export default function SkillsCatalogPage({ workspaceId, workingDirectory, workspaceRootPath, usedCapabilities }: SkillsCatalogPageProps) {
  const { t, i18n } = useTranslation()
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  const [packs, setPacks] = React.useState<BundledSkillPackStatus[]>([])
  const [usage, setUsage] = React.useState<SkillUsageMap | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<CapabilityCategory | 'all'>('all')
  const [scope, setScope] = React.useState<CapabilityRef['scope'] | 'all'>('all')
  const [sort, setSort] = React.useState<'name' | 'usage'>('name')
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const selection = skillSelection.useSelection()
  const contextGuard = React.useMemo(() => Symbol(`${workspaceId}:${workingDirectory ?? ''}`), [workspaceId, workingDirectory])
  const currentGuard = React.useRef(contextGuard)
  currentGuard.current = contextGuard
  const currentWorkspace = React.useRef(workspaceId)
  currentWorkspace.current = workspaceId
  React.useEffect(() => {
    let stale = false
    let generation = 0
    setSkills([]); setUsage(null); setPacks([]); setError(null); setLoading(true); setExpanded(null); setBusy(null)
    const load = async () => {
      const request = ++generation
      try {
        const [loaded, packResult, usageResult] = await Promise.all([
          window.electronAPI.getSkills(workspaceId, workingDirectory),
          window.electronAPI.listBundledSkillPacks().catch(() => null),
          window.electronAPI.getSkillUsage(workspaceId).catch(() => null),
        ])
        if (stale || request !== generation) return
        setSkills(loaded); setUsage(usageResult)
        if (packResult !== null) setPacks(packResult)
        setError(packResult === null ? t('capabilityCatalog.packLoadFailed') : null)
      } catch {
        if (!stale && request === generation) setError(t('capabilityCatalog.loadFailed'))
      } finally { if (!stale && request === generation) setLoading(false) }
    }
    void load()
    const off = window.electronAPI.onSkillsChanged(id => { if (id === workspaceId) void load() })
    const offPacks = window.electronAPI.onBundledSkillsChanged(() => void load())
    const offPending = window.electronAPI.onSkillsPendingChanged(id => { if (id === workspaceId) void load() })
    return () => { stale = true; generation++; off(); offPacks(); offPending() }
  }, [workspaceId, workingDirectory, t])
  const rows = React.useMemo(() => filterCapabilityCatalog(buildCapabilityCatalog({ skills, packs, usage, usedCapabilities }), { query, category, scope })
    .sort((a, b) => sort === 'usage' ? (b.promptHits ?? -1) - (a.promptHits ?? -1) || a.ref.label.localeCompare(b.ref.label) : a.ref.label.localeCompare(b.ref.label)), [skills, packs, usage, usedCapabilities, query, category, scope, sort])
  const togglePack = async (pack: BundledSkillPackStatus) => {
    if (busy) return
    const capturedWorkspace = workspaceId
    const capturedGuard = currentGuard.current
    setBusy(pack.slug)
    try {
      const result = await setCatalogPackEnabled(window.electronAPI, packs, pack.slug, pack.disabled)
      if ((currentWorkspace.current !== capturedWorkspace || currentGuard.current !== capturedGuard)) return
      setPacks(result.packs)
      if (result.failures.length) toast.error(t('capabilityCatalog.packPartial'), { description: result.failures.join(', ') })
      const readback = await window.electronAPI.getSkills(workspaceId, workingDirectory)
      if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) setSkills(readback)
    } catch (err) {
      if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) toast.error(t('capabilityCatalog.packUpdateFailed'))
    } finally { if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) setBusy(null) }
  }
  const exportOmp = async (skill: LoadedSkill) => {
    if (busy) return
    const capturedWorkspace = workspaceId
    const capturedGuard = currentGuard.current
    setBusy(skill.slug)
    try {
      const result = await window.electronAPI.importOmpSkill(workspaceId, skill.slug)
      const readback = await window.electronAPI.getSkills(workspaceId, workingDirectory)
      if ((currentWorkspace.current !== capturedWorkspace || currentGuard.current !== capturedGuard)) return
      if (!readback.some(item => item.source === 'workspace' && item.slug === result.slug)) throw new Error(t('capabilityCatalog.readbackFailed'))
      setSkills(readback)
      toast.success(t('skillsList.ompExported', { name: skill.metadata.name, slug: result.slug }))
    } catch (err) { if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) toast.error(t('skillsList.ompExportFailed'), { description: err instanceof Error ? err.message : undefined }) }
    finally { if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) setBusy(null) }
  }
  return (
    <div className="h-full overflow-auto min-w-0" data-testid="skills-catalog"
      style={{ '--muted-foreground': 'color-mix(in oklch, var(--foreground) 78%, var(--background))' } as React.CSSProperties}>
      <div className="mx-auto w-full max-w-[1440px] space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="flex items-center gap-2 text-base font-semibold"><Zap className="size-4" />{t('capabilityCatalog.skillsTitle')}</h1><p className="mt-1 text-xs text-muted-foreground">{t('capabilityCatalog.skillsDescription')}</p></div>
          {workspaceRootPath && <EditPopover trigger={<Button variant="outline" size="sm">{t('skillsList.addSkill')}</Button>} {...getEditConfig('add-skill', workspaceRootPath)} />}
        </header>
        {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
        {packs.length > 0 && <section aria-label={t('settings.context.bundledTitle')}>
          <h2 className="mb-3 text-sm font-medium">{t('settings.context.bundledTitle')}</h2>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
            {packs.map(pack => <article key={pack.slug} className="rounded-xl border border-border/60 p-3.5" data-testid="catalog-skill-pack">
              <div className="mb-3 flex items-center justify-between gap-2"><PackageOpen className="size-4 text-muted-foreground" /><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void togglePack(pack)} aria-label={t(pack.disabled ? 'capabilityCatalog.enablePack' : 'capabilityCatalog.disablePack', { name: pack.slug })}>{t(pack.disabled ? 'capabilityCatalog.enable' : 'capabilityCatalog.disable')}</Button></div>
              <h3 className="text-sm font-medium break-words">{pack.slug}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground" title={pack.skills.join(', ')}>{pack.skills.slice(0, 5).map(slug => skills.find(skill => skill.slug === slug)?.metadata.name ?? slug).join(', ')}</p>
              <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><span>{t('capabilityCatalog.packInstalled', { installed: pack.installed.length, count: pack.skills.length })}</span><span>{t(pack.disabled ? 'capabilityCatalog.packDisabled' : 'capabilityCatalog.packEnabled')}</span>{pack.localModified && <span>{t('settings.context.bundledLocalModified')}</span>}</div>
              {pack.error && <p className="mt-2 text-xs text-destructive">{pack.error}</p>}
              <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{t('capabilityCatalog.dependencies')}</summary><ul className="mt-1 space-y-1">{[...new Set(skills.filter(skill => pack.skills.includes(skill.slug)).flatMap(skill => skill.metadata.requiredSources ?? []))].map(slug => <li key={slug}>{slug}</li>)}</ul></details>
            </article>)}
          </div>
        </section>}
        <section aria-label={t('capabilityCatalog.individualSkills')}>
          <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-medium">{t('capabilityCatalog.individualSkills')} <span className="ml-1 rounded bg-foreground/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">{rows.length}</span></h2>
            <label className="relative"><Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('capabilityCatalog.searchSkills')} aria-label={t('capabilityCatalog.searchSkills')} className="h-8 w-52 max-w-full rounded-md border border-border/60 bg-transparent pl-7 pr-2 text-xs" /></label>
            <select aria-label={t('capabilityCatalog.category')} value={category} onChange={e => setCategory(e.target.value as typeof category)} className="h-8 max-w-full rounded-md border border-border/60 bg-background px-2 text-xs"><option value="all">{t('capabilityCatalog.allCategories')}</option>{CAPABILITY_CATEGORIES.map(item => <option key={item} value={item}>{t(`capabilityCatalog.categories.${item}`)}</option>)}</select>
            <select aria-label={t('capabilityCatalog.scope')} value={scope} onChange={e => setScope(e.target.value as typeof scope)} className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"><option value="all">{t('capabilityCatalog.allScopes')}</option>{(['workspace', 'project', 'global', 'omp'] as const).map(item => <option key={item} value={item}>{t(`capabilityCatalog.scopes.${item}`)}</option>)}</select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/60"><table className="w-full min-w-[680px] border-collapse text-left text-xs" aria-label={t('capabilityCatalog.individualSkills')}>
            <thead className="bg-foreground/[0.025] text-muted-foreground"><tr>{['name', 'description', 'category', 'usage', 'author', 'updated'].map(key => <th key={key} scope="col" className="border-b border-border/60 px-3 py-2.5 font-medium" aria-sort={key === 'name' && sort === 'name' ? 'ascending' : key === 'usage' && sort === 'usage' ? 'descending' : undefined}>{key === 'name' || key === 'usage' ? <button type="button" className="flex items-center gap-1" onClick={() => setSort(key === 'name' ? 'name' : 'usage')}>{t(`capabilityCatalog.columns.${key}`)}<ArrowDownUp className="size-3" /></button> : t(`capabilityCatalog.columns.${key}`)}</th>)}</tr></thead>
            <tbody>{rows.map(row => <React.Fragment key={row.key}><tr className="border-b border-border/40 hover:bg-foreground/[0.025]" data-testid="catalog-skill-row">
              <td className="px-3 py-3"><div className="flex items-center gap-2"><input type="checkbox" aria-label={t('capabilityCatalog.selectResource', { name: row.ref.label })} checked={selection.isSelected(row.ref.id)} onChange={() => selection.toggle(row.ref.id, rows.indexOf(row))} /><SkillAvatar skill={row.skill!} size="sm" workspaceId={workspaceId} /><button type="button" className="text-left font-medium hover:underline" onClick={() => navigate(routes.view.skills(row.ref.id))}>{row.ref.label}<span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">@{row.ref.id} · {t(`capabilityCatalog.scopes.${row.ref.scope}`)}</span></button></div></td>
              <td className="max-w-60 px-3 py-3"><button type="button" onClick={() => setExpanded(expanded === row.key ? null : row.key)} aria-expanded={expanded === row.key} aria-label={t('capabilityCatalog.showDetails', { name: row.ref.label })} className="flex items-center gap-1 text-left text-muted-foreground"><span className="line-clamp-2">{row.description}</span>{expanded === row.key ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}</button></td>
              <td className="px-3 py-3"><span className="rounded border border-border/60 bg-foreground/[0.025] px-1.5 py-0.5 text-[11px] text-muted-foreground">{row.categories.map(item => t(`capabilityCatalog.categories.${item}`)).join(', ')}</span></td>
              <td className="px-3 py-3 text-muted-foreground" title={t('capabilityCatalog.promptHitsHint')}>{row.promptHits === undefined ? '—' : t('capabilityCatalog.promptHits', { count: row.promptHits })}{row.usedInRun && <span className="block">{t('capabilityCatalog.usedInRun')}</span>}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.author ?? '—'}</td><td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString(i18n.resolvedLanguage) : '—'}</td>
            </tr>{expanded === row.key && <tr className="border-b border-border/50 bg-foreground/[0.02]"><td colSpan={6} className="space-y-2 px-4 py-3"><p>{row.description}</p><p className="text-muted-foreground">{t('capabilityCatalog.dependencies')}: {row.requiredSources.join(', ') || '—'}</p><p className="text-muted-foreground">{t(`capabilityCatalog.status.${row.status}`)}{row.lastPromptHit ? ` · ${new Date(row.lastPromptHit).toLocaleDateString(i18n.resolvedLanguage)}` : ''}</p>{row.skill?.source === 'omp' && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void exportOmp(row.skill!)}>{t('skillsList.ompExport')}</Button>}</td></tr>}</React.Fragment>)}</tbody>
          </table></div>
          {loading && <p role="status" className="py-4 text-center text-xs text-muted-foreground">{t('common.loading')}</p>}
          {!loading && rows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{t('capabilityCatalog.noResults')}</p>}
        </section>
      </div>
    </div>
  )
}
