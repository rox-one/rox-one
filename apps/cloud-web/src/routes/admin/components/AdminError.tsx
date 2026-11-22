import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button } from '@/components'
import { cx } from '@/lib/cx'

export interface AdminErrorProps {
  /** The line from `handleAdminError`; `null` renders nothing. */
  text: string | null
  onRetry?: () => void
  class?: string
}

/** One failed call: the server's words (with request id) and a retry button. */
export function AdminError(props: AdminErrorProps): JSX.Element {
  return (
    <Show when={props.text !== null && props.text !== ''}>
      <div class={cx('admin-error', props.class)} role="alert">
        <span class="admin-error-text">{props.text}</span>
        <Show when={props.onRetry !== undefined}>
          <Button size="sm" variant="secondary" onClick={() => props.onRetry?.()}>
            Повторить
          </Button>
        </Show>
      </div>
    </Show>
  )
}
