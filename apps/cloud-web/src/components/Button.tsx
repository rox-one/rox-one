import { Show, splitProps } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
  icon?: JSX.Element
}

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'block',
    'loading',
    'icon',
    'class',
    'children',
    'disabled',
    'type',
  ])
  return (
    <button
      type={local.type ?? 'button'}
      class={cx(
        'btn',
        `btn-${local.variant ?? 'secondary'}`,
        local.size === 'sm' && 'btn-sm',
        local.size === 'lg' && 'btn-lg',
        local.block && 'btn-block',
        local.class,
      )}
      disabled={local.disabled === true || local.loading === true}
      aria-busy={local.loading === true ? 'true' : undefined}
      {...rest}
    >
      <Show when={local.loading === true} fallback={local.icon}>
        <span class="btn-spinner" aria-hidden="true" />
      </Show>
      {local.children}
    </button>
  )
}
