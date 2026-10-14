import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ForeignAutoImportStatus } from '@rox/shared/sessions'

interface AutoImportFile {
  enabled?: boolean
  lastRunAt?: number | null
  status?: Partial<ForeignAutoImportStatus>
}

function autoImportPath(workspaceRoot: string): string {
  // W1-13 (D-v2-11): workspace-local `.rox` state stays inside the visible tree.
  return join(workspaceRoot, '.rox', 'foreign-auto-import.json')
}

export function readAutoImportFile(workspaceRoot: string): AutoImportFile {
  const path = autoImportPath(workspaceRoot)
  // New installations stay opt-in: importing local AI history reads ~/.omp,
  // ~/.claude and similar homes, so it must wait for an explicit consent file.
  if (!existsSync(path)) return { enabled: false }
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
