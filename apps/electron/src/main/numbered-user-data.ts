import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

const LOCKS = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie'])

/** Import numbered Chromium profiles without moving or overwriting user data. */
export function resolveNumberedUserDataDir(appData: string, instance: string): string {
  if (!/^\d+$/.test(instance)) throw new Error('ROX_INSTANCE_NUMBER must contain digits only')
  const canonical = join(appData, `rox-${instance}`)
  const legacy = join(appData, `craft-agent-${instance}`)
  if (existsSync(legacy)) {
    const lock = join(legacy, 'SingletonLock')
    try {
      const pid = Number(readlinkSync(lock).match(/-(\d+)$/)?.[1])
      if (pid > 0) {
        let alive = false
        try { process.kill(pid, 0); alive = true } catch (error) {
          alive = (error as NodeJS.ErrnoException).code === 'EPERM'
        }
        if (alive) throw new Error(`Close legacy numbered ROX instance ${instance} before importing its profile`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'EINVAL') throw error
    }
    const copyMissing = (source: string, target: string): void => {
      if (lstatSync(source).isDirectory()) {
        if (existsSync(target) && !lstatSync(target).isDirectory()) return
        mkdirSync(target, { recursive: true })
        for (const name of readdirSync(source)) {
          if (!LOCKS.has(name)) copyMissing(join(source, name), join(target, name))
        }
      } else if (!existsSync(target)) {
        cpSync(source, target, { dereference: false, errorOnExist: true, force: false })
      }
    }
    copyMissing(legacy, canonical)
  }
  mkdirSync(canonical, { recursive: true })
  return canonical
}
