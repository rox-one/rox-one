import { Show, createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface CodeBlockProps {
  code: string
  /** A caption such as a file name or a command group. */
  label?: string
  class?: string
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = createSignal(false)
  let resetTimer: number | undefined

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.code)
      setCopied(true)
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div class={cx('code-block', props.class)}>
      <div class="code-head">
        <span class="code-label">{props.label ?? 'Код'}</span>
        <button type="button" class="code-copy" onClick={() => void copy()}>
          {copied() ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre class="code-body">
        <code>{props.code}</code>
      </pre>
      <Show when={copied()}>
        <span class="sr-only" role="status">
          Скопировано
        </span>
      </Show>
    </div>
  )
}
