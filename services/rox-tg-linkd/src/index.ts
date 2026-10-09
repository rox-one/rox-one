#!/usr/bin/env bun
/**
 * rox-tg-linkd entry point.
 *
 *   bun run services/rox-tg-linkd/src/index.ts
 *
 * All configuration comes from the environment (see services/rox-tg-linkd/README.md).
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { type Config, ConfigError, loadConfig } from './config.ts'
import { log } from './log.ts'
import { startServer } from './server.ts'
import { LinkStore } from './store.ts'
import { TelegramBot } from './telegram.ts'

function main(): void {
  let config: Config
  try {
    config = loadConfig()
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : String(error)
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'configuration invalid', detail })}\n`)
    process.exit(1)
  }

  if (config.dbPath !== ':memory:') {
    try {
      mkdirSync(dirname(config.dbPath), { recursive: true })
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'cannot create database directory', detail: String(error) })}\n`)
      process.exit(1)
    }
  }

  const store = new LinkStore(config.dbPath)
  const bot = new TelegramBot({ config, store })
  const server = startServer({ config, store, botUsername: () => bot.username() })

  log('info', 'rox-tg-linkd listening', {
    port: server.port,
    db: config.dbPath,
    ttlMs: config.ttlMs,
    maxAttempts: config.maxAttempts,
    botToken: config.botToken === '' ? 'absent' : 'present',
  })

  if (config.botToken === '') {
    log('warn', 'TG_BOT_TOKEN is not set — /api/health reports {"ok":false,"reason":"no-token"} and links cannot be created')
  } else {
    void bot
      .resolveUsername()
      .then(username => log('info', 'telegram bot identity resolved', { username: username ?? config.botUsername ?? 'unknown' }))
      .then(() => bot.start())
      .catch(error => log('error', 'telegram worker stopped', { detail: error instanceof Error ? error.message : String(error) }))
  }

  const shutdown = (signal: string) => {
    log('info', 'shutting down', { signal })
    bot.stop()
    store.close()
    server.stop(true)
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (import.meta.main) main()