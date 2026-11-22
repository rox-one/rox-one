import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface CardProps {
  title?: JSX.Element
  subtitle?: JSX.Element
  actions?: JSX.Element
  footer?: JSX.Element
  flush?: boolean
  class?: string
  bodyClass?: string
  children?: JSX.Element
}

/** A surface with an optional head and foot. Pages compose their own grids. */
export function Card(props: CardProps): JSX.Element {
  return (
    <section class={cx('card', props.flush === true && 'card-flush', props.class)}>
      <Show when={props.title !== undefined || props.actions !== undefined}>
        <header class="card-head">
          <div class="card-head-main">
            <div class="card-title">{props.title}</div>
            <Show when={props.subtitle !== undefined}>
              <div class="card-sub">{props.subtitle}</div>
            </Show>
          </div>
          <Show when={props.actions !== undefined}>
            <div class="card-actions">{props.actions}</div>
          </Show>
        </header>
      </Show>
      <div class={cx('card-body', props.bodyClass)}>{props.children}</div>
      <Show when={props.footer !== undefined}>
        <footer class="card-foot">{props.footer}</footer>
      </Show>
    </section>
  )
}
