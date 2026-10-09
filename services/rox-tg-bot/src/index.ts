#!/usr/bin/env bun
/**
 * rox-tg-bot entry point.
 *
 *   bun run services/rox-tg-bot/src/index.ts
 *
 * All configuration comes from the environment (see services/rox-tg-bot/README.md).
 * The process refuses to boot without TELEGRAM_BOT_TOKEN or TG_LINK_SERVICE_TOKEN.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { botTransportFromConfig, TelegramBot } from './bot.ts'
import { ConfigError, loadConfig } from './config.ts'
import { startServer } from './http.ts'
import { log } from './log.ts'
import { LinkState } from './state.ts'

function fail(message: string, detail: string): never {
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: message, detail })}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    fail('configuration invalid', error instanceof ConfigError ? error.message : String(error))
  }

  if (config.dbPath !== ':memory:') {
    try {
      mkdirSync(dirname(config.dbPath), { recursive: true })
    } catch (error) {
      fail('cannot create database directory', String(error))
    }
  }

  const state = new LinkState(config.dbPath)
  const bot = new TelegramBot({
    transport: botTransportFromConfig(config),
    state,
    pollTimeoutSec: config.polling.pollTimeoutSec,
    backoffBaseMs: config.polling.backoffBaseMs,
    backoffMaxMs: config.polling.backoffMaxMs,
  })

  if (config.botUsername === '') {
    const discovered = await bot.resolveUsername()
    log('info', 'telegram bot identity resolved', { username: discovered ?? 'unknown' })
  }

  const server = startServer({ config, state, botUsername: () => config.botUsername || bot.botUsername })
  log('info', 'rox-tg-bot listening', {
    port: server.port,
    db: config.dbPath,
    ttlMs: config.ttlMs,
    maxAttempts: config.maxAttempts,
  })

  void bot
    .start()
    .catch(error => log('error', 'telegram worker stopped', { detail: error instanceof Error ? error.message : String(error) }))

  const shutdown = (signal: string) => {
    log('info', 'shutting down', { signal })
    bot.stop()
    state.close()
    server.stop(true)
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (import.meta.main) void main()