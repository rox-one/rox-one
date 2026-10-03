import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockShiki from 'tiptap-extension-code-block-shiki'
import { tiptapShikiThemeModes, updateTiptapShikiTheme } from '../tiptap-shiki-theme'

describe('TipTap syntax theme changes', () => {
  it('changes captured theme modes through a decoration transaction without resetting document or selection', () => {
    const modes = tiptapShikiThemeModes('rox-nordfox-opaque')
    const editor = new Editor({
      element: null,
      extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockShiki.configure({ themes: modes })],
      content: { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const value = "unsaved"' }] }] },
    })
    try {
      expect(editor.extensionManager.extensions.find(extension => extension.name === 'codeBlock')!.options.themes).toBe(modes)
      const initialState = editor.state
      let transaction: typeof initialState.tr | undefined
      // Exercise the same real ProseMirror state/transaction while avoiding a DOM mount.
      const host = { isDestroyed: false, state: initialState, view: { dispatch: (tr: typeof initialState.tr) => { transaction = tr } } } as unknown as Editor
      updateTiptapShikiTheme(host, modes, 'rox-siri-light')
      expect(modes).toEqual({ light: 'rox-siri-light', dark: 'rox-siri-light' })
      expect(transaction!.getMeta('shikiPluginForceDecoration')).toBe(true)
      expect(transaction!.docChanged).toBe(false)
      expect(transaction!.doc).toBe(initialState.doc)
      expect(transaction!.selection.eq(initialState.selection)).toBe(true)
      expect(transaction!.steps).toHaveLength(0)
      updateTiptapShikiTheme(host, modes, null)
      expect(modes).toEqual({ light: 'github-light', dark: 'github-dark' })
      expect(editor.state.doc.textContent).toBe('const value = "unsaved"')
    } finally {
      editor.destroy()
    }
  })
})
