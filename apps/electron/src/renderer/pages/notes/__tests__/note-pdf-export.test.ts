import { beforeEach, describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  NOTE_PDF_TABS_REVEAL_CSS,
  cloneEditorHtmlForNotePdf,
} from '../note-pdf-export'

describe('LSX-WP-031 note PDF export clone (tabs panes)', () => {
  beforeEach(() => {
    const win = new Window({ url: 'https://localhost/' })
    ;(globalThis as any).window = win
    ;(globalThis as any).document = win.document
    ;(globalThis as any).HTMLElement = win.HTMLElement
    ;(globalThis as any).Element = win.Element
  })

  it('cloneEditorHtmlForNotePdf reveals inactive and nested panes (strips hidden/inert)', () => {
    const root = document.createElement('div')
    root.className = 'tiptap-editor'
    root.innerHTML = `
      <div class="tiptap-rox-tabs" data-type="rox-tabs" data-active-index="0">
        <div class="tiptap-rox-tabs-panels">
          <div data-node-view-content-react="true">
            <div class="react-renderer">
              <div class="tiptap-rox-tab is-active" data-type="rox-tab" data-active="true" role="tabpanel">
                <div class="tiptap-rox-tab-content"><p>Outer A</p></div>
              </div>
            </div>
            <div class="react-renderer">
              <div class="tiptap-rox-tab" data-type="rox-tab" data-active="false" role="tabpanel" hidden inert aria-hidden="true">
                <div class="tiptap-rox-tab-content">
                  <p>Outer B start</p>
                  <div class="tiptap-rox-tabs" data-type="rox-tabs" data-active-index="0">
                    <div class="tiptap-rox-tabs-panels">
                      <div data-node-view-content-react="true">
                        <div class="react-renderer">
                          <div class="tiptap-rox-tab is-active" data-type="rox-tab" role="tabpanel">
                            <div class="tiptap-rox-tab-content"><p>Nested A</p></div>
                          </div>
                        </div>
                        <div class="react-renderer">
                          <div class="tiptap-rox-tab" data-type="rox-tab" role="tabpanel" hidden inert aria-hidden="true">
                            <div class="tiptap-rox-tab-content"><p>Nested B secret</p></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `

    const html = cloneEditorHtmlForNotePdf(root as unknown as HTMLElement)
    expect(html).toContain('Outer A')
    expect(html).toContain('Outer B start')
    expect(html).toContain('Nested A')
    expect(html).toContain('Nested B secret')

    const probe = document.createElement('div')
    probe.innerHTML = html
    const panes = Array.from(probe.querySelectorAll('.tiptap-rox-tab'))
    expect(panes.length).toBeGreaterThanOrEqual(4)
    for (const pane of panes) {
      expect((pane as HTMLElement).hasAttribute('hidden')).toBe(false)
      expect((pane as HTMLElement).hasAttribute('inert')).toBe(false)
      expect(pane.classList.contains('is-active')).toBe(true)
      expect((pane as HTMLElement).style.display).toContain('block')
    }
    // Live editor root must stay untouched (clone only).
    expect(root.querySelectorAll('.tiptap-rox-tab[hidden]').length).toBe(2)
  })

  it('NotesPage PDF path uses clone helper + reveal CSS (not raw editorDom.innerHTML)', () => {
    const notesPage = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
    expect(notesPage).toContain('cloneEditorHtmlForNotePdf')
    expect(notesPage).toContain('NOTE_PDF_TABS_REVEAL_CSS')
    expect(notesPage).toMatch(/handleExportPdf[\s\S]*?cloneEditorHtmlForNotePdf\(editorDom\)/)
    expect(notesPage).not.toMatch(/handleExportPdf[\s\S]*?\$\{editorDom\.innerHTML\}/)
    expect(NOTE_PDF_TABS_REVEAL_CSS).toContain('display: block !important')
  })

  it('TabsBlock wires aria-controls / aria-labelledby between chip and pane', () => {
    const tabs = readFileSync(
      join(
        import.meta.dir,
        '../../../../../../../packages/ui/src/components/markdown/extensions/TabsBlock.tsx',
      ),
      'utf8',
    )
    expect(tabs).toContain('aria-controls={`rox-tab-panel-${tabsRootKey}-${index}`}')
    expect(tabs).toContain('aria-labelledby={a11yIds.tabId}')
    expect(tabs).toContain('data-tabs-root-id={tabsRootKey}')
    expect(tabs).toContain('panelId: `rox-tab-panel-${rootKey}-${index}`')
  })
})
