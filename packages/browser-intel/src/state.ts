/**
 * Opt-in state for the Browser Intelligence Pipeline.
 *
 * Follows the `browser-cookie-import.json` precedent: consent is written to its
 * own file under the config dir rather than into `config.json`, so revoking and
 * auditing the switch stays independent of general app settings. Nothing in the
 * pipeline reads a profile before `consent === true`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { resolveConfigDir } from '@rox/shared/config'

import { BROWSER_INTEL_STATE_BASENAME } from './paths.ts'
import type { BrowserIntelState } from './types.ts'

export function defaultBrowserIntelState(): BrowserIntelState {
  return { consent: false, consentAt: null, lastRunAt: null, lastResult: null, error: null, revision: 0 }
}

export function browserIntelStatePath(configDir: string = resolveConfigDir()): string {
  return join(configDir, BROWSER_INTEL_STATE_BASENAME)
}

function parseState(raw: unknown): BrowserIntelState {
  const fallback = defaultBrowserIntelState()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const record = raw as Record<string, unknown>
  const lastResult = record.lastResult
  return {
    consent: record.consent === true,
    consentAt: typeof record.consentAt === 'number' && Number.isFinite(record.consentAt) ? record.consentAt : null,
    lastRunAt: typeof record.lastRunAt === 'number' && Number.isFinite(record.lastRunAt) ? record.lastRunAt : null,
    lastResult:
      lastResult !== null && typeof lastResult === 'object' && !Array.isArray(lastResult)
        ? {
            profiles: Number((lastResult as Record<string, unknown>).profiles ?? 0) || 0,
            visits: Number((lastResult as Record<string, unknown>).visits ?? 0) || 0,
            urls: Number((lastResult as Record<string, unknown>).urls ?? 0) || 0,
            slots: Number((lastResult as Record<string, unknown>).slots ?? 0) || 0,
            errors: Number((lastResult as Record<string, unknown>).errors ?? 0) || 0,
          }
        : null,
    error: typeof record.error === 'string' ? record.error : null,
    revision: typeof record.revision === 'number' && Number.isFinite(record.revision) ? record.revision : 0,
  }
}

export function readBrowserIntelState(configDir: string = resolveConfigDir()): BrowserIntelState {
  try {
    const raw = readFileSync(browserIntelStatePath(configDir), 'utf8')
    return parseState(JSON.parse(raw) as unknown)
  } catch {
    return defaultBrowserIntelState()
  }
}

export function writeBrowserIntelState(state: BrowserIntelState, configDir: string = resolveConfigDir()): BrowserIntelState {
  const path = browserIntelStatePath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
  return state
}

/**
 * Flip the opt-in switch.
 *
 * Revoking keeps the last run receipt but clears the error: a user who turns
 * the feature off should not see a stale failure for a pipeline they disabled.
 */
export function setBrowserIntelConsent(
  consent: boolean,
  configDir: string = resolveConfigDir(),
  now: number = Date.now(),
): BrowserIntelState {
  const previous = readBrowserIntelState(configDir)
  const next: BrowserIntelState = {
    ...previous,
    consent,
    consentAt: consent ? now : null,
    error: consent ? previous.error : null,
    revision: previous.revision + 1,
  }
  return writeBrowserIntelState(next, configDir)
}

export function isBrowserIntelConsentGranted(configDir: string = resolveConfigDir()): boolean {
  return readBrowserIntelState(configDir).consent
}

export function recordBrowserIntelRun(
  result: NonNullable<BrowserIntelState['lastResult']>,
  configDir: string = resolveConfigDir(),
  now: number = Date.now(),
): BrowserIntelState {
  const previous = readBrowserIntelState(configDir)
  return writeBrowserIntelState(
    { ...previous, lastRunAt: now, lastResult: result, error: result.errors > 0 ? previous.error : null },
    configDir,
  )
}

export function recordBrowserIntelError(error: string | null, configDir: string = resolveConfigDir()): BrowserIntelState {
  const previous = readBrowserIntelState(configDir)
  return writeBrowserIntelState({ ...previous, error }, configDir)
}