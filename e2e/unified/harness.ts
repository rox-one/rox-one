/**
 * W1-10 (#1507) — two-user E2E harness skeleton (Electron + web).
 *
 * Wave-2 journey tests (J1–J23) build on `createTwoUserHarness()`: two
 * seeded clients (A = owner, B = member) over a seeded workspace. Clients
 * are stubs until the Electron/web drivers land — every stub below is
 * marked STUB and fails loudly when invoked, so a journey can never pass
 * vacuously.
 */

import { seedTwoUserWorkspace, type SeededWorkspace } from '@rox/test-harness'

export type HarnessClientKind = 'electron' | 'web'

export interface HarnessClient {
  kind: HarnessClientKind
  /** STUB(#1507-wave2): backed by a real Electron/web driver in wave 2. */
  sendMessage: (chatId: string, text: string) => Promise<void>
  /** STUB(#1507-wave2): backed by a real Electron/web driver in wave 2. */
  readMessages: (chatId: string) => Promise<string[]>
}

export interface TwoUserHarness {
  workspace: SeededWorkspace
  alice: HarnessClient
  bob: HarnessClient
}

function stubClient(kind: HarnessClientKind): HarnessClient {
  const notReady = (): Promise<never> =>
    Promise.reject(new Error(`STUB(#1507-wave2): ${kind} driver not implemented yet`))
  return { kind, sendMessage: () => notReady(), readMessages: () => notReady() }
}

export function createTwoUserHarness(kind: HarnessClientKind = 'web'): TwoUserHarness {
  return {
    workspace: seedTwoUserWorkspace(),
    alice: stubClient(kind),
    bob: stubClient(kind),
  }
}
