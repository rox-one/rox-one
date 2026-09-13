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
