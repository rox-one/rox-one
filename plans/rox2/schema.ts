export const ROX2_EVIDENCE = [
  'reproduced',
  'statically-confirmed',
  'documented',
  'needs-verification',
  'new-requirement',
] as const

export type Rox2Evidence = (typeof ROX2_EVIDENCE)[number]

export const ROX2_DOMAINS = [
  'audit',
  'contract',
  'screen',
  'service',
  'conation',
  'notes',
  'calendar',
  'context',
  'memory',
  'collab',
  'permission',
  'identity',
  'rpc',
  'wave',
] as const

export type Rox2Domain = (typeof ROX2_DOMAINS)[number]

export type Rox2Card = {
  id: string
  title: string
  wave: number
  domain: Rox2Domain
  asIs: string
  toBe: string
  files: string[]
  contracts: string[]
  plan: string[]
  tests: string
  acceptance: string[]
  dependencies: string[]
  rollback: string
  evidence: Rox2Evidence
  status: 'open'
}

export type Rox2ScreenRecord = {
  id: string
  title: string
  files: string[]
  evidence: Rox2Evidence
  coverage: string
}

export type Rox2ServiceRecord = {
  id: string
  title: string
  files: string[]
  evidence: Rox2Evidence
  coverage: string
}

export type Rox2GapRow = {
  id: string
  asIs: string
  toBe: string
  files: string[]
  integration: 'deep-link' | 'read-client' | 'flag-off' | 'native' | 'none'
  evidence: Rox2Evidence
}
