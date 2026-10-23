/**
 * LSX-WP-031: Notes toolbar PDF export snapshots the TipTap editor DOM.
 * Inactive rox-tab panes use HTML `hidden` / `inert` plus CSS `display:none`
 * (personal selection). Chromium printToPDF skips those nodes, so non-selected
 * (and nested) pane bodies would be omitted even though the PM doc / ::: disk
 * / toBasicMarkdownExport keep every child.
 *
 * Clone the live editor DOM and strip hide markers so the PDF snapshot includes
 * all tab pane bodies without mutating the on-screen editor.
 */

/** Selectors for panes / wrappers that personal-tab CSS may hide. */
const TAB_PANE_SELECTOR = '.tiptap-rox-tab, [data-type="rox-tab"]'
const TAB_WRAPPER_SELECTOR =
  '.tiptap-rox-tabs-panels > [data-node-view-content-react] > .react-renderer, ' +
  '.tiptap-rox-tabs-panels > [data-node-view-content-react] > *'

function revealPdfExportNode(el: Element): void {
  if (!(el instanceof HTMLElement)) return
  el.removeAttribute('hidden')
  el.removeAttribute('aria-hidden')
  el.removeAttribute('inert')
  // React may have set the IDL property without a reflected attribute.
  try {
    ;(el as HTMLElement & { inert?: boolean }).inert = false
  } catch {
    /* ignore environments without inert IDL */
  }
  el.classList.add('is-active')
  el.dataset.active = 'true'
  el.style.setProperty('display', 'block', 'important')
  el.style.setProperty('visibility', 'visible', 'important')
}

/**
 * Return innerHTML of a clone of `editorDom` with every rox-tab pane (nested
 * included) forced visible for printToPDF.
 */
export function cloneEditorHtmlForNotePdf(editorDom: HTMLElement): string {
  const clone = editorDom.cloneNode(true) as HTMLElement
  clone.querySelectorAll(TAB_PANE_SELECTOR).forEach(revealPdfExportNode)
  // TipTap wraps each pane in a .react-renderer; CSS hides wrappers that lack
  // an active child — reveal those too after panes gained .is-active.
  clone.querySelectorAll(TAB_WRAPPER_SELECTOR).forEach(revealPdfExportNode)
  return clone.innerHTML
}

/** Extra CSS injected into the PDF document so editor stylesheet hide rules cannot win. */
export const NOTE_PDF_TABS_REVEAL_CSS = `
.tiptap-rox-tab,
.tiptap-rox-tab[hidden],
.tiptap-rox-tabs-panels > .tiptap-rox-tab,
.tiptap-rox-tabs-panels > [data-node-view-content-react] > .react-renderer,
.tiptap-rox-tabs-panels > [data-node-view-content-react] > * {
  display: block !important;
  visibility: visible !important;
}
.tiptap-rox-tab[hidden],
.tiptap-rox-tab[aria-hidden="true"] {
  display: block !important;
}
`
