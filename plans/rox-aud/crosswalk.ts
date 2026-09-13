/**
 * ROX-AUD ↔ ROX2 crosswalk (issue #342 / ROX-AUD-000).
 *
 * Same numeric suffix is never the same card. Do not import the remaining
 * 200 audit cards as a second competing backlog.
 */

export const CROSSWALK_RELATIONS = [
  'equivalent',
  'extends',
  'supersedes',
  'independent',
  'unmatched',
] as const

export type CrosswalkRelation = (typeof CROSSWALK_RELATIONS)[number]

export type SameSuffixRow = {
  audId: string
  rox2Id: string
  relation: Exclude<CrosswalkRelation, 'equivalent'>
  reason: string
}

export type AuditIssueRow = {
  issue: number
  audId: string
  title: string
  sameSuffixRox2: string
  relation: Exclude<CrosswalkRelation, 'equivalent'>
  reason: string
}

const SAME_SUFFIX_REASON =
  'Same numeric suffix is not the same card. ROX-AUD and ROX2 are independent registries.'

export const AUDIT_ISSUE_ROWS: readonly AuditIssueRow[] = [
  {
    issue: 342,
    audId: 'ROX-AUD-000',
    title: 'Parent audit execution vs plans/rox2',
    sameSuffixRox2: 'ROX2-000',
    relation: 'extends',
    reason: 'Continues #315 program envelope. Does not close or replace the 200 ROX2 cards.',
  },
  {
    issue: 320,
    audId: 'ROX-AUD-001',
    title: 'Stable EntityId and external bindings',
    sameSuffixRox2: 'ROX2-001',
    relation: 'independent',
    reason: 'ROX2-001 is the program charter, not EntityId work.',
  },
  {
    issue: 321,
    audId: 'ROX-AUD-002',
    title: 'Typed entity ontology',
    sameSuffixRox2: 'ROX2-002',
    relation: 'independent',
    reason: 'ROX2-002 is screen inventory, not ontology.',
  },
  {
    issue: 335,
    audId: 'ROX-AUD-003',
    title: 'Session membership in multiple projects',
    sameSuffixRox2: 'ROX2-003',
    relation: 'independent',
    reason: 'ROX2-003 is service inventory.',
  },
  {
    issue: 336,
    audId: 'ROX-AUD-004',
    title: 'Relation dictionary with domain rules',
    sameSuffixRox2: 'ROX2-004',
    relation: 'independent',
    reason: 'ROX2-004 is evidence-class lint, not relations.',
  },
  {
    issue: 322,
    audId: 'ROX-AUD-011',
    title: 'SessionApply HTTP failure must not return ok:true',
    sameSuffixRox2: 'ROX2-011',
    relation: 'independent',
    reason: 'ROX2-011 is owner assignment, not SessionApply.',
  },
  {
    issue: 333,
    audId: 'ROX-AUD-012',
    title: 'Versioned Conation API catalog',
    sameSuffixRox2: 'ROX2-012',
    relation: 'independent',
    reason: 'ROX2-012 is agent card-picking instructions, not Conation API.',
  },
  {
    issue: 323,
    audId: 'ROX-AUD-014',
    title: 'Conation NotesBridge search past first page',
    sameSuffixRox2: 'ROX2-014',
    relation: 'independent',
    reason: 'ROX2-014 is native-vs-iframe rule, not NotesBridge pagination.',
  },
  {
    issue: 324,
    audId: 'ROX-AUD-016',
    title: 'Unified Notes repository',
    sameSuffixRox2: 'ROX2-016',
    relation: 'independent',
    reason: 'ROX2-016 is transport owner freeze.',
  },
  {
    issue: 334,
    audId: 'ROX-AUD-031',
    title: 'Native notes engine without SiYuan',
    sameSuffixRox2: 'ROX2-031',
    relation: 'independent',
    reason: 'ROX2-031 is Settings hub, not the notes engine.',
  },
  {
    issue: 325,
    audId: 'ROX-AUD-052',
    title: 'Canvas runner real execution',
    sameSuffixRox2: 'ROX2-052',
    relation: 'independent',
    reason: 'ROX2-052 is a settings page card, not the canvas runner.',
  },
  {
    issue: 337,
    audId: 'ROX-AUD-054',
    title: 'Map → Outcomes → Reduce over a selection',
    sameSuffixRox2: 'ROX2-054',
    relation: 'independent',
    reason: 'ROX2-054 is Settings accounts chrome, not map-reduce.',
  },
  {
    issue: 338,
    audId: 'ROX-AUD-061',
    title: 'Shared ContextProvider for the session pane',
    sameSuffixRox2: 'ROX2-061',
    relation: 'independent',
    reason: 'ROX2-061 is a settings page card, not ContextProvider.',
  },
  {
    issue: 326,
    audId: 'ROX-AUD-071',
    title: 'Retry queue enqueue during tick',
    sameSuffixRox2: 'ROX2-071',
    relation: 'independent',
    reason: 'ROX2-071 is a settings page card, not retry queue.',
  },
  {
    issue: 327,
    audId: 'ROX-AUD-072',
    title: 'RetryScheduler.dispose cancels bootstrap timer',
    sameSuffixRox2: 'ROX2-072',
    relation: 'independent',
    reason: 'ROX2-072 is a settings page card, not RetryScheduler.',
  },
  {
    issue: 328,
    audId: 'ROX-AUD-091',
    title: 'Calendar factory must not create fixture adapters',
    sameSuffixRox2: 'ROX2-091',
    relation: 'independent',
    reason: 'ROX2-091 is a native-surface card, not calendar factory.',
  },
  {
    issue: 329,
    audId: 'ROX-AUD-092',
    title: 'Calendar event ids namespaced by account',
    sameSuffixRox2: 'ROX2-092',
    relation: 'independent',
    reason: 'ROX2-092 is a native-surface card, not calendar ids.',
  },
  {
    issue: 330,
    audId: 'ROX-AUD-093',
    title: 'CalendarStore stable IDs, conflicts, revoke',
    sameSuffixRox2: 'ROX2-093',
    relation: 'independent',
    reason: 'ROX2-093 is a native-surface card, not CalendarStore.',
  },
  {
    issue: 339,
    audId: 'ROX-AUD-094',
    title: 'TemporalOccurrence shared calendar model',
    sameSuffixRox2: 'ROX2-094',
    relation: 'independent',
    reason: 'ROX2-094 is a native-surface card, not TemporalOccurrence.',
  },
  {
    issue: 332,
    audId: 'ROX-AUD-101',
    title: 'Tasks canonical store outside localStorage',
    sameSuffixRox2: 'ROX2-101',
    relation: 'independent',
    reason: 'ROX2-101 is a Conation gap row, not tasks storage.',
  },
  {
    issue: 331,
    audId: 'ROX-AUD-141',
    title: 'Voice must not treat fixture transcription as live',
    sameSuffixRox2: 'ROX2-141',
    relation: 'independent',
    reason: 'ROX2-141 is an RPC wrapper card, not voice.',
  },
  {
    issue: 340,
    audId: 'ROX-AUD-151',
    title: 'Onboarding first useful result',
    sameSuffixRox2: 'ROX2-151',
    relation: 'independent',
    reason: 'ROX2-151 is RPC fabric.ts result wrapping, not onboarding.',
  },
  {
    issue: 341,
    audId: 'ROX-AUD-181',
    title: 'Visible Rox rebrand without breaking IDs',
    sameSuffixRox2: 'ROX2-181',
    relation: 'independent',
    reason: 'ROX2-181 is an RPC wrapper card, not UI brand.',
  },
]

export function paddedSuffix(index: number): string {
  return String(index).padStart(3, '0')
}

export function buildSameSuffixCrosswalk(): SameSuffixRow[] {
  const rows: SameSuffixRow[] = [
    {
      audId: 'ROX-AUD-000',
      rox2Id: 'ROX2-000',
      relation: 'extends',
      reason: 'Parent audit execution extends the ROX2 program envelope from #315. Not equivalent.',
    },
  ]
  for (let index = 1; index <= 200; index += 1) {
    const suffix = paddedSuffix(index)
    rows.push({
      audId: `ROX-AUD-${suffix}`,
      rox2Id: `ROX2-${suffix}`,
      relation: 'independent',
      reason: SAME_SUFFIX_REASON,
    })
  }
  return rows
}

export function relateSameSuffix(audId: string, rox2Id: string): CrosswalkRelation {
  const row = buildSameSuffixCrosswalk().find((entry) => entry.audId === audId && entry.rox2Id === rox2Id)
  return row?.relation ?? 'unmatched'
}
