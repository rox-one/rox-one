import { VOICE_ENDPOINTS, voiceUrl } from './contracts.ts'
import {
  isFixtureOnlyEvidence,
  resolveVoiceGatewayMode,
  voiceGatewayBaseUrl,
  type VoiceEnv,
  type VoiceGatewayMode,
} from './runtime.ts'

export type EvidenceClass = 'cloud-beta' | 'enhancement-beta' | 'local-model-beta' | 'full-epic' | 'scaffold'

export interface EvidenceInput {
  liveCloudAsr: boolean
  liveEnhancement: boolean
  localWhisperReady: boolean
  localNemotronReady: boolean
  localGigaamReady: boolean
  overlayWithoutFocusSteal: boolean
  historyDurable: boolean
  fixtureOnly: boolean
}

export interface GatewayProbe {
  reachable: boolean
  status: number | null
  reason: string
}

export interface EvidenceReport {
  class: EvidenceClass
  reasons: string[]
  gatewayMode: VoiceGatewayMode
  fixtureOnly: boolean
  gatewayReachable: boolean
  liveClaimed: boolean
}

export function classifyEvidence(input: EvidenceInput): { class: EvidenceClass; reasons: string[] } {
  if (input.fixtureOnly) {
    return { class: 'scaffold', reasons: ['Fixtures are not production ASR evidence'] }
  }
  const reasons: string[] = []
  if (!input.liveCloudAsr) reasons.push('Cloud ASR has not been proven against staging audio')
  if (!input.overlayWithoutFocusSteal) reasons.push('Overlay focus policy is unproven on this OS')
  if (!input.historyDurable) reasons.push('History durability is unproven')
  if (input.liveCloudAsr && !input.liveEnhancement && !input.localWhisperReady) {
    return { class: 'cloud-beta', reasons: reasons.length ? reasons : ['Cloud ASR path is live; enhancement and local models remain gated'] }
  }
  if (input.liveCloudAsr && input.liveEnhancement && !input.localWhisperReady) {
    return { class: 'enhancement-beta', reasons: ['Local model artifacts are not ready'] }
  }
  if (input.localWhisperReady && !input.localNemotronReady) {
    return { class: 'local-model-beta', reasons: ['Nemotron/GigaAM artifacts are not ready'] }
  }
  if (input.liveCloudAsr && input.liveEnhancement && input.localWhisperReady && input.localNemotronReady && input.localGigaamReady) {
    return { class: 'full-epic', reasons: [] }
  }
  return { class: reasons.length ? 'scaffold' : 'cloud-beta', reasons }
}

export function collectEvidenceInput(
  env: VoiceEnv = process.env,
  extras: Partial<Omit<EvidenceInput, 'fixtureOnly'>> & { fixtureOnly?: boolean } = {},
): EvidenceInput {
  const fixtureOnly = extras.fixtureOnly ?? isFixtureOnlyEvidence(env)
  const liveAllowed = !fixtureOnly
  return {
    fixtureOnly,
    liveCloudAsr: liveAllowed && extras.liveCloudAsr === true,
    liveEnhancement: liveAllowed && extras.liveEnhancement === true,
    localWhisperReady: extras.localWhisperReady === true,
    localNemotronReady: extras.localNemotronReady === true,
    localGigaamReady: extras.localGigaamReady === true,
    overlayWithoutFocusSteal: extras.overlayWithoutFocusSteal === true,
    historyDurable: extras.historyDurable === true,
  }
}

export async function probeVoiceGateway(options: {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  baseUrl?: string
  timeoutMs?: number
} = {}): Promise<GatewayProbe> {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? voiceGatewayBaseUrl()
  const timeoutMs = options.timeoutMs ?? 1500
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(voiceUrl(VOICE_ENDPOINTS.capabilities, baseUrl), {
      method: 'GET',
      signal: controller.signal,
    })
    if (response.ok) return { reachable: true, status: response.status, reason: 'ok' }
    return { reachable: false, status: response.status, reason: `http ${response.status}` }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const aborted = name === 'AbortError' || name === 'TimeoutError'
    return { reachable: false, status: null, reason: aborted ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

export async function reportEvidence(options: {
  env?: VoiceEnv
  probe?: GatewayProbe | 'skip'
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  localWhisperReady?: boolean
  localNemotronReady?: boolean
  localGigaamReady?: boolean
  overlayWithoutFocusSteal?: boolean
  historyDurable?: boolean
  liveEnhancement?: boolean
} = {}): Promise<EvidenceReport> {
  const env = options.env ?? process.env
  const gatewayMode = resolveVoiceGatewayMode(env)
  const fixtureOnly = isFixtureOnlyEvidence(env)
  let probe: GatewayProbe | null = options.probe === 'skip' || options.probe === undefined ? null : options.probe
  if (!probe && options.probe !== 'skip' && !fixtureOnly && gatewayMode === 'live') {
    probe = await probeVoiceGateway({ fetchImpl: options.fetchImpl, baseUrl: voiceGatewayBaseUrl(env) })
  }
  const classified = classifyEvidence(collectEvidenceInput(env, {
    liveCloudAsr: probe?.reachable === true,
    liveEnhancement: options.liveEnhancement,
    localWhisperReady: options.localWhisperReady,
    localNemotronReady: options.localNemotronReady,
    localGigaamReady: options.localGigaamReady,
    overlayWithoutFocusSteal: options.overlayWithoutFocusSteal,
    historyDurable: options.historyDurable,
  }))
  const reasons = probe && !probe.reachable
    ? [...classified.reasons, `Voice gateway is unreachable (${probe.reason})`]
    : classified.reasons
  return {
    class: classified.class,
    reasons,
    gatewayMode,
    fixtureOnly,
    gatewayReachable: probe?.reachable === true,
    liveClaimed: probe?.reachable === true,
  }
}
