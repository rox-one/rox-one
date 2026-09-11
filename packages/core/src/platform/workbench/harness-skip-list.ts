/**
 * H6 freeze: capabilities we will not install as Rox runtime.
 * Appearance shows these as "not installed". Ids are product names — not DSH jargon.
 */

export const HARNESS_SKIP_LIST = [
  { id: 'sessionBuddy', packageId: 'dsh-session-buddy' },
  { id: 'mnemon', packageId: 'dsh-mnemon' },
  { id: 'pluginHotReload', packageId: 'dsh-hot-reload' },
  { id: 'agentTeamsRuntime', packageId: '@nanmicoder/dsh-agent-teams' },
  { id: 'visionCliPlugin', packageId: '@liustack/modlens' },
  { id: 'searchCliPlugin', packageId: '@liustack/modsearch' },
  { id: 'extraAutomationRuntime', packageId: '@michengai/dsh-automation' },
  { id: 'remoteControlCompat', packageId: 'dsh-desktop-remote-control' },
] as const

export type HarnessSkipId = (typeof HARNESS_SKIP_LIST)[number]['id']

export const HARNESS_SKIP_IDS: readonly HarnessSkipId[] = HARNESS_SKIP_LIST.map((item) => item.id)
