/**
 * Append-only meeting journal: CAS, command dedupe, corrupt-tail quarantine (issue #357).
 * Single logical writer per directory. Notes/Tasks remain their own repositories.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseMeetingCommand, type MeetingCommand } from '@craft-agent/core/meetings'

export class MeetingRevisionConflict extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Meeting CAS failed: expected ${expectedRevision}, actual ${actualRevision}`)
    this.name = 'MeetingRevisionConflict'
  }
}

export type MeetingJournalEvent = {
  seq: number
  commandId: string
  type: string
  at: number
  payload: Record<string, unknown>
  entityId?: string
}

export type MeetingQuarantine = {
  reason: 'corrupt-tail' | 'unknown-schema-version' | 'checksum'
  sha256: string
  raw: string
}

export type MeetingJournalSnapshot = {
  revision: number
  events: MeetingJournalEvent[]
  commandIds: string[]
  quarantined: MeetingQuarantine[]
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class MeetingJournal {
  private events: MeetingJournalEvent[] = []
  private commandIds = new Set<string>()
  private quarantined: MeetingQuarantine[] = []
  private revision = 0
  private loaded = false

  constructor(
    private readonly dir: string,
    readonly workspaceId: string,
  ) {}

  private eventsPath(): string {
    return join(this.dir, 'events.jsonl')
  }

  state(): MeetingJournalSnapshot {
    return {
      revision: this.revision,
      events: this.events.map((event) => structuredClone(event)),
      commandIds: [...this.commandIds],
      quarantined: this.quarantined.map((item) => structuredClone(item)),
    }
  }

  async load(): Promise<MeetingJournalSnapshot> {
    await mkdir(this.dir, { recursive: true })
    this.events = []
    this.commandIds = new Set()
    this.quarantined = []
    this.revision = 0
    let raw = ''
    try {
      raw = await readFile(this.eventsPath(), 'utf8')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code !== 'ENOENT') throw error
      this.loaded = true
      return this.state()
    }
    const lines = raw.split('\n')
    const kept: string[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as MeetingJournalEvent
        if (typeof parsed.seq !== 'number' || typeof parsed.commandId !== 'string' || typeof parsed.type !== 'string') {
          throw new Error('invalid event')
        }
        this.events.push(parsed)
        this.commandIds.add(parsed.commandId)
        this.revision = parsed.seq
        kept.push(line)
      } catch {
        const tail = lines.slice(index).join('\n')
        this.quarantined.push({ reason: 'corrupt-tail', sha256: sha256(tail), raw: tail })
        const backup = join(this.dir, `events.corrupt-${Date.now()}.jsonl`)
        await writeFile(backup, tail)
        await writeFile(this.eventsPath(), kept.length ? `${kept.join('\n')}\n` : '')
        break
      }
    }
    this.loaded = true
    return this.state()
  }

  async append(
    command: MeetingCommand,
    payload: Record<string, unknown>,
    entityId: string,
  ): Promise<MeetingJournalSnapshot> {
    if (!this.loaded) await this.load()
    const parsed = parseMeetingCommand(command)
    if (parsed.workspaceId !== this.workspaceId) {
      throw new Error('Meeting command workspace does not match journal')
    }
    if (this.commandIds.has(parsed.commandId)) {
      return this.state()
    }
    if (parsed.expectedRevision !== this.revision) {
      throw new MeetingRevisionConflict(parsed.expectedRevision, this.revision)
    }
    const event: MeetingJournalEvent = {
      seq: this.revision + 1,
      commandId: parsed.commandId,
      type: parsed.type,
      at: Date.now(),
      payload,
      entityId,
    }
    const line = `${JSON.stringify(event)}\n`
    let existing = ''
    try {
      existing = await readFile(this.eventsPath(), 'utf8')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
      if (code !== 'ENOENT') throw error
    }
    const temp = `${this.eventsPath()}.tmp`
    await writeFile(temp, `${existing}${line}`)
    await rename(temp, this.eventsPath())
    this.events.push(event)
    this.commandIds.add(parsed.commandId)
    this.revision = event.seq
    return this.state()
  }

  async snapshot(): Promise<{ sha256: string; revision: number }> {
    if (!this.loaded) await this.load()
    const body = JSON.stringify(this.state())
    const path = join(this.dir, 'snapshot.json')
    const temp = `${path}.tmp`
    await writeFile(temp, body)
    await rename(temp, path)
    return { sha256: sha256(body), revision: this.revision }
  }
}
