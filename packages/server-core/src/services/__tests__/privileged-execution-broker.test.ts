import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPrivilegedCommand } from '@craft-agent/shared/agent/core/privileged-policy'
import { PrivilegedExecutionBroker } from '../privileged-execution-broker'
import type { Logger } from '../../runtime/platform'

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

describe('PrivilegedExecutionBroker', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function broker(): PrivilegedExecutionBroker {
    const dir = mkdtempSync(join(tmpdir(), 'priv-broker-'))
    dirs.push(dir)
    process.env.CRAFT_CONFIG_DIR = dir
    return new PrivilegedExecutionBroker(silent)
  }

  it('allows brew cask install and returns a matching command hash', () => {
    const b = broker()
    const command = 'brew install --cask docker'
    const req = b.createRequest({
      requestId: 'r1',
      sessionId: 's1',
      command,
    })
    expect(req.commandHash).toBe(hashPrivilegedCommand(command))
    const resolved = b.resolveApproval('r1', true, { expectedCommandHash: req.commandHash })
    expect(resolved.ok).toBe(true)
    expect(resolved.request?.command).toBe(command)
  })

  it('blocks commands outside the privileged policy', () => {
    const b = broker()
    const req = b.createRequest({
      requestId: 'r2',
      sessionId: 's1',
      command: 'rm -rf /',
    })
    expect(req.commandHash).toBe(hashPrivilegedCommand('rm -rf /'))
    const resolved = b.resolveApproval('r2', true)
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toContain('Privileged execution policy')
  })

  it('rejects hash mismatch', () => {
    const b = broker()
    b.createRequest({
      requestId: 'r3',
      sessionId: 's1',
      command: 'brew install --cask docker',
    })
    const resolved = b.resolveApproval('r3', true, {
      expectedCommandHash: hashPrivilegedCommand('brew install --cask other'),
    })
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toContain('hash mismatch')
  })

  it('rejects expired requests', async () => {
    const b = broker()
    b.createRequest({
      requestId: 'r4',
      sessionId: 's1',
      command: 'brew install --cask docker',
      approvalTtlSeconds: 0,
    })
    await Bun.sleep(15)
    const resolved = b.resolveApproval('r4', true)
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toContain('expired')
  })
})
