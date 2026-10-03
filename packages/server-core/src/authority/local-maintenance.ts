import { closeSync, chmodSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { NativeAuthority } from './native-authority.ts'


export interface LocalMaintenanceResult {
  readonly exitCode: number
  readonly output: string
}

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(`missing ${name}`)
  return args[index + 1]
}

function privateDelivery(path: string, issue: () => string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    const secret = issue()
    writeFileSync(descriptor, `${secret}\n`, { encoding: 'utf8' })
    fsyncSync(descriptor)
    chmodSync(path, 0o600)
  } catch (error) {
    unlinkSync(path)
    throw error
  } finally {
    closeSync(descriptor)
  }
}

/** Host-local maintenance entry point; secrets are read from/written to private files, never arguments or output. */
export function runLocalMaintenanceCommand(args: readonly string[]): LocalMaintenanceResult {
  const [command, ...options] = args
  if (command !== 'bootstrap' && command !== 'enroll' && command !== 'recover-admin') {
    throw new Error('usage: local-maintenance.ts <bootstrap|recover-admin|enroll> --state-dir DIR ...')
  }
  const stateDir = option(options, '--state-dir')
  const label = option(options, '--label')
  const secretFile = option(options, command === 'enroll' ? '--ticket-file' : '--secret-file')
  if (!process.stdin.isTTY) throw new Error('maintenance requires an interactive host-local terminal')

  const authority = new NativeAuthority({ stateDir })
  try {
    if (command === 'bootstrap') {
      privateDelivery(secretFile, () => authority.bootstrapLocalAdministrator(label).credential)
    } else if (command === 'recover-admin') {
      privateDelivery(secretFile, () => authority.recoverLocalAdministrator(label).credential)
    } else {
      const adminFile = option(options, '--admin-file')
      const adminCredential = readFileSync(adminFile, 'utf8').trim()
      const expiresIn = Number(option(options, '--expires-in-ms'))
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 24 * 60 * 60 * 1000) throw new Error('expiry must be 1..86400000 milliseconds')
      privateDelivery(secretFile, () => authority.issueEnrollment(adminCredential, label, Date.now() + expiresIn))
    }
    return Object.freeze({ exitCode: 0, output: `One-time secret written to ${secretFile}\n` })
  } finally {
    authority.close()
  }
}

function runCli(): void {
  const result = runLocalMaintenanceCommand(process.argv.slice(2))
  process.stdout.write(result.output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`Local maintenance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  }
}
