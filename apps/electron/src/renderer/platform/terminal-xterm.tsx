/**
 * Spike stub: xterm.js host planner for terminal-contribution.
 * Live @xterm/xterm is not imported. Flags default off — no mount.
 *
 * Spec: docs/specs/2026-08-25-unified-execution-workbench/xterm-native-spike.md
 */

const FLAG_TERMINAL = 'workbench.terminal.v1'
const FLAG_COORDINATOR = 'execution.coordinator.v1'

export type XtermMountPlan =
  | { kind: 'skipped'; reason: 'flag-off' }
  | { kind: 'stub'; adapter: 'xterm.js'; pty: 'native-crate-unwired' }

export type PtyAdapterKind = 'napi' | 'sidecar'

export type D2RestoreDecision =
  | { status: 'restore'; terminalId: string; via: 'snapshot-barrier' }
  | { status: 'unsupported'; reason: 'napi-main-died' | 'sidecar-dead' | 'not-found' }

export function isXtermMountEnabled(requested: ReadonlySet<string>): boolean {
  return requested.has(FLAG_TERMINAL) && requested.has(FLAG_COORDINATOR)
}

export function planXtermMount(requested: ReadonlySet<string>): XtermMountPlan {
  if (!isXtermMountEnabled(requested)) return { kind: 'skipped', reason: 'flag-off' }
  return { kind: 'stub', adapter: 'xterm.js', pty: 'native-crate-unwired' }
}

export function mountTerminalXterm(
  parent: HTMLElement | null,
  requested: ReadonlySet<string>,
): { host: HTMLElement; dispose(): void } | null {
  if (!parent || !isXtermMountEnabled(requested)) return null
  const host = parent.ownerDocument.createElement('div')
  host.dataset.uewXtermHost = 'stub'
  host.dataset.uewXtermState = 'flag-on-unwired'
  parent.appendChild(host)
  return {
    host,
    dispose() {
      host.remove()
    },
  }
}

export function planD2Restore(input: {
  adapter: PtyAdapterKind
  terminalId: string
  sidecarAlive?: boolean
}): D2RestoreDecision {
  if (!input.terminalId) return { status: 'unsupported', reason: 'not-found' }
  if (input.adapter === 'napi') return { status: 'unsupported', reason: 'napi-main-died' }
  if (!input.sidecarAlive) return { status: 'unsupported', reason: 'sidecar-dead' }
  return { status: 'restore', terminalId: input.terminalId, via: 'snapshot-barrier' }
}
