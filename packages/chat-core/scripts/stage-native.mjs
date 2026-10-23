import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const native = resolve(pkg, '../../native')
const candidates = [
  'target/release/librox_chat_core.dylib',
  'target/release/librox_chat_core.so',
  'target/release/rox_chat_core.dll',
  'target/release/rox-chat-core.node',
]
const src = candidates.map((c) => join(native, c)).find((p) => existsSync(p))
if (!src) {
  console.warn('rox-chat-core native addon not found — skipping stage')
  process.exit(0)
}
mkdirSync(pkg, { recursive: true })
const dest = join(pkg, 'rox-chat-core.node')
copyFileSync(src, dest)
console.log(`staged ${src} -> ${dest}`)
