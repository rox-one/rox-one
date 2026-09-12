/**
 * Incident kill switch + release evidence checklist (Issue 34).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const KILL_SWITCH_FILE = 'incident-kill-switch.json'

export interface IncidentKillSwitch {
  enabled: boolean
  reason: string
  setAt: string
}

export function killSwitchPath(configDir: string): string {
  return join(configDir, KILL_SWITCH_FILE)
}

export function readIncidentKillSwitch(configDir: string): IncidentKillSwitch {
  const path = killSwitchPath(configDir)
  if (!existsSync(path)) return { enabled: false, reason: '', setAt: '' }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IncidentKillSwitch
    if (parsed && typeof parsed.enabled === 'boolean') {
      return {
        enabled: parsed.enabled,
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
        setAt: typeof parsed.setAt === 'string' ? parsed.setAt : '',
      }
    }
  } catch {
    return { enabled: false, reason: '', setAt: '' }
  }
  return { enabled: false, reason: '', setAt: '' }
}

export function writeIncidentKillSwitch(configDir: string, next: IncidentKillSwitch): void {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(killSwitchPath(configDir), `${JSON.stringify(next, null, 2)}\n`)
}

export const RELEASE_EVIDENCE_ITEMS = [
  { id: 'tests', title: 'Automated tests' },
  { id: 'security', title: 'Cross-workspace authorization' },
  { id: 'secret-scan', title: 'Secret/log/artifact scan' },
  { id: 'credential-refs', title: 'Credential-reference enforcement' },
  { id: 'kill-switch', title: 'Incident kill switch' },
  { id: 'audit-export', title: 'Audit export' },
  { id: 'migrations', title: 'Config migrations' },
] as const

export type ReleaseEvidenceId = (typeof RELEASE_EVIDENCE_ITEMS)[number]['id']

export function releaseEvidenceIds(): ReleaseEvidenceId[] {
  return RELEASE_EVIDENCE_ITEMS.map((item) => item.id)
}
