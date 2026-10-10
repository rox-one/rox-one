/**
 * Tray navigation consumers (row b2.7).
 *
 * The tray dispatches `menu:openDashboard` and `menu:runDoctor` as broadcast
 * channels; before this module those channels had no consumer, so the menu
 * items silently did nothing. This is the renderer-side consumer:
 *
 *   openDashboard → navigate to the workbench home dashboard
 *   runDoctor     → run the host doctor (the `diagnostics:run` handler) and
 *                   hand the report to the presenter
 *
 * Dependency-injected and side-effect-free at import time so both paths are
 * unit-testable without a DOM or Electron.
 */

import type { DoctorReport } from '@rox/shared/service-lifecycle'

export interface TrayDoctorDeps {
  /** Runs the host doctor — the same handler as `diagnostics:run`. */
  readonly runDoctor: () => Promise<DoctorReport>
  readonly presentDoctor: (report: DoctorReport) => void
  readonly reportError: (error: unknown) => void
}

export interface TrayNavigationDeps extends TrayDoctorDeps {
  /** Subscribe to the tray "Open dashboard" channel; returns an unsubscribe. */
  readonly onOpenDashboard: (handler: () => void) => () => void
  /** Subscribe to the tray "Run diagnostics" channel; returns an unsubscribe. */
  readonly onRunDoctor: (handler: () => void) => () => void
  readonly navigateHome: () => void
}

/** Run the host doctor and hand the report (or the failure) to the presenter. */
export async function runTrayDoctor(deps: TrayDoctorDeps): Promise<void> {
  try {
    deps.presentDoctor(await deps.runDoctor())
  } catch (error) {
    deps.reportError(error)
  }
}

/**
 * Attach the tray navigation channels to the app. Returns one unsubscribe that
 * detaches both listeners.
 */
export function installTrayNavigation(deps: TrayNavigationDeps): () => void {
  const offDashboard = deps.onOpenDashboard(() => { deps.navigateHome() })
  const offDoctor = deps.onRunDoctor(() => { void runTrayDoctor(deps) })
  return () => {
    offDashboard()
    offDoctor()
  }
}