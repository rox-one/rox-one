/**
 * Run the quit cleanup, then ALWAYS terminate the process.
 *
 * `before-quit` cancels the default quit with `event.preventDefault()`, so if
 * `cleanup` throws or rejects (an unguarded dispose step in performQuitCleanup
 * failing between awaits) the process would otherwise survive with no windows
 * and keep the server/config locks held. Running `exit` in a `finally`
 * guarantees termination regardless of how cleanup ends.
 */
export async function runQuitCleanupThenExit(
  cleanup: () => Promise<void>,
  exit: (code: number) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    onError(error)
  } finally {
    exit(0)
  }
}