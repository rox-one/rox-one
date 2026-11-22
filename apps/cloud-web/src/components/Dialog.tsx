import { createEffect, createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'

import { cx } from '@/lib/cx'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: JSX.Element
  subtitle?: JSX.Element
  footer?: JSX.Element
  wide?: boolean
  /** Set to false when the dialog holds work that must be cancelled explicitly. */
  closeOnBackdrop?: boolean
  children?: JSX.Element
}

/**
 * A native modal `<dialog>`: the browser owns focus trapping, Escape and the
 * backdrop. The `open` prop is the single source of truth.
 */
export function Dialog(props: DialogProps): JSX.Element {
  let element: HTMLDialogElement | undefined
  const titleId = createUniqueId()

  createEffect(() => {
    const dialog = element
    if (dialog === undefined) return
    if (props.open && !dialog.open) dialog.showModal()
    else if (!props.open && dialog.open) dialog.close()
  })

  return (
    <dialog
      ref={element}
      class={cx('dialog', props.wide === true && 'dialog-wide')}
      aria-labelledby={titleId}
      onClose={() => props.onClose()}
      onCancel={(event) => {
        event.preventDefault()
        props.onClose()
      }}
      onClick={(event) => {
        if (props.closeOnBackdrop !== false && event.target === element) props.onClose()
      }}
    >
      <header class="dialog-head">
        <div>
          <div class="dialog-title" id={titleId}>
            {props.title}
          </div>
          {props.subtitle === undefined ? null : <div class="dialog-sub">{props.subtitle}</div>}
        </div>
        <button type="button" class="dialog-close" aria-label="Закрыть" onClick={() => props.onClose()}>
          ×
        </button>
      </header>
      <div class="dialog-body">{props.children}</div>
      {props.footer === undefined ? null : <footer class="dialog-foot">{props.footer}</footer>}
    </dialog>
  )
}
