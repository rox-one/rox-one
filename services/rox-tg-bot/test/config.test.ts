import { describe, expect, test } from 'bun:test'
import { ConfigError, loadConfig } from '../src/config.ts'
import { LINK_TTL_MS, MAX_ATTEMPTS } from '../src/link.ts'

describe('config', () => {
  test('refuses to boot without TELEGRAM_BOT_TOKEN, with a clear error', () => {
    expect(() => loadConfig({ TG_LINK_SERVICE_TOKEN: 'service' })).toThrow('TELEGRAM_BOT_TOKEN is required')
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  test('refuses to boot without TG_LINK_SERVICE_TOKEN', () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: 'token' })).toThrow('TG_LINK_SERVICE_TOKEN is required')
  })

  test('applies production defaults', () => {
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: 'token', TG_LINK_SERVICE_TOKEN: 'service' })
    expect(config.port).toBe(8789)
    expect(config.dbPath).toBe('/var/lib/rox-tg-bot/state.sqlite')
    expect(config.ttlMs).toBe(LINK_TTL_MS)
    expect(config.maxAttempts).toBe(MAX_ATTEMPTS)
    expect(config.botUsername).toBe('')
    expect(config.polling.apiBase).toBe('https://api.telegram.org')
  })

  test('reads overrides and normalises BOT_USERNAME', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: 'token',
      TG_LINK_SERVICE_TOKEN: 'service',
      BOT_USERNAME: '@rox_bot',
      PORT: '9000',
      TG_LINK_DB: ':memory:',
      TG_LINK_MAX_ATTEMPTS: '3',
      TG_LINK_TTL_MS: '60000',
    })
    expect(config.botUsername).toBe('rox_bot')
    expect(config.port).toBe(9000)
    expect(config.dbPath).toBe(':memory:')
    expect(config.maxAttempts).toBe(3)
    expect(config.ttlMs).toBe(60_000)
  })

  test('rejects an invalid BOT_USERNAME and bad numbers', () => {
    expect(() =>
      loadConfig({ TELEGRAM_BOT_TOKEN: 'token', TG_LINK_SERVICE_TOKEN: 'service', BOT_USERNAME: 'no' }),
    ).toThrow('BOT_USERNAME is not a valid bot username')
    expect(() =>
      loadConfig({ TELEGRAM_BOT_TOKEN: 'token', TG_LINK_SERVICE_TOKEN: 'service', PORT: 'abc' }),
    ).toThrow('PORT must be an integer')
  })
})