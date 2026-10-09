/**
 * Podcast generation job contract (docs/specs/2026-10-09-dev-space-and-playbooks/02-SPEC-foundations.md §5.1, D13).
 *
 * Minimal B1 surface: the push channel `podcast:job` replaces `voice:job` for the
 * podcast flow while `voice:job` stays for dictation/ASR. B4 widens this record
 * with voice/segment/srt metadata.
 */
export type PodcastJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface PodcastJob {
  readonly schemaVersion: 1
  readonly id: string
  readonly state: PodcastJobState
  /** Monotonic per job, mirroring `voice/job-machine.ts` seq semantics. */
  readonly seq: number
}