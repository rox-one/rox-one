import { splitProps } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea(props: TextareaProps): JSX.Element {
  const [local, rest] = splitProps(props, ['class'])
  return <textarea class={cx('textarea', local.class)} {...rest} />
}
