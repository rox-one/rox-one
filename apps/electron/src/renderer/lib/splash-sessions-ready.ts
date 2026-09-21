/**
 * Splash / cold_ready: mark sessionsLoaded before permission-mode N+1 IPC.
 *
 * getSessions() already seeds permissionMode. Awaiting per-session
 * getSessionPermissionModeState before setSessionsLoaded keeps SplashScreen
 * up for O(n) IPC (perf probe detectSessionMetadataNPlusOne). Call markReady
 * first; fire reconcile in the background.
 */
export function markSessionsReadyThenReconcile(args: {
  markReady: () => void
  reconcileAll: () => Promise<unknown>
}): void {
  args.markReady()
  void args.reconcileAll()
}
