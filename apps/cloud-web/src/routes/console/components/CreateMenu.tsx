import { A } from '@solidjs/router'
import { animate } from 'motion'
import { Show, createEffect, createSignal, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { Icon } from '@/components'
import { prefersReducedMotion } from '@/lib/motion'

import { useConsoleSession } from './console-session'

/** The curve of the design tokens, written out for Motion. */
const EASE: [number, number, number, number] = [0.2, 0.7, 0.3, 1]

/**
 * The topbar «Создать» button: a 2×2 grid of the four things a person starts
 * from the console, opened with a clip-path wipe. The panel sits under the
 * button, closes on Escape or an outside pointer, and hands focus back.
 */
export function CreateMenu(): JSX.Element {
  const session = useConsoleSession()

  const [open, setOpen] = createSignal(false)
  const [present, setPresent] = createSignal(false)
  let root: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  // A close that is still animating must not unmount a panel reopened meanwhile.
  let closeToken = 0
  let motion: { stop: () => void } | undefined

  const openMenu = (): void => {
    closeToken += 1
    motion?.stop()
    setPresent(true)
    setOpen(true)
  }

  const closeMenu = (focusTrigger: boolean): void => {
    if (!open()) return
    const token = ++closeToken
    motion?.stop()
    setOpen(false)
    const element = panel
    const settle = (): void => {
      if (token !== closeToken) return
      setPresent(false)
      if (focusTrigger) trigger?.focus()
    }
    if (element === undefined || prefersReducedMotion()) {
      settle()
      return
    }
    const controls = animate(
      element,
      {
        opacity: [1, 0],
        scale: [1, 0.96],
        clipPath: ['inset(0 0 0% 0)', 'inset(0 0 92% 0)'],
      },
      { duration: 0.12, ease: EASE },
    )
    motion = controls
    void controls.then(settle)
  }

  createEffect(() => {
    if (!open()) return
    const element = panel
    if (element === undefined) return
    if (prefersReducedMotion()) {
      element.style.opacity = ''
      element.style.transform = ''
      element.style.clipPath = ''
    } else {
      const controls = animate(
        element,
        {
          opacity: [0, 1],
          scale: [0.96, 1],
          clipPath: ['inset(0 0 92% 0)', 'inset(0 0 0% 0)'],
        },
        { duration: 0.16, ease: EASE },
      )
      motion = controls
      void controls.then(() => {
        element.style.opacity = ''
        element.style.transform = ''
        element.style.clipPath = ''
      })
    }
    queueMicrotask(() => panel?.querySelector<HTMLElement>('.console-create-action')?.focus())
  })

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && root?.contains(target) === true) return
      closeMenu(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const isK = event.code === 'KeyK' || event.key.toLowerCase() === 'k'
      if ((event.metaKey || event.ctrlKey) && isK) {
        closeMenu(false)
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    })
  })

  const startTopUp = (): void => {
    closeMenu(false)
    queueMicrotask(() => session.openTopUp())
  }

  return (
    <div
      ref={root}
      class="console-create"
      onFocusOut={(event) => {
        if (!open()) return
        const next = event.relatedTarget ?? document.activeElement
        if (next instanceof Node && root?.contains(next) === true) return
        closeMenu(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        class="console-create-trigger"
        aria-label="Создать"
        title="Создать"
        aria-expanded={open()}
        aria-controls="console-create-panel"
        onClick={() => (open() ? closeMenu(true) : openMenu())}
      >
        <Icon name="plus" size={15} />
        <span class="console-trigger-label">Создать</span>
      </button>
      <Show when={present()}>
        <div
          ref={panel}
          id="console-create-panel"
          class="console-create-panel"
          aria-label="Создать"
          role="group"
        >
          <A href="/console" class="console-create-action" onClick={() => closeMenu(false)}>
            <Icon name="plus" size={16} />
            <span>Новая машина</span>
          </A>
          <A href="/console/keys" class="console-create-action" onClick={() => closeMenu(false)}>
            <Icon name="key" size={16} />
            <span>Ключ API</span>
          </A>
          <button type="button" class="console-create-action" onClick={startTopUp}>
            <Icon name="chart" size={16} />
            <span>Пополнить счёт</span>
          </button>
          <A href="/docs" class="console-create-action" onClick={() => closeMenu(false)}>
            <Icon name="globe" size={16} />
            <span>Справка</span>
          </A>
        </div>
      </Show>
    </div>
  )
}
