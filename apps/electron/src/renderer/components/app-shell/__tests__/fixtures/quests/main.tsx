import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { QuestProgressCard } from '../../../QuestProgressCard'
import { QUEST_IDS, QUEST_SNOOZE_MS, QUEST_XP_EVENT, XP_EVENT_REWARDS, defaultQuestRecords, getLevelProgress, getWeeklyXp, recordXpDay, visibleQuests } from '@craft-agent/shared/gamification/client'
import type { QuestId, QuestRecord } from '@craft-agent/shared/gamification/client'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

/* eslint-disable craft-agent/no-localstorage -- Synthetic backend state persists across fixture reloads; production quests use RPC custody. */

const query = new URLSearchParams(location.search)
const key = `quest-fixture-${query.get('case') ?? 'default'}`
const base = () => ({ xp: 135, quests: defaultQuestRecords(), dailyXp: [{ day: Math.floor(Date.now() / 86400000), xp: 30 }, { day: Math.floor(Date.now() / 86400000) - 8, xp: 15 }] })
let state: ReturnType<typeof base> = JSON.parse(localStorage.getItem(key) ?? 'null') ?? base()
if (query.get('complete') === 'true') for (const id of QUEST_IDS) state.quests[id] = { id, status: 'completed', completedAt: Date.now() }
const calls: Array<{ method: string; args?: unknown }> = []
let scope = 'A', failedLoad = false, failedAction = false, deferredLoad = false
let resolveLoad: (() => void) | undefined, resolveAction: (() => void) | undefined
const profile = () => {
  const current = scope === 'B' ? { xp: 0, quests: defaultQuestRecords(), dailyXp: [] } : state
  return { ...getLevelProgress(current.xp), xp: current.xp, balance: null, quests: visibleQuests(current.quests), questRecords: QUEST_IDS.map(id => current.quests[id]), ratings: [], analyticsConsent: false, weeklyXp: getWeeklyXp(current) }
}
const api = {
  async getGamificationProfile() {
    calls.push({ method: 'get' })
    if (query.get('loadFail') === 'true' && !failedLoad) { failedLoad = true; throw Error('Synthetic load failure') }
    if (query.get('deferredLoad') === 'true' && !deferredLoad) { deferredLoad = true; return new Promise(resolve => { resolveLoad = () => resolve({ ...profile(), xp: 999 }) }) }
    return profile()
  },
  onGamificationChanged: () => () => {},
  async applyGamificationQuest(args: { action: 'complete' | 'snooze' | 'dismiss'; questId: QuestId }) {
    calls.push({ method: 'act', args })
    if (query.get('actionFail') === 'true' && !failedAction) { failedAction = true; throw Error('Synthetic action failure') }
    const apply = () => {
      const quest = state.quests[args.questId]
      if (quest.status !== 'completed' && quest.status !== 'dismissed') {
        const next: QuestRecord = { id: args.questId, status: args.action === 'complete' ? 'completed' : args.action === 'snooze' ? 'snoozed' : 'dismissed' }
        if (args.action === 'complete') { const xp = XP_EVENT_REWARDS[QUEST_XP_EVENT[args.questId]]; state.xp += xp; state.dailyXp = recordXpDay(state.dailyXp, xp, Date.now()); next.completedAt = Date.now() }
        if (args.action === 'snooze') next.snoozeUntil = Date.now() + QUEST_SNOOZE_MS
        state.quests[args.questId] = next
      }
      localStorage.setItem(key, JSON.stringify(state)); return { analytics: { sent: false, localOnly: true } }
    }
    if (query.get('deferredAction') === 'true') return new Promise(resolve => { resolveAction = () => resolve(apply()) })
    return apply()
  },
}
window.electronAPI = api as unknown as typeof window.electronAPI
const fixture = { calls, resolveLoad: () => resolveLoad?.(), resolveAction: () => resolveAction?.(), switchScope: (_next: string) => {}, unmount: () => {} }
;(window as any).__questFixture = fixture
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
function App() {
  const [scopeKey, setScopeKey] = useState('A'), [visible, setVisible] = useState(true)
  fixture.switchScope = next => { scope = next; setScopeKey(next) }
  fixture.unmount = () => setVisible(false)
  return <main className="mx-auto w-full max-w-5xl p-4 md:p-8">{visible && <QuestProgressCard scopeKey={scopeKey} />}</main>
}
createRoot(document.getElementById('root')!).render(<App />)
