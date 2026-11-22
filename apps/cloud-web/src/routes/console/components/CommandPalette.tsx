import { useNavigate } from '@solidjs/router'
import { animate } from 'motion'
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import { Icon } from '@/components'
import type { IconName } from '@/components'
import { prefersReducedMotion } from '@/lib/motion'

import { useConsoleSession } from './console-session'

/** The curve of the design tokens, written out for Motion. */
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]

interface PaletteCommand {
  readonly label: string
  /** The short group word on the right: a section, a site page, an action. */
  readonly hint: string
  readonly icon: IconName
  /** Extra words the search also looks at, so «баланс» finds «Пополнить счёт». */
  readonly keywords: string
  readonly run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  /** The owner hides the palette and returns focus to the topbar trigger. */
  onClose: () => void
}

/**
 * ⌘K / Ctrl+K: one list of sections and wallet actions over the current page.
 * The native `<dialog>` keeps focus trapping, Escape and the backdrop; Motion
 * only plays the opening frame, and reduced motion skips even that.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const session = useConsoleSession()
  const navigate = useNavigate()

  let dialog: HTMLDialogElement | undefined
  let input: HTMLInputElement | undefined
  let enter: { stop: () => void } | undefined

  const [query, setQuery] = createSignal('')
  const [selected, setSelected] = createSignal(0)

  // Close the native dialog first: its own focus restoration must run before
  // the owner moves focus to the topbar trigger.
  const requestClose = (): void => {
    if (dialog?.open === true) dialog.close()
    props.onClose()
  }

  const commands: readonly PaletteCommand[] = [
    {
      label: 'Новая машина',
      hint: 'Создать',
      icon: 'plus',
      keywords: 'машина сервер запустить новая',
      run: () => {
        requestClose()
        navigate('/console')
      },
    },
    {
      label: 'Машины',
      hint: 'Раздел',
      icon: 'box',
      keywords: 'машины серверы список',
      run: () => {
        requestClose()
        navigate('/console/machines')
      },
    },
    {
      label: 'Счёт',
      hint: 'Раздел',
      icon: 'chart',
      keywords: 'счёт счет баланс оплата',
      run: () => {
        requestClose()
        navigate('/console/invoice')
      },
    },
    {
      label: 'Ключи',
      hint: 'Раздел',
      icon: 'key',
      keywords: 'ключи api доступ',
      run: () => {
        requestClose()
        navigate('/console/keys')
      },
    },
    {
      label: 'Журнал',
      hint: 'Раздел',
      icon: 'log',
      keywords: 'журнал события история',
      run: () => {
        requestClose()
        navigate('/console/journal')
      },
    },
    {
      label: 'Справка',
      hint: 'Сайт',
      icon: 'globe',
      keywords: 'справка документация помощь',
      run: () => {
        requestClose()
        navigate('/docs')
      },
    },
    {
      label: 'Пополнить счёт',
      hint: 'Действие',
      icon: 'chart',
      keywords: 'пополнить баланс деньги оплата',
      run: () => {
        requestClose()
        // The top-up dialog is the provider's; let this one leave the top layer first.
        queueMicrotask(() => session.openTopUp())
      },
    },
  ]

  const terms = createMemo(() =>
    query().trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean),
  )

  const filtered = createMemo(() => {
    const words = terms()
    if (words.length === 0) return commands
    return commands.filter((command) => {
      const haystack = `${command.label} ${command.hint} ${command.keywords}`.toLocaleLowerCase('ru')
      return words.every((word) => haystack.includes(word))
    })
  })

  // A shorter list must not keep a selection that no longer exists.
  createEffect(() => {
    const count = filtered().length
    setSelected((current) => (count === 0 ? 0 : Math.min(current, count - 1)))
  })

  // Keep the keyboard selection in view while ArrowUp/ArrowDown walk the list.
  createEffect(() => {
    const count = filtered().length
    const index = Math.min(selected(), Math.max(count - 1, 0))
    if (!props.open) return
    const node = dialog?.querySelector<HTMLElement>(`[data-command-index="${index}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  })

  createEffect(() => {
    const element = dialog
    if (element === undefined) return
    if (props.open) {
      if (element.open) return
      setQuery('')
      setSelected(0)
      element.showModal()
      if (prefersReducedMotion()) {
        element.style.opacity = ''
        element.style.transform = ''
      } else {
        enter?.stop()
        const controls = animate(
          element,
          { opacity: [0, 1], y: [10, 0], scale: [0.985, 1] },
          { duration: 0.16, ease: EASE },
        )
        enter = controls
        void controls.then(() => {
          element.style.opacity = ''
          element.style.transform = ''
        })
      }
      // Focus lands in the search field, not on the first command.
      queueMicrotask(() => input?.focus())
      return
    }
    if (element.open) {
      element.close()
      enter?.stop()
      element.style.opacity = ''
      element.style.transform = ''
    }
  })

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    const items = filtered()
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (items.length > 0) setSelected((current) => (current + 1) % items.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length > 0) setSelected((current) => (current - 1 + items.length) % items.length)
      return
    }
    if (event.key !== 'Enter') return
    // A focused command is a real button: let the browser press it.
    const target = event.target
    if (target instanceof HTMLElement && target.closest('.console-palette-item') !== null) return
    event.preventDefault()
    const command = items[selected()]
    if (command !== undefined) command.run()
  }

  return (
    <dialog
      ref={dialog}
      class="console-palette"
      aria-label="Команды кабинета"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onClick={(event) => {
        if (event.target === dialog) requestClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div class="console-palette-search">
        <Icon name="search" size={15} />
        <input
          ref={input}
          class="console-palette-input"
          type="text"
          value={query()}
          placeholder="Раздел, ключ или действие"
          aria-label="Поиск по кабинету"
          aria-controls="console-palette-list"
          autocomplete="off"
          autofocus
          spellcheck={false}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setSelected(0)
          }}
        />
        <kbd class="console-kbd" aria-hidden="true">
          Esc
        </kbd>
      </div>
      <span class="sr-only" aria-live="polite">
        {filtered().length === 0
          ? 'Ничего не найдено'
          : `Найдено команд: ${filtered().length}`}
      </span>
      <Show
        when={filtered().length > 0}
        fallback={
          <div class="console-palette-empty">
            <span>Ничего не нашлось.</span>
            <span class="console-palette-empty-hint">Попробуйте другое слово.</span>
          </div>
        }
      >
        <ul class="console-palette-list" id="console-palette-list">
          <For each={filtered()}>
            {(command, index) => (
              <li>
                <button
                  type="button"
                  class="console-palette-item"
                  data-command-index={index()}
                  data-selected={selected() === index() ? 'true' : 'false'}
                  aria-current={selected() === index() ? 'true' : undefined}
                  onMouseEnter={() => setSelected(index())}
                  onClick={() => command.run()}
                >
                  <Icon name={command.icon} size={16} />
                  <span class="console-palette-label">{command.label}</span>
                  <span class="console-palette-hint">{command.hint}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="console-palette-foot">
        <span>↑ ↓ — выбор · Enter — открыть</span>
        <span>Esc — закрыть</span>
      </div>
    </dialog>
  )
}
