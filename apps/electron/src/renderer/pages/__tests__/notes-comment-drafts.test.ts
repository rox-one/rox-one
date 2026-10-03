import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { EMPTY_COMMENT_DRAFT, noteCommentDraftKey, updateCommentDraft } from '../notes/comment-drafts'

// Execute the delivered NativeNotesPage state declarations and setter callbacks.
// The fixture models hook state across route changes; no native write is issued.
const source = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')
const ast = ts.createSourceFile('NotesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NativeNotesPage') as ts.FunctionDeclaration
if (!page?.body) throw new Error('Actual routed native Notes page missing')
const selected = new Set(['commentDrafts', 'setCommentDrafts', 'commentDraftKey', 'commentDraft',
  'commentDraftQuote', 'setCommentDraftQuote', 'commentComposerBody', 'setCommentComposerBody'])
const names = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text]
  : name.elements.flatMap(x => ts.isBindingElement(x) ? names(x.name) : [])
const declarations = page.body.statements.filter(ts.isVariableStatement).flatMap(statement =>
  statement.declarationList.declarations.filter(d => names(d.name).some(name => selected.has(name)))
    .map(d => `const ${d.getText(ast)};`))
const program = ts.transpileModule(declarations.join('\n') + '\nreturn { quote: commentDraftQuote, body: commentComposerBody, setQuote: setCommentDraftQuote, setBody: setCommentComposerBody };',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function fixture() {
  const states: unknown[] = []
  function render(activeWorkspaceId?: string, noteId?: string) {
    let slot = 0
    const React = {
      useState: (initial: unknown) => {
        const key = slot++
        if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial
        return [states[key], (next: unknown) => { states[key] = typeof next === 'function' ? next(states[key]) : next }]
      },
      useCallback: (callback: unknown) => callback,
    }
    const args = { React, activeWorkspaceId, activeNote: noteId ? { id: noteId } : null, EMPTY_COMMENT_DRAFT, noteCommentDraftKey, updateCommentDraft }
    return new Function(...Object.keys(args), program)(...Object.values(args)) as {
      quote: string; body: string; setQuote: (value: string) => void; setBody: (value: string) => void
    }
  }
  return { render }
}
describe('actual Native Notes unsent comment draft scope', () => {
  test('route/workspace switches do not retarget drafts, and returning restores both quote and body', () => {
    const f = fixture(); const a = f.render('workspace-a', 'daily/today')
    a.setQuote('A selected passage'); a.setBody('A unsent comment')
    const b = f.render('workspace-a', 'project/review')
    expect([b.quote, b.body]).toEqual(['', '']); b.setQuote('B passage'); b.setBody('B unsent comment')
    const otherWorkspace = f.render('workspace-b', 'daily/today')
    expect([otherWorkspace.quote, otherWorkspace.body]).toEqual(['', '']); otherWorkspace.setBody('Other vault comment')
    const returned = f.render('workspace-a', 'daily/today')
    expect([returned.quote, returned.body]).toEqual(['A selected passage', 'A unsent comment'])
    expect(f.render('workspace-a', 'project/review').body).toBe('B unsent comment')
    expect(f.render('workspace-b', 'daily/today').body).toBe('Other vault comment')
  })
  test('captured selection/edit callback from A cannot replace the current B draft', () => {
    const f = fixture(); const a = f.render('a', 'note-a'); a.setBody('Initial A')
    const b = f.render('a', 'note-b'); b.setQuote('B quote'); b.setBody('B draft')
    a.setQuote('Later A selection'); a.setBody('Later A edit')
    const current = f.render('a', 'note-b'); expect([current.quote, current.body]).toEqual(['B quote', 'B draft'])
    const returned = f.render('a', 'note-a'); expect([returned.quote, returned.body]).toEqual(['Later A selection', 'Later A edit'])
  })
  test('clearing a captured submitted/cancelled draft affects only its original document', () => {
    const f = fixture(); const a = f.render('a', 'note-a'); a.setQuote('A quote'); a.setBody('A draft')
    const b = f.render('b', 'note-a'); b.setQuote('B quote'); b.setBody('New B draft')
    a.setQuote(''); a.setBody('')
    const current = f.render('b', 'note-a'); expect([current.quote, current.body]).toEqual(['B quote', 'New B draft'])
    const cleared = f.render('a', 'note-a'); expect([cleared.quote, cleared.body]).toEqual(['', ''])
  })
  test('an unbound workspace/document cannot acquire a draft for the next document', () => {
    const f = fixture(); const none = f.render(); none.setQuote('Stale selection'); none.setBody('Stale body')
    expect(f.render('bound', 'note').body).toBe(''); expect(f.render('bound', 'note').quote).toBe('')
    const noNote = f.render('bound'); noNote.setBody('No document')
    expect(f.render('bound', 'note').body).toBe('')
  })
  test('scope keys cannot collide at separators; empty drafts are removed without mutating other entries', () => {
    const a = noteCommentDraftKey('a/b', 'c')!, b = noteCommentDraftKey('a', 'b/c')!
    expect(a).not.toBe(b)
    const initial = updateCommentDraft(new Map(), a, { quote: 'a', body: 'draft' })
    const next = updateCommentDraft(initial, b, { body: 'other' })
    const cleared = updateCommentDraft(next, a, EMPTY_COMMENT_DRAFT)
    expect(initial.size).toBe(1); expect(cleared.has(a)).toBe(false); expect(cleared.get(b)?.body).toBe('other')
    expect(updateCommentDraft(cleared, null, { body: 'orphan' })).toBe(cleared)
  })
})
