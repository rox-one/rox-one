import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'
import { formatCents } from '@/lib/format'

export interface MoneyProps {
  cents: number | null | undefined
  /** Append `/ч`, the hourly marker used on prices and rates. */
  perHour?: boolean
  class?: string
}

/** Cents from the API, printed the Russian way: `2000` → `20,00 $`. */
export function Money(props: MoneyProps): JSX.Element {
  return (
    <span class={cx('money', props.class)}>
      {formatCents(props.cents)}
      {props.perHour === true ? <span class="money-unit">/ч</span> : null}
    </span>
  )
}
