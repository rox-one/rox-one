/**
 * Shared Dev Space display maps — literal i18n keys per status/source/phase
 * (no dynamic key construction) and the «устарело» rule from
 * 02-SPEC-foundations §5.6.
 */
import type { DevSpaceRepositoryRecord, DevSpaceRepositoryStatus, DevSpaceRunStage, DevSpaceRunStatus } from '@rox/shared/dev-space'

export const DEV_SPACE_STATUS_KEYS: Record<DevSpaceRepositoryStatus, string> = {
  unbound: 'devSpace.status.unbound',
  cloning: 'devSpace.status.cloning',
  cloned: 'devSpace.status.cloned',
  bound: 'devSpace.status.bound',
  analyzing: 'devSpace.status.analyzing',
  ready: 'devSpace.status.ready',
  stale: 'devSpace.status.stale',
  error: 'devSpace.status.error',
}

export const DEV_SPACE_SOURCE_KEYS: Record<DevSpaceRepositoryRecord['origin']['kind'], string> = {
  'git-url': 'devSpace.source.gitUrl',
  'local-folder': 'devSpace.source.localFolder',
}

export const DEV_SPACE_PHASE_KEYS: Record<string, string> = {
  cloning: 'devSpace.progress.cloning',
  indexing: 'devSpace.progress.indexing',
  finalizing: 'devSpace.progress.finalizing',
}

export const DEV_SPACE_STATUS_VARIANT: Record<DevSpaceRepositoryStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  unbound: 'secondary',
  cloning: 'secondary',
  cloned: 'outline',
  bound: 'outline',
  analyzing: 'secondary',
  ready: 'default',
  stale: 'outline',
  error: 'destructive',
}

/** A newer snapshot exists than the last analyzed one (02-SPEC-foundations §5.6). */
export function isRepositoryOutdated(record: DevSpaceRepositoryRecord): boolean {
  return Boolean(record.lastSnapshotId) && record.lastSnapshotId !== record.lastAnalyzedSnapshotId
}

/** Literal keys for the four pipeline stages (§6.1); never build keys dynamically. */
export const DEV_SPACE_STAGE_KEYS: Record<DevSpaceRunStage, string> = {
  reconcile: 'devSpace.stage.reconcile',
  structural: 'devSpace.stage.structural',
  llm: 'devSpace.stage.llm',
  publish: 'devSpace.stage.publish',
}

/** Literal keys for the run journal statuses (§6.2). */
export const DEV_SPACE_RUN_STATUS_KEYS: Record<DevSpaceRunStatus, string> = {
  queued: 'devSpace.run.status.queued',
  running: 'devSpace.run.status.running',
  succeeded: 'devSpace.run.status.succeeded',
  failed: 'devSpace.run.status.failed',
  cancelled: 'devSpace.run.status.cancelled',
  partial: 'devSpace.run.status.partial',
}