/**
 * Device observe-only lane (S6 / d2.4). Wraps the pure provenance mapping and a
 * bounded transcript store, then persists each accepted line into the local
 * meetings store. `ownEcho` is honoured only when the probe's capture channel
 * can genuinely hear the agent (system loopback / browser captions); mic-only
 * probes leave it unset instead of claiming the agent never spoke.
 */
import type { MeetingObservationProvenance, TranscriptSource } from '@rox/core/meetings'
import { MeetingTranscriptStore, type TranscriptEviction } from '@rox/server-core/meetings'
import { buildObservationProvenance, resolveOwnEcho } from '@rox/server-core/meetings'
import type { LocalObservedLine, LocalTranscriptSegment } from '../../shared/meetings-local'

export type ObserveProbe = {
  id: string
  startMs: number
  endMs: number
  text: string
  speaker?: string | null
  source: TranscriptSource
  observer: MeetingObservationProvenance['observer']
  selfSpeaker?: string | null
  observedAt?: number
  epoch?: number
}

export type ObserveSink = {
  appendObservedSegment(meetingId: string, segment: LocalTranscriptSegment): LocalTranscriptSegment[] | null
}

export type ObserveIngestResult =
  | { ok: true; segment: LocalTranscriptSegment; line: LocalObservedLine }
  | { ok: false; code: 'not-observing' | 'empty-text' | 'duplicate' | 'session-ended' | 'meeting-not-found' }

type ActiveObserve = { sessionId: string; startedAt: number; epoch: number }

export class LocalMeetingObserver {
  private readonly active = new Map<string, ActiveObserve>()
  private readonly store = new MeetingTranscriptStore()

  constructor(
    private readonly sink: ObserveSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isObserving(meetingId: string): boolean {
    return this.active.has(meetingId)
  }

  observeStart(meetingId: string): ActiveObserve {
    const existing = this.active.get(meetingId)
    if (existing) return existing
    const started: ActiveObserve = { sessionId: `observe-${meetingId}-${this.now()}`, startedAt: this.now(), epoch: 0 }
    this.active.set(meetingId, started)
    return started
  }

  observeStop(meetingId: string): boolean {
    const existing = this.active.get(meetingId)
    if (!existing) return false
    this.store.markEnded(existing.sessionId)
    this.active.delete(meetingId)
    return true
  }

  ingest(meetingId: string, probe: ObserveProbe): ObserveIngestResult {
    const text = probe.text.trim()
    if (!text) return { ok: false, code: 'empty-text' }
    const active = this.active.get(meetingId)
    if (!active) return { ok: false, code: 'not-observing' }
    const provenance = buildObservationProvenance({
      observer: probe.observer,
      source: probe.source,
      sessionId: active.sessionId,
      observationId: probe.id,
      epoch: probe.epoch ?? active.epoch,
      observedAt: probe.observedAt ?? this.now(),
      speaker: probe.speaker ?? null,
      ...(probe.selfSpeaker != null ? { selfSpeaker: probe.selfSpeaker } : {}),
    })
    const ownEcho = resolveOwnEcho({ observer: probe.observer, source: probe.source, self: provenance.self })
    const accepted = this.store.append(active.sessionId, {
      key: probe.id,
      speaker: probe.speaker ?? null,
      text,
      at: probe.startMs,
      ...(ownEcho ? { ownEcho } : {}),
    })
    if (!accepted.accepted) return { ok: false, code: accepted.duplicate ? 'duplicate' : 'session-ended' }

    const segment: LocalTranscriptSegment = {
      id: probe.id,
      startMs: probe.startMs,
      endMs: probe.endMs,
      text,
      speakerId: probe.speaker?.trim() || null,
      source: probe.source,
      ...(ownEcho ? { ownEcho } : {}),
      provenance,
    }
    if (this.sink.appendObservedSegment(meetingId, segment) == null) return { ok: false, code: 'meeting-not-found' }
    return {
      ok: true,
      segment,
      line: {
        seq: accepted.line.seq,
        speaker: probe.speaker?.trim() ?? '',
        text,
        at: probe.startMs,
        ...(ownEcho ? { ownEcho: true } : {}),
      },
    }
  }

  lines(meetingId: string, afterSeq?: number): LocalObservedLine[] {
    const active = this.active.get(meetingId)
    if (!active) return []
    return this.store.lines(active.sessionId, afterSeq).map((line) => ({
      seq: line.seq,
      speaker: line.speaker,
      text: line.text,
      at: line.at,
      ...(line.ownEcho ? { ownEcho: true } : {}),
    }))
  }

  evictions(): TranscriptEviction[] {
    return this.store.drainEvictions()
  }
}