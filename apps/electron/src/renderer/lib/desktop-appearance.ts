import type { ElectronAPI } from '../../shared/types'

/** Read a host appearance capability only in its actual desktop runtime. */
export function readDesktopAppearance<T>(
  api: Pick<ElectronAPI, 'getRuntimeEnvironment'> | undefined,
  read: () => T | Promise<T>,
  onValue: (value: T) => void,
  onUnavailable: (error?: unknown) => void,
): () => void {
  let cancelled = false
  if (api?.getRuntimeEnvironment?.() !== 'electron') {
    onUnavailable()
    return () => { cancelled = true }
  }
  void Promise.resolve().then(() => cancelled ? undefined : read()).then(value => {
    if (!cancelled && value !== undefined) onValue(value)
  }, error => {
    if (!cancelled) onUnavailable(error)
  })
  return () => { cancelled = true }
}

/** Publish a saved host preference only after its real transport write succeeds. */
export async function saveDesktopAppearance<T>(
  api: Pick<ElectronAPI, 'getRuntimeEnvironment'> | undefined,
  write: () => Promise<T>,
  onSaved: (value: T) => void,
  onUnavailable: (error?: unknown) => void,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  if (isCancelled()) return false
  if (api?.getRuntimeEnvironment?.() !== 'electron') {
    onUnavailable()
    return false
  }
  let value: T
  try { value = await write() }
  catch (error) {
    if (!isCancelled()) onUnavailable(error)
    return false
  }
  if (isCancelled()) return false
  onSaved(value)
  return true
}
