/**
 * Shiki entry for CodeBlock, loaded on the first highlight (PERF-04).
 *
 * CodeBlock renders plain `<pre>` until this chunk and the requested grammar
 * and theme are ready. Grammars and themes are already fetched on demand by
 * Shiki's bundled loaders; this module keeps Shiki's own runtime off the
 * CodeBlock import path. The Oniguruma (WASM) engine is kept on purpose: the
 * JavaScript regex engine can tokenize a few grammars differently.
 */
import { bundledLanguages, codeToHtml, type BundledLanguage } from 'shiki'
import { resolveShikiTheme } from '../code-viewer/zedShikiThemes'

export function isBundledLanguage(lang: string): lang is BundledLanguage {
  return lang in bundledLanguages
}

/**
 * Highlight `code`. `lang` is used when `checkLang` (its alias-normalized
 * form) names a bundled grammar; otherwise plain text — CodeBlock's rule.
 */
export function highlightCode(code: string, lang: string, checkLang: string, theme: string): Promise<string> {
  return codeToHtml(code, {
    lang: isBundledLanguage(checkLang) ? lang : 'text',
    theme: resolveShikiTheme(theme),
  })
}
