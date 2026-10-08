import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import type { AgentProfile, AgentProfileInput } from '@rox/shared/workspace-work'
import { useWorkspaceWork } from '@/lib/useWorkspaceWork'

const fieldClass = 'w-full rounded-lg border border-border/70 bg-background px-2.5 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const buttonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[13px] transition-colors motion-reduce:transition-none hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none'
type CatalogItem = { slug: string; name: string }
type ProfileDraft = AgentProfileInput & { id: string | null; expectedRevision: number }

export function AgentProfilesView({ workspaceId }: { workspaceId: string; projectId?: string }) {
  const { t } = useTranslation()
  const work = useWorkspaceWork(workspaceId)
  const { snapshot } = work
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [catalog, setCatalog] = useState<{ sources: CatalogItem[]; skills: CatalogItem[]; loading: boolean; error: boolean }>({ sources: [], skills: [], loading: true, error: false })
  const [catalogReload, setCatalogReload] = useState(0)
  const [sourceQuery, setSourceQuery] = useState('')
  const [skillQuery, setSkillQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  useEffect(() => { setDraft(null); setDeleteTarget(null); setSourceQuery(''); setSkillQuery('') }, [workspaceId])
  useEffect(() => {
    let active = true
    setCatalog({ sources: [], skills: [], loading: true, error: false })
    Promise.resolve().then(() => Promise.all([window.electronAPI.getSources(workspaceId), window.electronAPI.getSkills(workspaceId)])).then(([sources, skills]) => {
      if (!active) return
      setCatalog({
        sources: sources.filter(source => source.workspaceId === workspaceId).map(source => ({ slug: source.config.slug, name: source.config.name })),
        skills: [...new Map<string, CatalogItem>(skills.filter(skill => !skill.shadowedByCraft).map(skill => [skill.slug, { slug: skill.slug, name: skill.metadata.name }])).values()],
        loading: false, error: false,
      })
    }, () => { if (active) setCatalog({ sources: [], skills: [], loading: false, error: true }) })
    return () => { active = false }
  }, [workspaceId, catalogReload])

  const canManage = snapshot?.access.canManage === true
  const busy = work.pending || !snapshot
  const profileExists = !draft?.id || snapshot?.profiles.some(profile => profile.id === draft.id)
  const begin = (profile?: AgentProfile) => {
    if (!snapshot) return
    setDeleteTarget(null)
    setDraft(profile ? { ...profile, id: profile.id, expectedRevision: snapshot.revision } : {
      id: null, expectedRevision: snapshot.revision, name: '', role: '', sourceSlugs: [], skillSlugs: [], memoryScope: 'workspace', automationEnabled: false,
    })
  }
  const missing = useMemo(() => draft ? [...new Set([
    ...draft.sourceSlugs.filter(slug => !catalog.sources.some(item => item.slug === slug)),
    ...draft.skillSlugs.filter(slug => !catalog.skills.some(item => item.slug === slug)),
  ])] : [], [draft, catalog])
  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.role.trim()) return
    const input: AgentProfileInput = { name: draft.name.trim(), role: draft.role.trim(), sourceSlugs: draft.sourceSlugs, skillSlugs: draft.skillSlugs, memoryScope: draft.memoryScope, automationEnabled: draft.automationEnabled }
    const ok = await work.write(draft.id ? { kind: 'updateProfile', id: draft.id, patch: input } : { kind: 'createProfile', input }, draft.expectedRevision)
    if (ok) setDraft(null)
  }

  const catalogPicker = (kind: 'sources' | 'skills', query: string, onQuery: (value: string) => void) => {
    if (!draft) return null
    const selected = kind === 'sources' ? draft.sourceSlugs : draft.skillSlugs
    const items = catalog[kind].filter(item => `${item.name} ${item.slug}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    return <fieldset className="min-w-0 space-y-2">
      <legend className="font-medium">{t(`navigation.work.profiles.${kind}`)}</legend>
      <input type="search" className={fieldClass} value={query} onChange={event => onQuery(event.target.value)} aria-label={t(`navigation.work.profiles.search${kind === 'sources' ? 'Sources' : 'Skills'}`)} />
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
        {items.map(item => <label key={item.slug} className="flex min-h-8 items-start gap-2 text-[13px]">
          <input type="checkbox" checked={selected.includes(item.slug)} disabled={!canManage || busy || !profileExists} className="mt-1 accent-[var(--accent)]" onChange={event => {
            const next = event.target.checked ? [...selected, item.slug] : selected.filter(slug => slug !== item.slug)
            setDraft({ ...draft, [kind === 'sources' ? 'sourceSlugs' : 'skillSlugs']: next })
          }} />
          <span className="min-w-0 break-words">{item.name}<span className="ml-1 text-xs text-muted-foreground">{item.slug}</span></span>
        </label>)}
        {!items.length && <p className="text-muted-foreground">{t('navigation.work.profiles.catalogEmpty')}</p>}
      </div>
    </fieldset>
  }

  return <section className="flex h-full min-h-0 flex-col bg-background font-sans text-[13px]" data-testid="agent-profiles-view">
    <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
      <Bot className="size-4 text-accent" aria-hidden /><h2 className="mr-auto text-[15px] font-semibold">{t('navigation.work.profiles.title')}</h2>
      <button type="button" className={buttonClass} disabled={work.loading} onClick={() => { void work.refresh(); setCatalogReload(value => value + 1) }} aria-label={t('navigation.work.refresh')}><RefreshCw className="size-3.5" aria-hidden /></button>
      <button type="button" className={buttonClass} disabled={!canManage || busy} onClick={() => begin()}><Plus className="size-3.5" aria-hidden />{t('navigation.work.profiles.new')}</button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <p className="max-w-2xl text-muted-foreground">{t('navigation.work.profiles.explanation')}</p>
      {work.loading && !snapshot && <p role="status">{t('navigation.work.loading')}</p>}
      {work.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">{t(`navigation.work.errors.${work.error.code}`)}</div>}
      {snapshot && !canManage && <p role="status" className="text-muted-foreground">{t('navigation.work.readOnly')}</p>}
      {snapshot && <div className="space-y-1" role="list">
        {snapshot.profiles.map(profile => <div role="listitem" key={profile.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-3">
          <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => begin(profile)}><span className="block font-medium">{profile.name}</span><span className="block truncate text-muted-foreground">{profile.role}</span></button>
          {snapshot.defaultProfileId === profile.id && <span className="inline-flex items-center gap-1 text-accent"><Star className="size-3" aria-hidden />{t('navigation.work.profiles.default')}</span>}
          {snapshot.defaultProfileId !== profile.id && <button type="button" className={buttonClass} disabled={!canManage || busy} onClick={() => void work.write({ kind: 'setDefaultProfile', profileId: profile.id })}>{t('navigation.work.profiles.makeDefault')}</button>}
          <button type="button" className={buttonClass} disabled={!canManage || !snapshot.access.canDelete || busy} onClick={() => setDeleteTarget(profile.id)} aria-label={t('navigation.work.profiles.deleteNamed', { name: profile.name })}><Trash2 className="size-3.5" aria-hidden /></button>
          {deleteTarget === profile.id && <div className="flex w-full flex-wrap items-center gap-2" role="alert"><span>{t('navigation.work.profiles.deleteConfirm')}</span><button type="button" className={buttonClass} disabled={busy} onClick={() => void work.remove({ kind: 'profile', id: profile.id }).then(ok => { if (ok) { setDeleteTarget(null); if (draft?.id === profile.id) setDraft(null) } })}>{t('navigation.work.delete')}</button><button type="button" className={buttonClass} onClick={() => setDeleteTarget(null)}>{t('navigation.work.cancel')}</button></div>}
        </div>)}
        {!snapshot.profiles.length && <p className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">{t('navigation.work.profiles.empty')}</p>}
        {snapshot.defaultProfileId && <button type="button" className={buttonClass} disabled={!canManage || busy} onClick={() => void work.write({ kind: 'setDefaultProfile', profileId: null })}>{t('navigation.work.profiles.clearDefault')}</button>}
      </div>}
      {draft && <form className="max-w-3xl space-y-4 rounded-lg border border-border/70 p-4" onSubmit={event => { event.preventDefault(); void save() }}>
        <h3 className="font-semibold">{t(draft.id ? 'navigation.work.profiles.edit' : 'navigation.work.profiles.new')}</h3>
        {!profileExists && <p role="alert" className="text-destructive">{t('navigation.work.profiles.deleted')}</p>}
        <label className="block space-y-1"><span>{t('navigation.work.profiles.name')}</span><input required maxLength={200} className={fieldClass} value={draft.name} disabled={!canManage || busy || !profileExists} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="block space-y-1"><span>{t('navigation.work.profiles.role')}</span><textarea required className={`${fieldClass} min-h-24 resize-y`} value={draft.role} disabled={!canManage || busy || !profileExists} onChange={event => setDraft({ ...draft, role: event.target.value })} /></label>
        {catalog.loading && <p role="status">{t('navigation.work.profiles.catalogLoading')}</p>}
        {catalog.error && <p role="alert" className="text-destructive">{t('navigation.work.profiles.catalogError')}</p>}
        {!catalog.loading && !catalog.error && <div className="grid gap-4 sm:grid-cols-2">{catalogPicker('sources', sourceQuery, setSourceQuery)}{catalogPicker('skills', skillQuery, setSkillQuery)}</div>}
        {missing.length > 0 && !catalog.error && !catalog.loading && <div className="space-y-2 text-destructive"><p>{t('navigation.work.profiles.missingCatalog')}</p>{missing.map(slug => <button type="button" key={slug} className={buttonClass} disabled={!canManage || busy || !profileExists} onClick={() => setDraft({ ...draft, sourceSlugs: draft.sourceSlugs.filter(item => item !== slug), skillSlugs: draft.skillSlugs.filter(item => item !== slug) })}>{t('navigation.work.profiles.removeMissing', { slug })}</button>)}</div>}
        <label className="block space-y-1"><span>{t('navigation.work.profiles.memory')}</span><select className={fieldClass} value={draft.memoryScope} disabled={!canManage || busy || !profileExists} onChange={event => setDraft({ ...draft, memoryScope: event.target.value as 'workspace' | 'none' })}><option value="workspace">{t('navigation.work.profiles.workspaceMemory')}</option><option value="none">{t('navigation.work.profiles.noMemory')}</option></select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.automationEnabled} disabled={!canManage || busy || !profileExists} onChange={event => setDraft({ ...draft, automationEnabled: event.target.checked })} />{t('navigation.work.profiles.automation')}</label>
        {snapshot && draft.expectedRevision !== snapshot.revision && <div className="space-y-2 rounded-lg bg-amber-500/10 p-3" role="status"><p>{t('navigation.work.draftChanged')}</p><button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, expectedRevision: snapshot.revision })}>{t('navigation.work.keepDraftRetry')}</button></div>}
        <div className="flex flex-wrap gap-2"><button type="submit" className={`${buttonClass} bg-accent/10 text-accent`} disabled={!canManage || busy || !profileExists || catalog.error || catalog.loading || missing.length > 0 || !draft.name.trim() || !draft.role.trim()}>{t(work.pending ? 'navigation.work.saving' : 'navigation.work.save')}</button><button type="button" className={buttonClass} disabled={work.pending} onClick={() => setDraft(null)}>{t('navigation.work.cancel')}</button></div>
      </form>}
    </div>
  </section>
}

export default AgentProfilesView
