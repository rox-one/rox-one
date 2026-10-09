/**
 * Host glue for the macOS Apple Calendar (EventKit) helper.
 *
 * The Swift CLI at `apps/electron/native/rox-calendar-helper` speaks single-line
 * JSON; `@rox/core/calendar`'s `AppleCalendarAdapter` only talks to it through a
 * registered binding. This module resolves the binary in both run modes and wires
 * the binding:
 *
 *   dev      -> <appPath>/native/rox-calendar-helper/bin/rox-calendar-helper
 *   packaged -> <process.resourcesPath>/bin/darwin-<arch>/rox-calendar-helper
 *
 * The binding is registered only when the `APPLE_CALENDAR_LIVE=1` gate is set AND
 * the binary exists. Everything here is fail-closed: a missing binary, an
 * unsupported platform, or a spawn failure leaves `createProductionAdapter`
 * returning the honest `UnavailableCalendarAdapter` — never a crash.
 *
 * `APPLE_CALENDAR_HELPER` overrides the resolved path (development / tests).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  appleCalendarLiveEnabled,
  registerAppleCalendarHelper,
  type AppleCalendarAuthStatus,
  type AppleCalendarHelperResult,
} from '@rox/core/calendar'

/** Env override pointing at a helper binary (development / tests). */
export const APPLE_CALENDAR_HELPER_ENV = 'APPLE_CALENDAR_HELPER'

const HELPER_FILE_NAME = 'rox-calendar-helper'

/** Injection seam so path resolution is testable without Electron. */
export interface AppleCalendarHelperPathOptions {
  platform?: NodeJS.Platform
  arch?: string
  isPackaged?: boolean
  resourcesPath?: string
  appPath?: string
  env?: Record<string, string | undefined>
}

/**
 * Resolve the helper binary path, or `null` when the platform has no helper
 * (anything but darwin). Does not check existence — see the registration helper.
 */
export function resolveAppleCalendarHelperPath(options: AppleCalendarHelperPathOptions = {}): string | null {
  const env = options.env ?? process.env
  const override = env[APPLE_CALENDAR_HELPER_ENV]?.trim()
  if (override) return override

  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return null

  if (options.isPackaged ?? app.isPackaged) {
    const resourcesPath = options.resourcesPath ?? process.resourcesPath
    if (!resourcesPath) return null
    return join(resourcesPath, 'bin', `darwin-${options.arch ?? process.arch}`, HELPER_FILE_NAME)
  }

  return join(options.appPath ?? app.getAppPath(), 'native', 'rox-calendar-helper', 'bin', HELPER_FILE_NAME)
}

/**
 * Spawn the helper with `args`. Never rejects because of a non-zero exit; only a
 * spawn failure (missing/unexecutable binary) rejects, so the adapter can report
 * "could not start" instead of a bogus helper error.
 */
export function runAppleCalendarHelper(
  helperPath: string,
  args: readonly string[],
): Promise<AppleCalendarHelperResult> {
  const { promise, resolve, reject } = Promise.withResolvers<AppleCalendarHelperResult>()
  let child: ChildProcess
  try {
    child = spawn(helperPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)))
    return promise
  }

  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })
  child.once('error', reject)
  child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }))
  return promise
}

const AUTH_STATUS_BY_NAME: Record<string, AppleCalendarAuthStatus> = {
  authorized: 'authorized',
  denied: 'denied',
  limited: 'limited',
  notDetermined: 'notDetermined',
  restricted: 'restricted',
}

/**
 * `auth-status` probe for host surfaces (health checks / menus). Returns `null`
 * when the helper is unreachable or answers with an unknown status; never throws
 * and never triggers the TCC prompt (`auth-status` is read-only).
 */
export async function probeAppleCalendarHelperAuthStatus(
  helperPath: string,
): Promise<AppleCalendarAuthStatus | null> {
  try {
    const result = await runAppleCalendarHelper(helperPath, ['auth-status'])
    if (result.exitCode !== 0) return null
    const payload: unknown = JSON.parse(result.stdout.trim() || 'null')
    if (typeof payload !== 'object' || payload === null || !('status' in payload)) return null
    const status = payload.status
    if (typeof status !== 'string' || !Object.hasOwn(AUTH_STATUS_BY_NAME, status)) return null
    return AUTH_STATUS_BY_NAME[status]
  } catch {
    return null
  }
}

export interface RegisterAppleCalendarHelperOptions extends AppleCalendarHelperPathOptions {
  log?: (message: string, error?: unknown) => void
}

export type AppleCalendarHelperRegistration =
  | { registered: true; helperPath: string }
  | {
      registered: false
      reason: 'gate-disabled' | 'platform-unsupported' | 'helper-missing' | 'error'
      helperPath: string | null
    }

/**
 * Register the helper binding when the gate is on and the binary is present.
 * Idempotent at startup; calling it with the gate off registers nothing, so the
 * adapter's default (unavailable) behaviour is unchanged.
 */
export function registerAppleCalendarHelperFromHost(
  options: RegisterAppleCalendarHelperOptions = {},
): AppleCalendarHelperRegistration {
  const log = options.log
  try {
    if (!appleCalendarLiveEnabled(options.env ?? process.env)) {
      return { registered: false, reason: 'gate-disabled', helperPath: null }
    }

    const helperPath = resolveAppleCalendarHelperPath(options)
    if (helperPath === null) {
      return { registered: false, reason: 'platform-unsupported', helperPath: null }
    }
    if (!existsSync(helperPath)) {
      // Fail-closed: make sure a stale binding from an earlier run cannot linger.
      registerAppleCalendarHelper(null)
      log?.(`[apple-calendar] helper not found at ${helperPath}`)
      return { registered: false, reason: 'helper-missing', helperPath }
    }

    registerAppleCalendarHelper({
      hasHelper: () => existsSync(helperPath),
      run: (args) => runAppleCalendarHelper(helperPath, args),
    })
    log?.(`[apple-calendar] EventKit helper registered: ${helperPath}`)

    probeAppleCalendarHelperAuthStatus(helperPath)
      .then((status) => {
        if (status) log?.(`[apple-calendar] authorization status: ${status}`)
      })
      .catch(() => {})

    return { registered: true, helperPath }
  } catch (error) {
    registerAppleCalendarHelper(null)
    log?.('[apple-calendar] helper registration failed', error)
    return { registered: false, reason: 'error', helperPath: null }
  }
}