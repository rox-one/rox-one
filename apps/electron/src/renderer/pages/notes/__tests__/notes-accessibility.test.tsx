import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { NotesBreadcrumbs, NotesRailSash } from '../NotesDocumentChrome'
import { NotesCommentComposer, NotesComments } from '../NotesReadingChrome'
import { NotesResponsiveRail } from '../NotesWorkspaceChrome'

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } })
const render = (children: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{children}</I18nextProvider>)
const noop = () => {}

describe('Notes controls rendered semantics', () => {
  test('a rail exposes its actual available resize range', () => {
    const html = render(<NotesRailSash width={220} maximumWidth={280} label="Resize comments" onWidth={noop} />)
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-label="Resize comments"')
    expect(html).toContain('aria-valuenow="220"')
    expect(html).toContain('aria-valuemax="280"')
  })

  test('breadcrumbs identify the current document without a dead current-page button', () => {
    const html = render(<NotesBreadcrumbs noteId="projects/example.md" title="Example note" onOpenFolder={noop} />)
    expect(html).toContain('aria-current="page"')
    expect(html).toMatch(/<span[^>]*aria-current="page"[^>]*>Example note<\/span>/)
    expect(html).not.toMatch(/<button[^>]*aria-current=/)
  })

  test('comment drafts keep their text and have a labelled editor and disabled empty submit', () => {
    const html = render(<NotesCommentComposer quote="Quote" body="Unsent text" onBodyChange={noop} onSubmit={noop} />)
    expect(html).toMatch(/<textarea[^>]*aria-label="[^"]+"[^>]*>Unsent text<\/textarea>/)
    expect(html).not.toContain('autofocus=')
    const empty = render(<NotesCommentComposer quote="Quote" body="  " onBodyChange={noop} onSubmit={noop} />)
    expect(empty).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })

  test('the rail composer uses the same controlled unsent draft', () => {
    const html = render(<NotesComments noteId="note" markdownComments={[]} draftQuote="Quote" draftBody="Unsent text" onDraftBodyChange={noop} onClearDraft={noop} />)
    expect(html).toContain('Unsent text</textarea>')
  })

  test('closed compact rails do not leave their controls in the rendered document', () => {
    const html = render(<NotesResponsiveRail inline={false} open={false} title="Notes" onClose={noop}><button type="button">Hidden tool</button></NotesResponsiveRail>)
    expect(html).not.toContain('Hidden tool')
    const inline = render(<NotesResponsiveRail inline open={false} title="Notes" onClose={noop}><button type="button">Visible tool</button></NotesResponsiveRail>)
    expect(inline).toContain('Visible tool')
  })
})
