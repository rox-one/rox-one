import type { CoordinatorReject, ExecutionHost, ExecutionRun, PauseResult } from './types.ts'

const FLAG_TERMINAL = 'workbench.terminal.v1'
const FLAG_COORDINATOR = 'execution.coordinator.v1'

export class ExecutionCoordinator {
  #flags: Set<string>
  #epochs = new Map<string, number>()

  constructor(opts: { flags: Set<string> }) {
    this.#flags = opts.flags
  }

  createRun(sessionId?: string): ExecutionRun | CoordinatorReject {
    if (!this.#flags.has(FLAG_TERMINAL) || !this.#flags.has(FLAG_COORDINATOR)) {
      return { code: 'FLAG_OFF' }
    }
    const run: ExecutionRun = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    if (sessionId !== undefined) run.sessionId = sessionId
    return run
  }

  attachTerminal(
    terminalId: string,
    host: ExecutionHost | { kind: string },
  ): { epoch: number } | CoordinatorReject {
    if (!this.#flags.has(FLAG_TERMINAL) || !this.#flags.has(FLAG_COORDINATOR)) {
      return { code: 'FLAG_OFF' }
    }
    if (host.kind !== 'local-electron') return { code: 'HOST_UNSUPPORTED' }
    const epoch = this.#epochs.get(terminalId) ?? 1
    this.#epochs.set(terminalId, epoch)
    return { epoch }
  }

  async pause(_terminalId: string): Promise<PauseResult> {
    return 'unsupported'
  }
}
