import type { Editor } from '@tiptap/core'
import type { BundledTheme } from 'shiki'
import { registerZedShikiLoaders } from '../code-viewer/zedShikiThemes'

export interface TiptapShikiThemeModes {
  light: BundledTheme
  dark: BundledTheme
}

export function tiptapShikiThemeModes(name: string | null): TiptapShikiThemeModes {
  registerZedShikiLoaders()
  return name
    ? { light: name as BundledTheme, dark: name as BundledTheme }
    : { light: 'github-light', dark: 'github-dark' }
}

/**
 * The extension captures this object in its decoration plugin. Keep its
 * identity and refresh decorations, preserving content, selection and undo.
 */
export function updateTiptapShikiTheme(
  editor: Editor,
  modes: TiptapShikiThemeModes,
  name: string | null,
): void {
  if (editor.isDestroyed) return
  Object.assign(modes, tiptapShikiThemeModes(name))
  editor.view.dispatch(editor.state.tr.setMeta('shikiPluginForceDecoration', true))
}
