/**
 * Persist environment questionnaire answers to `~/.craft-agent/environment.json`.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { resolveConfigDir } from '../config/paths.ts'
import { finishQuestionnaire } from './versioning.ts'
import {
  getDefaultEnvironmentPrefs,
  isAgentRuleLabel,
  isBrowserImportCategory,
  isModelPlacement,
  isSttChoice,
  isSyncPurpose,
  isTtsChoice,
  unanswered,
  type AgentRule,
  type BrowserImportCategory,
  type Choice,
  type ChoiceStatus,
  type EnvironmentPrefs,
  type ModelPlacement,
  type SttChoice,
  type SyncPurpose,
  type TtsChoice,
} from './types.ts'

export const ENVIRONMENT_PREFS_FILE = 'environment.json'

export function getEnvironmentPrefsPath(configDir: string = resolveConfigDir()): string {
  return join(configDir, ENVIRONMENT_PREFS_FILE)
}

function isChoiceStatus(value: unknown): value is ChoiceStatus {
  return value === 'unanswered' || value === 'skipped' || value === 'answered'
}

function readChoice<T>(
  raw: unknown,
  isValue: (value: unknown) => value is T,
): Choice<T> {
  if (!raw || typeof raw !== 'object') return unanswered()
  const obj = raw as Record<string, unknown>
  const status = isChoiceStatus(obj.status) ? obj.status : 'unanswered'
  const value = isValue(obj.value) ? obj.value : null
  if (status === 'answered' && value === null) return unanswered()
  return { status, value }
}

function readStringListChoice<T extends string>(
  raw: unknown,
  isValue: (value: unknown) => value is T,
): Choice<T[]> {
  if (!raw || typeof raw !== 'object') return unanswered()
  const obj = raw as Record<string, unknown>
  const status = isChoiceStatus(obj.status) ? obj.status : 'unanswered'
  const value = Array.isArray(obj.value) ? obj.value.filter(isValue) : null
  if (status === 'answered' && (!value || value.length === 0) && obj.value !== null) {
    return { status: 'answered', value: [] }
  }
  return { status, value }
}

function readAgentRules(raw: unknown): AgentRule[] {
  if (!Array.isArray(raw)) return []
  const rules: AgentRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : null
    const text = typeof obj.text === 'string' ? obj.text.trim() : ''
    const label = isAgentRuleLabel(obj.label) ? obj.label : 'custom'
    if (!id || !text) continue
    rules.push({ id, text, label })
  }
  return rules
}

export function normalizeEnvironmentPrefs(raw: unknown, now: number = Date.now()): EnvironmentPrefs {
  const base = getDefaultEnvironmentPrefs(now)
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const seenVersion =
    typeof obj.seenVersion === 'number' && Number.isFinite(obj.seenVersion) && obj.seenVersion >= 0
      ? Math.floor(obj.seenVersion)
      : 0
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : now
  return {
    version: 1,
    seenVersion,
    modelPlacement: readChoice<ModelPlacement>(obj.modelPlacement, isModelPlacement),
    sttEngine: readChoice<SttChoice>(obj.sttEngine, isSttChoice),
    ttsEngine: readChoice<TtsChoice>(obj.ttsEngine, isTtsChoice),
    wakeWord: readChoice<boolean>(obj.wakeWord, (value): value is boolean => typeof value === 'boolean'),
    browserImport: readStringListChoice<BrowserImportCategory>(obj.browserImport, isBrowserImportCategory),
    syncPurposes: readStringListChoice<SyncPurpose>(obj.syncPurposes, isSyncPurpose),
    notifications: readChoice<boolean>(
      obj.notifications,
      (value): value is boolean => typeof value === 'boolean',
    ),
    agentRules: readAgentRules(obj.agentRules),
    updatedAt,
  }
}

export function loadEnvironmentPrefs(configDir: string = resolveConfigDir()): EnvironmentPrefs {
  try {
    const path = getEnvironmentPrefsPath(configDir)
    if (!existsSync(path)) return getDefaultEnvironmentPrefs()
    return normalizeEnvironmentPrefs(readJsonFileSync<unknown>(path))
  } catch {
    return getDefaultEnvironmentPrefs()
  }
}

export function saveEnvironmentPrefs(
  patch: Partial<EnvironmentPrefs> & { completeQuestionnaire?: boolean },
  configDir: string = resolveConfigDir(),
  now: number = Date.now(),
): EnvironmentPrefs {
  const current = loadEnvironmentPrefs(configDir)
  const merged: EnvironmentPrefs = {
    ...current,
    ...('modelPlacement' in patch && patch.modelPlacement ? { modelPlacement: patch.modelPlacement } : {}),
    ...('sttEngine' in patch && patch.sttEngine ? { sttEngine: patch.sttEngine } : {}),
    ...('ttsEngine' in patch && patch.ttsEngine ? { ttsEngine: patch.ttsEngine } : {}),
    ...('wakeWord' in patch && patch.wakeWord ? { wakeWord: patch.wakeWord } : {}),
    ...('browserImport' in patch && patch.browserImport ? { browserImport: patch.browserImport } : {}),
    ...('syncPurposes' in patch && patch.syncPurposes ? { syncPurposes: patch.syncPurposes } : {}),
    ...('notifications' in patch && patch.notifications ? { notifications: patch.notifications } : {}),
    ...('agentRules' in patch && patch.agentRules ? { agentRules: patch.agentRules } : {}),
    updatedAt: now,
  }
  const next = patch.completeQuestionnaire ? finishQuestionnaire(merged, undefined, now) : merged
  const path = getEnvironmentPrefsPath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(next, null, 2))
  return next
}
