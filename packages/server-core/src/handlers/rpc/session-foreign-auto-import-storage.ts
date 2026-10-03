import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ForeignAutoImportStatus } from '@rox/shared/sessions'

interface AutoImportFile {
  enabled?: boolean
  lastRunAt?: number | null
  status?: Partial<ForeignAutoImportStatus>
}

function autoImportPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.rox', 'foreign-auto-import.json')
}

export function readAutoImportFile(workspaceRoot: string): AutoImportFile {
  const path = autoImportPath(workspaceRoot)
  // New installations import local chats automatically. Explicit saved
  // opt-outs (and unreadable configurations) remain disabled.
  if (!existsSync(path)) return { enabled: true }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AutoImportFile
  } catch {
    return {}
  }
}

export function writeAutoImportFile(workspaceRoot: string, data: AutoImportFile): void {
  const path = autoImportPath(workspaceRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}
