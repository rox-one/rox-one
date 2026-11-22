/**
 * A dialog that asks for the reason before a staff write. Every write in the
 * panel lands in the audit trail with its reason, so the field is required
 * here too: an empty answer keeps the dialog open instead of sending a blank.
 */
import { createEffect, createSignal, createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Dialog, Field, Textarea } from '@/components'

export interface ReasonDialogProps {
  open: boolean
  title: string
  subtitle?: string
  label: string
  placeholder?: string
  hint?: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  /** A server error line, already carrying its request id. */
  error?: string | null
  onSubmit: (reason: string) => void
  onClose: () => void
}

export function ReasonDialog(props: ReasonDialogProps): JSX.Element {
  const fieldId = createUniqueId()
  const formId = createUniqueId()
  const [value, setValue] = createSignal('')
  const [localError, setLocalError] = createSignal<string | null>(null)

  createEffect(() => {
    if (props.open) {
      setValue('')
      setLocalError(null)
    }
  })

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (props.busy === true) return
    const reason = value().trim()
    if (reason.length === 0) {
      setLocalError('Напишите причину: без неё действие не запишется в журнал.')
      return
    }
    setLocalError(null)
    props.onSubmit(reason)
  }

  return (
    <Dialog
      open={props.open}
      onClose={() => props.onClose()}
      title={props.title}
      subtitle={props.subtitle}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose()} disabled={props.busy === true}>
            Отмена
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={props.danger === true ? 'danger' : 'primary'}
            loading={props.busy === true}
          >
            {props.confirmLabel ?? 'Подтвердить'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <Field
          label={props.label}
          for={fieldId}
          required
          hint={props.hint}
          error={props.error ?? localError()}
        >
          <Textarea
            id={fieldId}
            rows={3}
            value={value()}
            placeholder={props.placeholder}
            aria-required="true"
            aria-invalid={localError() !== null || props.error != null ? 'true' : undefined}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}
