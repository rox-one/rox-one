/**
 * Splash / sessionsLoaded gate helper.
 *
 * isFullyReady = appState === 'ready' && sessionsLoaded. Permission mode is
 * already seeded from getSessions(), so the per-session permission-mode
 * reconcile (N+1 IPC) must not block splash dismiss. Mark ready first, then
 * kick off the reconcile in the background without awaiting it.
 */
export interface MarkSessionsReadyThenReconcileArgs {
  /** Flip the splash gate (e.g. setSessionsLoaded(true)). */
  markReady: () => void
  /** Background per-session reconcile; never awaited by the caller. */
  reconcileAll: () => Promise<unknown>
}

export function markSessionsReadyThenReconcile(args: MarkSessionsReadyThenReconcileArgs): void {
  args.markReady()
  void args.reconcileAll()
}
