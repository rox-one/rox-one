import { createEffect, createMemo } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

import './code-editor.css'

/**
 * A small local highlighter: one pass per language over the text, no
 * dependency and no work until a surface asks for it. Token spans keep the
 * exact characters, so selecting or copying never picks up decoration.
 */
export type CodeLanguage = 'ts' | 'json' | 'shell' | 'yaml' | 'plain'

interface Segment {
  text: string
  cls: string | null
}

type Rule = readonly [RegExp, string]

const TS_KEYWORDS = [
  'import',
  'export',
  'from',
  'default',
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'enum',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'instanceof',
  'typeof',
  'in',
  'of',
  'this',
  'super',
  'null',
  'undefined',
  'true',
  'false',
  'void',
  'as',
  'satisfies',
  'static',
  'readonly',
  'public',
  'private',
  'protected',
  'declare',
  'yield',
  'delete',
  'keyof',
  'infer',
  'string',
  'number',
  'boolean',
  'object',
  'symbol',
  'bigint',
  'unknown',
  'any',
  'never',
  'asserts',
].join('|')

const SHELL_KEYWORDS = [
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'in',
  'select',
  'time',
  'return',
  'exit',
  'export',
  'local',
  'readonly',
  'declare',
  'set',
  'unset',
  'source',
  'alias',
  'trap',
  'shift',
  'eval',
  'exec',
  'sudo',
  'command',
  'read',
  'printf',
  'echo',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'cat',
  'touch',
  'chmod',
  'chown',
  'grep',
  'sed',
  'awk',
  'curl',
  'wget',
  'git',
  'bun',
  'node',
  'npm',
  'docker',
  'ssh',
  'scp',
  'systemctl',
  'journalctl',
  'tail',
  'head',
  'less',
  'which',
  'find',
  'xargs',
  'tee',
  'env',
  'sleep',
  'kill',
  'ps',
  'df',
  'du',
  'tar',
  'unzip',
].join('|')

