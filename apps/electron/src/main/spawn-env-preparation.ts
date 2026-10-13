import { registerSpawnEnvGate, whenSpawnEnvReady } from '@rox/shared/toolchain/spawn-readiness'

/**
 * Run a spawn-environment preparation step (e.g. the Windows toolchain read)
 * without blocking boot. Only spawns wait for it: `whenSpawnEnvReady()` holds
 * until the step settles and then also waits for any gate the step registered
 * meanwhile (e.g. the Windows repair gate). The returned promise never rejects.
 */
export function startSpawnEnvPreparation(
  name: string,
  run: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  let settled = false
  const done = Promise.resolve()
    .then(run)
    .catch(onError)
    .finally(() => { settled = true })
  registerSpawnEnvGate(name, {
    isReady: () => settled,
    wait: () => done.then(() => whenSpawnEnvReady()),
  })
  return done
}
