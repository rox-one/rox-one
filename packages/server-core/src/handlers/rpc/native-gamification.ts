import { createHash } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from '@craft-agent/shared/utils/sqlite-runtime'
import { getDefaultGamificationState, getLevelForXp, getXpReward, recordXpDay, seedXpDays, QUEST_IDS, QUEST_XP_EVENT,
  transitionQuestAction, type AwardXpResult, type GamificationState, type QuestId, type XpEventType } from '@craft-agent/shared/gamification'
import type { NativePrincipal } from '../../authority/native-authority'

function privateDirectory(path: string): string {
  try { mkdirSync(path, { mode: 0o700 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const directory = lstatSync(path)
  if (directory.isSymbolicLink() || !directory.isDirectory() ||
    (process.getuid && directory.uid !== process.getuid())) throw new Error('Native XP custody directory is unsafe')
  chmodSync(path, 0o700)
  return realpathSync(path)
}

/** Actor metadata never shares the desktop's gamification.json or accepts a renderer actor id. */
export class NativeGamificationStore {
  readonly #db: DatabaseSync
  constructor(configDir: string) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 })
    const path = join(privateDirectory(join(realpathSync(configDir), 'native-gamification')), 'progress.sqlite')
    try { closeSync(openSync(path, 'wx', 0o600)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const file = lstatSync(path)
    if (file.isSymbolicLink() || !file.isFile() || file.nlink !== 1 ||
      (process.getuid && file.uid !== process.getuid())) throw new Error('Native XP custody file is unsafe')
    chmodSync(path, 0o600)
    this.#db = new DatabaseSync(path)
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS progress (actor_hash TEXT PRIMARY KEY, state_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS awards (actor_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL,
        PRIMARY KEY(actor_hash,receipt_hash))`)
  }

  #key(principal: NativePrincipal): string {
    return createHash('sha256').update(JSON.stringify(['native-xp-v1', principal.issuer, principal.subject])).digest('hex')
  }

  read(principal: NativePrincipal): GamificationState {
    const row = this.#db.prepare('SELECT state_json FROM progress WHERE actor_hash=?').get(this.#key(principal))
    if (!row) return getDefaultGamificationState()
    const state = JSON.parse(String(row.state_json)) as GamificationState
    // Corrupt durable data fails closed; never silently resets earned progress.
    if (state.version !== 1 || !Number.isSafeInteger(state.xp) || state.xp < 0 ||
      !state.quests || !Array.isArray(state.ratings) || QUEST_IDS.some(id => {
        const quest = state.quests[id]
        return !quest || quest.id !== id || !['available', 'completed', 'dismissed', 'snoozed', 'skipped_cloud'].includes(quest.status) ||
          (quest.completedAt !== undefined && !Number.isFinite(quest.completedAt)) ||
          (quest.snoozeUntil !== undefined && !Number.isFinite(quest.snoozeUntil))
      }) || (state.dailyXp !== undefined && (!Array.isArray(state.dailyXp) || state.dailyXp.some(item =>
        !item || !Number.isSafeInteger(item.day) || !Number.isSafeInteger(item.xp) || item.xp < 0)))) {
      throw new Error('Native XP state is invalid')
    }
    return state
  }

  #mutate<T>(principal: NativePrincipal, transition: (state: GamificationState) => { state: GamificationState; result: T }): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const next = transition(this.read(principal))
      this.#db.prepare(`INSERT INTO progress(actor_hash,state_json) VALUES(?,?)
        ON CONFLICT(actor_hash) DO UPDATE SET state_json=excluded.state_json`).run(this.#key(principal), JSON.stringify(next.state))
      this.#db.exec('COMMIT')
      return next.result
    } catch (error) { this.#db.exec('ROLLBACK'); throw error }
  }

  quest(principal: NativePrincipal, action: 'complete' | 'dismiss' | 'snooze', questId: QuestId, options: { cloudFeaturesEnabled?: boolean; now?: number }) {
    return this.#mutate(principal, current => {
      const result = transitionQuestAction(current, action, questId, options)
      return { state: result.state, result: { state: result.state, analytics: result.analytics } }
    })
  }

  consent(principal: NativePrincipal, consent: boolean): GamificationState {
    return this.#mutate(principal, current => {
      const state = { ...current, analyticsConsent: consent, updatedAt: Date.now() }
      return { state, result: state }
    })
  }

  /** Only trusted committed product hooks supply receipts; not exposed by an RPC. */
  award(principal: NativePrincipal, event: XpEventType, receiptId: string): AwardXpResult {
    if (!receiptId || receiptId.length > 4096) throw new Error('Invalid XP event receipt')
    const actor = this.#key(principal)
    const receipt = createHash('sha256').update(JSON.stringify(['native-award-v1', event, receiptId])).digest('hex')
    return this.#mutate(principal, current => {
      const previousLevel = getLevelForXp(current.xp)
      const firstQuest = QUEST_IDS.find(id => QUEST_XP_EVENT[id] === event)
      const replay = this.#db.prepare('SELECT 1 FROM awards WHERE actor_hash=? AND receipt_hash=?').get(actor, receipt)
      const oneTimeEvent = event.startsWith('first_') || event === 'privacy_review'
      const firstAlreadyEarned = oneTimeEvent && firstQuest && current.quests[firstQuest].status === 'completed'
      const awarded = replay || firstAlreadyEarned ? 0 : getXpReward(event)
      this.#db.prepare('INSERT OR IGNORE INTO awards(actor_hash,receipt_hash) VALUES(?,?)').run(actor, receipt)
      const now = Date.now(), xp = current.xp + awarded, level = getLevelForXp(xp)
      const state: GamificationState = awarded === 0 ? current : {
        ...current, xp, level, updatedAt: now,
        recentEvents: [{ type: event, xp: awarded, at: now }, ...(current.recentEvents ?? [])].slice(0, 50),
        dailyXp: recordXpDay(seedXpDays(current, now), awarded, now),
        quests: firstQuest ? { ...current.quests, [firstQuest]: { ...current.quests[firstQuest], status: 'completed', completedAt: now } } : current.quests,
      }
      return { state, result: { state, awarded, event, previousLevel, leveledUp: level > previousLevel } }
    })
  }

  close(): void { this.#db.close() }
}
