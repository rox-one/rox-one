import { A } from '@solidjs/router'
import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { Icon } from './Icon'

export interface PageHeaderProps {
  title: JSX.Element
  description?: JSX.Element
  /** Small caps line above the title, e.g. a section name. */
  eyebrow?: JSX.Element
  actions?: JSX.Element
  back?: { href: string; label: string }
}

export function PageHeader(props: PageHeaderProps): JSX.Element {
  return (
    <header class="page-head">
      <div class="page-head-main">
        <Show when={props.back !== undefined}>
          <A class="page-back" href={props.back?.href ?? '/'}>
            <Icon name="arrow" size={13} />
            {props.back?.label}
          </A>
        </Show>
        <Show when={props.eyebrow !== undefined}>
          <div class="page-eyebrow">{props.eyebrow}</div>
        </Show>
        <h1 class="page-title">{props.title}</h1>
        <Show when={props.description !== undefined}>
          <p class="page-desc">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions !== undefined}>
        <div class="page-actions">{props.actions}</div>
      </Show>
    </header>
  )
}