const TS_RULES: readonly Rule[] = [
  [/\/\/[^\n]*|\/\*[\s\S]*?\*\//, 'comment'],
  [/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/, 'string'],
  [/\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
  [new RegExp(`\\b(?:${TS_KEYWORDS})\\b`), 'keyword'],
  [/\b[A-Z][A-Za-z0-9_$]*\b/, 'type'],
  [/\b[A-Za-z_$][\w$]*(?=\s*\()/, 'func'],
  [/\.[A-Za-z_$][\w$]*/, 'prop'],
  [/[{}()[\]]/, 'punct'],
  [/[+\-*/%=<>!&|?~^]+/, 'op'],
]

const JSON_RULES: readonly Rule[] = [
  [/"(?:\\.|[^"\\])*"(?=\s*:)/, 'prop'],
  [/"(?:\\.|[^"\\])*"/, 'string'],
  [/\b(?:true|false|null)\b/, 'keyword'],
  [/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
  [/[{}[\],:]/, 'punct'],
]

const SHELL_RULES: readonly Rule[] = [
  [/#[^\n]*/, 'comment'],
  [/'[^']*'|"(?:\\.|[^"\\])*"/, 'string'],
  [/\$\{[^}\n]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/, 'prop'],
  [new RegExp(`\\b(?:${SHELL_KEYWORDS})\\b`), 'keyword'],
  [/--?[A-Za-z][A-Za-z0-9_-]*\b/, 'flag'],
  [/\b[A-Za-z_][A-Za-z0-9_]*(?=\s*=)/, 'prop'],
  [/\b\d+\b/, 'number'],
  [/[|&;<>]+/, 'op'],
]

const YAML_RULES: readonly Rule[] = [
  [/^[ \t]*-[ \t]+/, 'punct'],
  [/^[ \t]*(?:- )?[A-Za-z0-9_."'/ -]+(?=[ \t]*:)/, 'prop'],
  [/#[^\n]*/, 'comment'],
  [/'[^']*'|"(?:\\.|[^"\\])*"/, 'string'],
  [/\b(?:true|false|null|yes|no|on|off)\b/, 'keyword'],
  [/-?\b\d+(?:\.\d+)?\b/, 'number'],
  [/[[\]{},:]/, 'punct'],
]

const RULES: Record<Exclude<CodeLanguage, 'plain'>, readonly Rule[]> = {
  ts: TS_RULES,
  json: JSON_RULES,
  shell: SHELL_RULES,
  yaml: YAML_RULES,
}

const MASTERS = new Map<CodeLanguage, { regex: RegExp; classes: string[] }>()

function masterFor(lang: Exclude<CodeLanguage, 'plain'>): { regex: RegExp; classes: string[] } {
  const cached = MASTERS.get(lang)
  if (cached !== undefined) return cached
  const rules = RULES[lang]
  const regex = new RegExp(rules.map((rule) => `(${rule[0].source})`).join('|'), 'gm')
  const master = { regex, classes: rules.map((rule) => rule[1]) }
  MASTERS.set(lang, master)
  return master
}

const EXTENSIONS: Record<string, CodeLanguage> = {
  ts: 'ts',
  tsx: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  mts: 'ts',
  cts: 'ts',
  json: 'json',
  jsonc: 'json',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  command: 'shell',
  env: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
}

/** A file name picks a language; anything unknown is shown without color. */
export function detectLanguage(name: string): CodeLanguage {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) {
    if (lower === 'dockerfile' || lower === 'makefile') return 'shell'
    return 'plain'
  }
  return EXTENSIONS[lower.slice(dot + 1)] ?? 'plain'
}

/** Above this size the text is shown plainly: color would cost more than it gives. */
const HIGHLIGHT_LIMIT = 160_000

/** The editor repaints on every keystroke, so it colors a smaller text. */
const EDITOR_HIGHLIGHT_LIMIT = 60_000

function tokenize(code: string, lang: CodeLanguage, limit = HIGHLIGHT_LIMIT): Segment[] {
  if (lang === 'plain' || code.length > limit) return [{ text: code, cls: null }]
  const { regex, classes } = masterFor(lang)
  const out: Segment[] = []
  let last = 0
  for (const match of code.matchAll(regex)) {
    const index = match.index ?? 0
    if (index > last) out.push({ text: code.slice(last, index), cls: null })
    let cls: string | null = null
    for (let group = 1; group < match.length; group += 1) {
      if (match[group] !== undefined) {
        cls = classes[group - 1] ?? null
        break
      }
    }
    const text = match[0] ?? ''
    out.push({ text, cls })
    last = index + text.length
  }
  if (last < code.length) out.push({ text: code.slice(last), cls: null })
  return out
}

function tokenNodes(segments: Segment[]): Array<JSX.Element | string> {
  return segments.map((segment) =>
    segment.cls === null ? segment.text : <span class={`tok-${segment.cls}`}>{segment.text}</span>,
  )
}

/** One number per line, drawn in a column of its own so the text stays exact. */
function lineNumbers(code: string): string {
  let count = 1
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) count += 1
  }
  let text = '1'
  for (let line = 2; line <= count; line += 1) text += `\n${line}`
  return text
}

export interface CodeViewProps {
  code: string
  name: string
  class?: string
}

/** Read-only text with a line-number gutter and colors. Copy stays plain text. */
export function CodeView(props: CodeViewProps): JSX.Element {
  let gutter: HTMLDivElement | undefined
  let lines: HTMLPreElement | undefined
  const segments = createMemo(() => tokenize(props.code, detectLanguage(props.name)))
  const numbers = createMemo(() => lineNumbers(props.code))

  const sync = (): void => {
    if (gutter === undefined || lines === undefined) return
    gutter.scrollTop = lines.scrollTop
  }

  return (
    <div class={cx('code-surface', 'code-view', props.class)}>
      <div class="code-gutter" aria-hidden="true" ref={gutter}>
        <pre>{numbers()}</pre>
      </div>
      <pre class="code-lines" ref={lines} onScroll={sync}>{tokenNodes(segments())}</pre>
    </div>
  )
}

export interface CodeEditorProps {
  value: string
  onInput: (value: string) => void
  /** Used for the accessible name and for the language. */
  label: string
  language?: CodeLanguage
  disabled?: boolean
  class?: string
}

/**
 * An editor with a gutter and colors: a transparent textarea sits exactly over
 * a highlighted copy of the same text, so the caret, selection, undo and copy
 * all stay the browser's own work. Scrolling is mirrored between the layers.
 */
export default function CodeEditor(props: CodeEditorProps): JSX.Element {
  let area: HTMLTextAreaElement | undefined
  let highlight: HTMLPreElement | undefined
  let gutter: HTMLDivElement | undefined

  const segments = createMemo(() =>
    tokenize(props.value, props.language ?? detectLanguage(props.label), EDITOR_HIGHLIGHT_LIMIT),
  )
  const numbers = createMemo(() => lineNumbers(props.value))

  const sync = (): void => {
    if (area === undefined) return
    if (highlight !== undefined) {
      highlight.scrollTop = area.scrollTop
      highlight.scrollLeft = area.scrollLeft
    }
    if (gutter !== undefined) gutter.scrollTop = area.scrollTop
  }

  // The gutter and the highlight follow the field after any outside change.
  createEffect(() => {
    void props.value
    queueMicrotask(sync)
  })

  const insertTab = (field: HTMLTextAreaElement): void => {
    field.setRangeText('  ', field.selectionStart, field.selectionEnd, 'end')
    props.onInput(field.value)
    sync()
  }

  return (
    <div class={cx('code-surface', 'code-editor', props.disabled === true && 'is-disabled', props.class)}>
      <div class="code-gutter" aria-hidden="true" ref={gutter}>
        <pre>{numbers()}</pre>
      </div>
      <div class="code-editor-area">
        <pre class="code-lines code-editor-highlight" aria-hidden="true" ref={highlight}>{tokenNodes(segments())}</pre>
        <textarea
          ref={area}
          class="code-editor-input"
          value={props.value}
          wrap="off"
          spellcheck={false}
          autocomplete="off"
          disabled={props.disabled === true}
          aria-label={props.label}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
            event.preventDefault()
            insertTab(event.currentTarget)
          }}
          onScroll={sync}
        />
      </div>
    </div>
  )
}
