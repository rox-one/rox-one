#!/usr/bin/env bun
/**
 * rox-maild entry point.
 *
 *   bun run services/rox-maild/src/index.ts
 *
 * All configuration comes from the environment (see services/rox-maild/README.md).
 */
import { type Config, ConfigError, loadConfig } from './config.ts'
import { log } from './log.ts'
import { startServer } from './server.ts'

function main(): void {
  let config: Config
  try {
    config = loadConfig()
  } catch (error) {
    const detail = error instanceof ConfigError ? error.message : String(error)
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'configuration invalid', detail })}\n`)
    process.exit(1)
  }

  const server = startServer({ config })
  log('info', 'rox-maild listening', {
    port: server.port,
    smtp: `${config.smtp.host}:${config.smtp.port}`,
    stalwart: config.stalwartAdminUrl,
    broker: config.brokerUrl,
    domain: config.mailDomain,
    jmapUrl: config.jmapUrl,
  })

  const shutdown = (signal: string) => {
    log('info', 'shutting down', { signal })
    server.stop(true)
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (import.meta.main) main()