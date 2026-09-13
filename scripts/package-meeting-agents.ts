#!/usr/bin/env bun
/**
 * Stage eight builtin meeting-agent role manifests into Electron resources.
 * Does not codesign. macOS/Windows packaged smoke stays blocked.
 *
 * Usage: bun run scripts/package-meeting-agents.ts [destDir]
 */

import { join } from 'node:path'
import { stageMeetingAgentResources } from '../packages/server-core/src/meetings/packaging.ts'

const dest = process.argv[2] ?? join(import.meta.dir, '../apps/electron/resources/meeting-agents')
const os = (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux')
  ? process.platform
  : 'linux'

const result = stageMeetingAgentResources(dest, {
  os,
  codesign: false,
  osVerified: process.env.ROX_PACKAGING_OS_VERIFIED === '1',
})

console.log(JSON.stringify({
  dest,
  ...result,
  note: 'unsigned resource stage only; packaged OS remains blocked unless verified',
}, null, 2))
