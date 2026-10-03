import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { NotesRailTools, NotesResponsiveRail } from '../../../NotesWorkspaceChrome'
import { NotesRailSash, useNotesRailLayout } from '../../../NotesDocumentChrome'
const i18n = i18next.createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: { 'notes.toc.title': 'Contents', 'notes.comments.title': 'Comments', 'common.close': 'Close' } } }, interpolation: { escapeValue: false } })
const listeners = new Map<string, Set<unknown>>()
const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window)
for (const name of ['pointermove','pointerup','pointercancel','blur','keydown']) listeners.set(name, new Set())
window.addEventListener = ((name: string, handler: unknown, ...rest: any[]) => { listeners.get(name)?.add(handler); return add(name, handler as EventListener, ...rest) }) as typeof window.addEventListener
window.removeEventListener = ((name: string, handler: unknown, ...rest: any[]) => { listeners.get(name)?.delete(handler); return remove(name, handler as EventListener, ...rest) }) as typeof window.removeEventListener
function Fixture() {
 const [workspace, setWorkspace] = useState('a'), [note, setNote] = useState('note-a'), [hidden, setHidden] = useState(false), [mounted, setMounted] = useState(true)
 const [sheet, setSheet] = useState<'toc' | 'comments' | null>(null), [draft, setDraft] = useState('Retained document draft'), [layout, setLayout] = useNotesRailLayout()
 useEffect(() => { setSheet(null) }, [workspace, note])
 const inline = new URLSearchParams(location.search).has('inline')
 ;(window as any).notesTools = { scope: () => setWorkspace('b'), note: () => setNote('note-b'), hide: () => setHidden(true), inert: () => { const owner = document.querySelector('.fixture-owner') as HTMLElement; owner.inert = true }, unmount: () => setMounted(false), listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) }
 return <I18nextProvider i18n={i18n}><section className="fixture-owner" hidden={hidden}>
  <div data-testid="scope">{workspace}/{note}</div>
  <textarea aria-label="Document draft" value={draft} onChange={event => setDraft(event.target.value)} />
  <NotesRailTools tocShown={inline && !layout.tocCollapsed} commentsShown={false} sheet={sheet} onOpen={setSheet} onCollapse={rail => setLayout({ [`${rail}Collapsed`]: true })} />
  <NotesResponsiveRail scopeKey={JSON.stringify([workspace, note])} inline={inline && !layout.tocCollapsed} open={sheet === 'toc'} title="Contents" onClose={() => setSheet(null)}><aside><input aria-label="Contents filter" /></aside></NotesResponsiveRail>
  <NotesResponsiveRail scopeKey={JSON.stringify([workspace, note])} inline={false} open={sheet === 'comments'} title="Comments" onClose={() => setSheet(null)}><aside><textarea aria-label="Comment draft" /></aside></NotesResponsiveRail>
  {mounted ? <div className="sash-box"><NotesRailSash width={layout.toc} onWidth={toc => setLayout({ toc })} label="Resize contents" maximumWidth={2000} onToggle={() => setLayout({ tocCollapsed: !layout.tocCollapsed })} /></div> : null}
  <output data-testid="width">{layout.toc}</output>
 </section></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
