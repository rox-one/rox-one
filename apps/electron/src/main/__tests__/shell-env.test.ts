import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

mock.module('../logger', () => {
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  return { mainLog: stubLog, sessionLog: stubLog, handlerLog: stubLog, windowLog: stubLog, agentLog: stubLog, searchLog: stubLog, isDebugMode: false, getLogFilePath: () => '' }
})

const {
  SHELL_ENV_CACHE_TTL_MS, captureLoginShellEnv, defaultShellEnvCachePath, filterCacheableEnv, isSecretEnvVar, isShellEnvReady,
  isShellEnvSettled, parseShellEnvOutput, readShellEnvCache, readShellEnvCacheEntry, resetShellEnvForTests, shellEnvCacheKey,
  shellEnvSpawnGate, startShellEnvLoad, whenShellEnvReady, writeShellEnvCache,
} = await import('../shell-env')

let home: string
let cachePath: string
beforeEach(() => {
  resetShellEnvForTests()
  home = mkdtempSync(join(tmpdir(), 'rox-shell-env-'))
  cachePath = join(home, 'Library', 'Caches', 'Rox', 'shell-env.json')
  writeFileSync(join(home, '.zshrc'), 'export PATH=/opt/homebrew/bin:$PATH\n')
})
afterEach(() => { resetShellEnvForTests(); rmSync(home, { recursive: true, force: true }) })

