const FLAG_TERMINAL = 'workbench.terminal.v1'
const FLAG_COORDINATOR = 'execution.coordinator.v1'

export const terminalContribution = {
  kind: 'terminal' as const,
  match(navState: unknown): { kind: 'terminal'; terminalId: string; sessionId?: string } | null {
    const state = navState as { navigator?: string; details?: { type?: string; id?: string } }
    if (state.navigator === 'terminal' && state.details?.type === 'terminal' && state.details.id) {
      return { kind: 'terminal', terminalId: state.details.id }
    }
    return null
  },
  buildRoute(tab: { terminalId: string }): string {
    return `terminal/${encodeURIComponent(tab.terminalId)}`
  },
  title(tab: { terminalId: string }): string {
    return `Terminal ${tab.terminalId}`
  },
  icon(): string {
    return 'terminal'
  },
  policy: {
    singletonPer(tab: { terminalId: string }): string {
      return `terminal:${tab.terminalId}`
    },
  },
  hostKind: 'dom' as const,
  render(): unknown {
    return null
  },
  isEnabled(requested: Set<string>): boolean {
    return requested.has(FLAG_TERMINAL) && requested.has(FLAG_COORDINATOR)
  },
}
