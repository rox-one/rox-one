import { For, Show, createContext, createSignal, useContext } from 'solid-js'
import type { JSX } from 'solid-js'

import { Icon } from './Icon'

export type ToastTone = 'accent' | 'success' | 'warning' | 'danger'

export interface ToastInput {
  message: string
  tone?: ToastTone
  /** Extra line for a code or a request id. */
  meta?: string
  requestId?: string | null
  /** `0` keeps the toast until it is dismissed. */
  timeoutMs?: number
}

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  meta?: string
  requestId?: string | null
}

export interface ToastApi {
  show: (input: ToastInput | string, tone?: ToastTone) => number
  success: (message: string) => number
  error: (input: unknown) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | undefined>(undefined)

/** Turn anything thrown by the client into a message, its code and its request id. */
function describeError(input: unknown): { message: string; code: string | null; requestId: string | null } {
  if (typeof input === 'string') return { message: input, code: null, requestId: null }
  if (!(input instanceof Error)) return { message: 'Неизвестная ошибка', code: null, requestId: null }
  const requestId =
    'requestId' in input && typeof input.requestId === 'string' && input.requestId.length > 0
      ? input.requestId
      : null
  const code = 'code' in input && typeof input.code === 'string' ? input.code : null
  return { message: input.message, code, requestId }
}

export function ToastProvider(props: { children?: JSX.Element }): JSX.Element {
  const [items, setItems] = createSignal<ToastItem[]>([])
  let nextId = 1

  const dismiss = (id: number): void => {
    setItems((list) => list.filter((item) => item.id !== id))
  }

  const show = (input: ToastInput | string, tone: ToastTone = 'accent'): number => {
    const value: ToastInput = typeof input === 'string' ? { message: input } : input
    const id = nextId++
    setItems((list) => [
      ...list,
      {
        id,
        message: value.message,
        tone: value.tone ?? tone,
        meta: value.meta,
        requestId: value.requestId ?? null,
      },
    ])
    const timeout = value.timeoutMs ?? 5000
    if (timeout > 0) setTimeout(() => dismiss(id), timeout)
    return id
  }

  const api: ToastApi = {
    show,
    success: (message) => show({ message, tone: 'success' }),
    error: (input) => {
      const described = describeError(input)
      return show({
        message: described.message,
        tone: 'danger',
        meta: described.code ?? undefined,
        requestId: described.requestId,
      })
    },
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <div class="toast-region" aria-live="polite" aria-atomic="false">
        <For each={items()}>
          {(item) => (
            <div class="toast" data-tone={item.tone} role="status">
              <Icon
                class="toast-icon"
                name={item.tone === 'danger' ? 'shield' : item.tone === 'success' ? 'check' : 'log'}
                size={16}
              />
              <div class="toast-body">
                <div class="toast-message">{item.message}</div>
                <Show when={item.meta !== undefined || item.requestId !== null}>
                  <div class="toast-meta">
                    {item.meta}
                    {item.meta !== undefined && item.requestId !== null ? ' · ' : null}
                    {item.requestId === null ? null : `запрос ${item.requestId}`}
                  </div>
                </Show>
              </div>
              <button
                type="button"
                class="toast-close"
                aria-label="Закрыть сообщение"
                onClick={() => dismiss(item.id)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (value === undefined) throw new Error('useToast вызван вне ToastProvider')
  return value
}
