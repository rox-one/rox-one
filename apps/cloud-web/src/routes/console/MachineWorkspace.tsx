import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

import type { FileEntry, Sandbox } from '@/lib/api'

import FilePreview from './FilePreview'
import Files from './Files'
import Terminal from './Terminal'

import './workspace.css'

export interface MachineWorkspaceProps {
  sandbox: Sandbox
  enabled: boolean
  disabledReason: string
  promptUser: string
  promptHost: string
}

type Splitter = 'terminal' | 'preview'

/**
 * The machine workbench: terminal, files and inspector in one row with two
 * draggable dividers. Widths are percentages of the bench, so a window resize
 * keeps the balance; a narrow screen stacks the three panes instead.
 */
export default function MachineWorkspace(props: MachineWorkspaceProps): JSX.Element {
  const [selected, setSelected] = createSignal<FileEntry | null>(null)
  const [terminalPct, setTerminalPct] = createSignal(55)
  const [filesPct, setFilesPct] = createSignal(24)
  let benchEl: HTMLElement | undefined

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max)

  const drag = (kind: Splitter, event: PointerEvent): void => {
    event.preventDefault()
    const bench = benchEl
    if (bench === undefined) return
    const width = bench.getBoundingClientRect().width
    if (width <= 0) return
    const startX = event.clientX
    const startTerminal = terminalPct()
    const startFiles = filesPct()
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (pointer: PointerEvent): void => {
      const delta = ((pointer.clientX - startX) / width) * 100
      if (kind === 'terminal') {
        const nextTerminal = clamp(startTerminal + delta, 34, 59)
        const nextFiles = clamp(startFiles - delta, 21, 34)
        setTerminalPct(nextTerminal)
        setFilesPct(Math.min(nextFiles, 79 - nextTerminal))
        return
      }
      const nextFiles = clamp(startFiles + delta, 21, 34)
      setFilesPct(Math.min(nextFiles, 79 - startTerminal))
    }

    const stop = (): void => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const nudge = (kind: Splitter, direction: number): void => {
    if (kind === 'terminal') {
      const nextTerminal = clamp(terminalPct() + direction * 2, 34, 59)
      setTerminalPct(nextTerminal)
      setFilesPct(Math.min(filesPct(), 79 - nextTerminal))
      return
    }
    setFilesPct(clamp(filesPct() + direction * 2, 21, 34))
  }

  return (
    <section
      ref={(element) => (benchEl = element)}
      class="machine-workspace"
      style={`--terminal-pct:${terminalPct()}%;--files-pct:${filesPct()}%`}
      aria-label="Рабочее место машины"
    >
      <div class="workspace-pane workspace-terminal">
        <Terminal
          sandboxId={props.sandbox.id}
          shortId={props.sandbox.id.replace(/^sbx_/, '').slice(0, 8)}
          promptUser={props.promptUser}
          promptHost={props.promptHost}
          enabled={props.enabled}
          disabledReason={props.disabledReason}
        />
      </div>

      <div
        class="workspace-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину терминала"
        tabindex="0"
        onPointerDown={(event) => drag('terminal', event)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            nudge('terminal', -1)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            nudge('terminal', 1)
          }
        }}
      >
        <span aria-hidden="true" />
      </div>

      <div class="workspace-pane workspace-files">
        <Files
          sandboxId={props.sandbox.id}
          enabled={props.enabled}
          reason={props.disabledReason}
          selectedPath={selected()?.path ?? null}
          onSelect={(entry) =>
            setSelected((current) => (current?.path === entry?.path ? null : entry))
          }
        />
      </div>

      <div
        class="workspace-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину файлов"
        tabindex="0"
        onPointerDown={(event) => drag('preview', event)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            nudge('preview', -1)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            nudge('preview', 1)
          }
        }}
      >
        <span aria-hidden="true" />
      </div>

      <div class="workspace-pane workspace-preview">
        <FilePreview
          sandboxId={props.sandbox.id}
          entry={selected()}
          enabled={props.enabled}
          onClose={() => setSelected(null)}
        />
      </div>
    </section>
  )
}
