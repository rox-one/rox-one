import { CAPABILITY_TOOLS, getCapabilityTool, type CapabilityPackId } from './packs.ts'

/** Generate Rox AGENTS.md capability heuristics from installed pack tools. */
export function generateAgentsMdHeuristics(installedIds: readonly string[]): string {
  const lines = [
    '# Rox capability heuristics',
    '',
    'Activate the smallest installed tool that matches the task. Request permissions only when the tool says so. High-risk tools stay off until the user enables them.',
    '',
  ]
  const installed = installedIds
    .map((id) => getCapabilityTool(id))
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => a.packId.localeCompare(b.packId) || a.id.localeCompare(b.id))

  if (installed.length === 0) {
    lines.push('No capability packs are installed. Work with built-in session tools only.')
    return `${lines.join('\n')}\n`
  }

  let currentPack: CapabilityPackId | undefined
  for (const tool of installed) {
    if (tool.packId !== currentPack) {
      currentPack = tool.packId
      lines.push(`## ${currentPack}`)
      lines.push('')
    }
    lines.push(`### ${tool.title}`)
    lines.push(`- When to activate: ${tool.whenToActivate}`)
    lines.push(`- Expected output: ${tool.expectedOutput}`)
    lines.push(`- Permission: ${tool.permission}`)
    lines.push(`- Unusual use: ${tool.unusualUse}`)
    if (tool.highRisk) lines.push('- High-risk: do not auto-enable.')
    lines.push('')
  }
  return lines.join('\n')
}

export function buildOfflineCapabilityReport(opts: {
  installedIds: readonly string[]
  online: boolean
  generatedAt?: number
}): string {
  const at = opts.generatedAt ?? 0
  const lines = [
    '# Rox capability report',
    `online: ${opts.online ? 'yes' : 'no'}`,
    `generatedAt: ${at}`,
    '',
  ]
  const installed = new Set(opts.installedIds)
  for (const tool of CAPABILITY_TOOLS) {
    const state = installed.has(tool.id) ? 'installed' : 'available'
    const risk = tool.highRisk ? 'high-risk' : 'normal'
    lines.push(`${tool.packId}/${tool.id} ${tool.version} ${state} ${risk} ${tool.checksum}`)
  }
  return `${lines.join('\n')}\n`
}