const output = (env: Record<string, string>) => `oh-my-zsh banner\n__ENV_START__\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const baseEnv = (): NodeJS.ProcessEnv => ({ HOME: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' })

describe('shell-env (PERF-03)', () => {
  it('returns synchronously without waiting for the login shell; applies fallback PATH until it finishes', async () => {
    const env = baseEnv(); const capture = deferred<string>(); let calls = 0
    const started = performance.now()
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, capture: () => { calls++; return capture.promise } })
    expect(performance.now() - started).toBeLessThan(200)
    expect(calls).toBe(1)
    expect(env.PATH!.split(':')[0]).toBe('/opt/homebrew/bin')
    expect(isShellEnvReady()).toBe(false)
    let ready = false; void whenShellEnvReady().then(() => { ready = true })
    await Promise.resolve(); expect(ready).toBe(false)
    capture.resolve(output({ PATH: '/Users/me/.nvm/bin:/usr/bin', GITHUB_TOKEN: 'ghp_secret', NVM_DIR: '/Users/me/.nvm', VITE_DEV_SERVER_URL: 'http://x' }))
    await whenShellEnvReady()
    expect(ready).toBe(true)
    expect(env.PATH).toBe('/Users/me/.nvm/bin:/usr/bin')
    expect(env.GITHUB_TOKEN).toBe('ghp_secret')
    expect(env.VITE_DEV_SERVER_URL).toBeUndefined()
    // Cache written 0600 without secrets.
    const raw = readFileSync(cachePath, 'utf8')
    expect(raw).not.toContain('ghp_secret')
    expect(JSON.parse(raw).omittedKeys).toBe(1)
    expect(statSync(cachePath).mode & 0o777).toBe(0o600)
    expect(statSync(join(cachePath, '..')).mode & 0o777).toBe(0o700)
  })

  it('applies a complete cache immediately and is ready without waiting; refresh runs later', async () => {
    const key = shellEnvCacheKey('/bin/zsh', home)
    writeShellEnvCache(cachePath, { version: 2, key, capturedAt: 1_000, env: { PATH: '/cached/bin:/usr/bin', NVM_DIR: '/n' }, omittedKeys: 0 })
    const env = baseEnv(); let calls = 0
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, now: () => 2_000, refreshDelayMs: 10,
      capture: async () => { calls++; return output({ PATH: '/fresh/bin' }) } })
    expect(env.PATH).toBe('/cached/bin:/usr/bin'); expect(env.NVM_DIR).toBe('/n')
    expect(isShellEnvReady()).toBe(true); expect(calls).toBe(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(1); expect(env.PATH).toBe('/fresh/bin')
  })

  it('waits for the capture when the cache had to omit secrets', async () => {
    const key = shellEnvCacheKey('/bin/zsh', home)
    writeShellEnvCache(cachePath, { version: 2, key, capturedAt: 1_000, env: { PATH: '/cached/bin' }, omittedKeys: 2 })
    const env = baseEnv(); const capture = deferred<string>()
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, now: () => 2_000, capture: () => capture.promise })
    expect(env.PATH).toBe('/cached/bin'); expect(isShellEnvReady()).toBe(false)
    capture.resolve(output({ PATH: '/cached/bin', OPENAI_API_KEY: 'sk' }))
    await whenShellEnvReady(); expect(env.OPENAI_API_KEY).toBe('sk')
  })

  it('invalidates the cache on rc-file change, TTL expiry, shell change or corruption', () => {
    const key = shellEnvCacheKey('/bin/zsh', home)
    writeShellEnvCache(cachePath, { version: 2, key, capturedAt: 1_000, env: { PATH: '/p' }, omittedKeys: 0 })
    expect(readShellEnvCache(cachePath, key, 1_000 + SHELL_ENV_CACHE_TTL_MS)).not.toBeNull()
    expect(readShellEnvCache(cachePath, key, 1_001 + SHELL_ENV_CACHE_TTL_MS)).toBeNull()
    expect(readShellEnvCache(cachePath, shellEnvCacheKey('/bin/bash', home), 1_000)).toBeNull()
    writeFileSync(join(home, '.zshrc'), 'export PATH=/changed:$PATH\n# longer')
    expect(shellEnvCacheKey('/bin/zsh', home)).not.toBe(key)
    writeFileSync(cachePath, '{broken')
    expect(readShellEnvCache(cachePath, key, 1_000)).toBeNull()
  })

  it('survives a failing login shell (ready, fallback PATH kept, no cache written)', async () => {
    const env = baseEnv()
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, capture: async () => { throw new Error('timeout') } })
    await whenShellEnvReady()
    expect(isShellEnvReady()).toBe(true)
    expect(env.PATH!.startsWith('/opt/homebrew/bin:')).toBe(true)
    expect(existsSync(cachePath)).toBe(false)
  })

  it('is a no-op off macOS and in dev', () => {
    const env = baseEnv(); let calls = 0
    startShellEnvLoad({ platform: 'win32', env, home, cachePath, capture: async () => { calls++; return '' } })
    startShellEnvLoad({ platform: 'darwin', env: { ...env, VITE_DEV_SERVER_URL: 'http://localhost' }, home, cachePath, capture: async () => { calls++; return '' } })
    expect(calls).toBe(0); expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin'); expect(isShellEnvReady()).toBe(true)
  })

  it('parses env output and filters secret-looking keys from the cache', () => {
    expect(parseShellEnvOutput(output({ A: 'x=y', VITE_X: '1' }))).toEqual({ A: 'x=y' })
    expect(filterCacheableEnv({ PATH: '/p', AWS_SECRET_ACCESS_KEY: 's', NPM_TOKEN: 't', HOMEBREW_PREFIX: '/opt' }))
      .toEqual({ env: { PATH: '/p', HOMEBREW_PREFIX: '/opt' }, omitted: 2 })
  })

  it('denylist covers KEY$, _PAT$, PASS, PWD$, DSN, WEBHOOK and URL userinfo; exempts known non-secrets', () => {
    for (const key of ['OPENAI_KEY', 'STRIPE_SECRET_KEY', 'GH_PAT', 'GITLAB_PAT', 'DB_PASS', 'PASSPHRASE', 'MYSQL_PWD',
      'SENTRY_DSN', 'SLACK_WEBHOOK_URL', 'GITHUB_TOKEN', 'CLIENT_SECRET', 'SMTP_PASSWORD', 'ANTHROPIC_API_KEY',
      'AWS_ACCESS_KEY_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'NPM_AUTH']) {
      expect(isSecretEnvVar(key, 'x')).toBe(true)
    }
    for (const key of ['PWD', 'OLDPWD', 'SSH_AUTH_SOCK', 'XAUTHORITY', 'TERM_SESSION_ID', 'ITERM_SESSION_ID',
      'SECURITYSESSIONID', 'PATH', 'HOME', 'NVM_DIR', 'HOMEBREW_PREFIX', 'LANG', 'GOPATH', 'JAVA_HOME']) {
      expect(isSecretEnvVar(key, '/some/value')).toBe(false)
    }
    // URL with userinfo is a secret whatever the variable is called.
    expect(isSecretEnvVar('DATABASE_URL', 'postgres://app:hunter2@db.internal:5432/app')).toBe(true)
    expect(isSecretEnvVar('PROXY', 'http://user:pw@proxy:8080')).toBe(true)
    expect(isSecretEnvVar('HOMEPAGE', 'https://example.com/a:b@c')).toBe(false)
    expect(isSecretEnvVar('HTTP_PROXY', 'http://proxy:8080')).toBe(false)
    // Exempt keys still drop a credential-bearing value.
    expect(isSecretEnvVar('PWD', 'https://u:p@host/')).toBe(true)
    const filtered = filterCacheableEnv({ PATH: '/p', PWD: '/w', SSH_AUTH_SOCK: '/tmp/s', GH_PAT: 'x', REDIS: 'redis://:pw@h:6379' })
    expect(filtered.env).toEqual({ PATH: '/p', PWD: '/w', SSH_AUTH_SOCK: '/tmp/s' })
    expect(filtered.omitted).toBe(2)
  })

  it('keeps the cache in a private 0700 directory (file 0600), tightening an existing directory', () => {
    expect(defaultShellEnvCachePath('/Users/me')).toBe('/Users/me/Library/Caches/Rox/shell-env/env.json')
    const path = join(home, 'cache-dir', 'env.json')
    writeShellEnvCache(path, { version: 2, key: 'k', capturedAt: 1, env: { PATH: '/p' }, omittedKeys: 0 })
    chmodSync(join(home, 'cache-dir'), 0o755)
    writeShellEnvCache(path, { version: 2, key: 'k', capturedAt: 2, env: { PATH: '/p' }, omittedKeys: 0 })
    expect(statSync(join(home, 'cache-dir')).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('ignores caches written by the previous format (version 1)', () => {
    const key = shellEnvCacheKey('/bin/zsh', home)
    writeShellEnvCache(cachePath, { version: 1, key, capturedAt: 1_000, env: { PATH: '/old' }, omittedKeys: 0 })
    expect(readShellEnvCacheEntry(cachePath, key, 1_000)).toBeNull()
  })

  it('applies an expired-but-matching cache (not ready) instead of the bare fallback, then refreshes', async () => {
    const key = shellEnvCacheKey('/bin/zsh', home)
    writeShellEnvCache(cachePath, { version: 2, key, capturedAt: 1_000, env: { PATH: '/cached/bin:/usr/bin', NVM_DIR: '/n' }, omittedKeys: 0 })
    const now = 1_000 + SHELL_ENV_CACHE_TTL_MS + 1
    expect(readShellEnvCacheEntry(cachePath, key, now)?.expired).toBe(true)
    const env = baseEnv(); const capture = deferred<string>(); let calls = 0
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, now: () => now, capture: () => { calls++; return capture.promise } })
    expect(env.PATH).toBe('/cached/bin:/usr/bin')
    expect(env.PATH!.includes('/opt/homebrew/bin')).toBe(false)
    expect(env.NVM_DIR).toBe('/n')
    expect(isShellEnvReady()).toBe(false)
    expect(calls).toBe(1)
    capture.resolve(output({ PATH: '/fresh/bin' }))
    await whenShellEnvReady()
    expect(env.PATH).toBe('/fresh/bin')
    expect(readShellEnvCache(cachePath, key, now)?.capturedAt).toBe(now)
  })

  it('latches after the first bounded wait times out: later waits and the spawn gate never block again', async () => {
    const env = baseEnv(); const capture = deferred<string>()
    startShellEnvLoad({ platform: 'darwin', env, home, cachePath, capture: () => capture.promise })
    expect(isShellEnvSettled()).toBe(false)
    expect(shellEnvSpawnGate.isReady()).toBe(false)
    const started = performance.now()
    await whenShellEnvReady(30)
    expect(performance.now() - started).toBeGreaterThanOrEqual(25)
    expect(isShellEnvReady()).toBe(false)
    expect(isShellEnvSettled()).toBe(true)
    expect(shellEnvSpawnGate.isReady()).toBe(true)
    const again = performance.now()
    await whenShellEnvReady(10_000)
    await shellEnvSpawnGate.wait()
    expect(performance.now() - again).toBeLessThan(20)
    capture.resolve(output({ PATH: '/late/bin' }))
    await new Promise(r => setTimeout(r, 0))
    expect(env.PATH).toBe('/late/bin')
    expect(isShellEnvReady()).toBe(true)
  })
})

describe('captureLoginShellEnv (real child process)', () => {
  const fakeShell = (body: string) => {
    const path = join(home, 'fake-shell.sh')
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }

  it('closes stdin so an rc file that reads stdin cannot block until the timeout', async () => {
    const shell = fakeShell('read line\necho __ENV_START__\necho PATH=/from/fake')
    const started = performance.now()
    const out = await captureLoginShellEnv(shell, { HOME: home }, 4_000)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(parseShellEnvOutput(out)).toEqual({ PATH: '/from/fake' })
  })

  it('kills a shell that ignores SIGTERM (SIGKILL on timeout)', async () => {
    const shell = fakeShell("trap '' TERM\nwhile :; do sleep 0.05; done")
    const started = performance.now()
    let error: unknown
    try { await captureLoginShellEnv(shell, { HOME: home }, 200) } catch (e) { error = e }
    expect(error).toBeDefined()
    expect((error as { signal?: string }).signal).toBe('SIGKILL')
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
