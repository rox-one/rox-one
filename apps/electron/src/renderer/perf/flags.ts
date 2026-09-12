/**
 * Perf harness is opt-in and independent of workbench.* flags.
 * Default off: unset env, no query param, no localStorage key.
 */
export const PERF_HARNESS_STORAGE_KEY = 'craft.perfHarness'
export const PERF_HARNESS_QUERY = 'perfHarness'
export const PERF_HARNESS_ENV = 'CRAFT_PERF_HARNESS'

function envEnabled(): boolean {
  if (typeof process === 'undefined') return false
  const value = process.env?.[PERF_HARNESS_ENV]
  return value === '1' || value === 'true'
}

function queryEnabled(): boolean {
  if (typeof window === 'undefined' || !window.location?.search) return false
  try {
    return new URLSearchParams(window.location.search).get(PERF_HARNESS_QUERY) === '1'
  } catch {
    return false
  }
}

function storageEnabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    return window.localStorage.getItem(PERF_HARNESS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isPerfHarnessEnabled(): boolean {
  return envEnabled() || queryEnabled() || storageEnabled()
}
