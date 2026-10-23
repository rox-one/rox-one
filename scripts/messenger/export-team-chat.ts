#!/usr/bin/env bun
/**
 * One-off CLI: export CONFIG_DIR/team-chat.json → relay migration manifest.
 *
 * Usage:
 *   bun run scripts/messenger/export-team-chat.ts [--in path] [--out path]
 *
 * Defaults: --in $ROX_CONFIG_DIR/team-chat.json (or ~/.rox/team-chat.json),
 *           --out stdout.
 * Never prints secrets; the local store has none.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exportTeamChatToRelay } from '../../packages/shared/src/team-chat/export-to-relay.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const configDir = process.env.ROX_CONFIG_DIR || join(homedir(), '.rox')
const inputPath = arg('--in') || join(configDir, 'team-chat.json')
const outputPath = arg('--out')

if (!existsSync(inputPath)) {
  console.error(`export-team-chat: input not found: ${inputPath}`)
  process.exit(2)
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8'))
const manifest = exportTeamChatToRelay(raw)
const json = JSON.stringify(manifest, null, 2) + '\n'

if (outputPath) {
  writeFileSync(outputPath, json)
  console.error(
    `export-team-chat: wrote ${outputPath} (channels=${manifest.stats.channelCount} messages=${manifest.stats.messageCount} serviceEvents=${manifest.stats.serviceEventCount})`,
  )
} else {
  process.stdout.write(json)
}
