import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadVoicePrefs, normalizeVoicePrefs, saveVoicePrefs } from '../storage'

test('explicit current-schema local delivery persists while legacy modes remain draft and grant no cloud consent', () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-private-delivery-'))
  try {
    expect(normalizeVoicePrefs({ version: 2, delivery: 'clipboard', cloudAsrConsent: true }).delivery).toBe('draft')
    const current = normalizeVoicePrefs({ version: 3, delivery: 'clipboard', cloudAsrConsent: false, cloudEnhancementConsent: false, webEnrichmentConsent: false })
    expect(current.delivery).toBe('clipboard');
    expect(normalizeVoicePrefs({ version: 3, pttModifier: 'ControlRight' }).pttModifier).toBe('ControlRight')
    expect(normalizeVoicePrefs({ version: 3, pttModifier: 'none' }).pttModifier).toBe('none')
    expect(normalizeVoicePrefs({ version: 2, pttModifier: 'ControlRight' }).pttModifier).toBe('AltRight'); expect(current.cloudAsrConsent).toBe(false)
    expect(current.cloudEnhancementConsent).toBe(false); expect(current.webEnrichmentConsent).toBe(false)
    saveVoicePrefs(current, root)
    expect(loadVoicePrefs(root).delivery).toBe('clipboard')
    expect(normalizeVoicePrefs({ version: 3, delivery: 'external' }).delivery).toBe('draft')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
