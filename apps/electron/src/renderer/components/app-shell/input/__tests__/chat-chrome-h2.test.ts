import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const inputDir = join(__dirname, '..')
const freeForm = readFileSync(join(inputDir, 'FreeFormInput.tsx'), 'utf8')
const guards = readFileSync(join(inputDir, 'input-event-guards.ts'), 'utf8')
const popover = readFileSync(join(__dirname, '..', '..', 'SessionInfoPopover.tsx'), 'utf8')
const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..')
const handler = readFileSync(
  join(repoRoot, 'packages', 'server-core', 'src', 'handlers', 'rpc', 'workspace.ts'),
  'utf8',
)
const definitions = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'actions', 'definitions.ts'),
  'utf8',
)

describe('H2 chat chrome wiring', () => {
  it('keeps mid-turn ArrowUp as cancel+recall ahead of idle history', () => {
    const recallAt = freeForm.indexOf('if (shouldRecallPromptOnArrowUp(')
    const historyAt = freeForm.indexOf('shouldNavigatePromptHistory({')
    expect(recallAt).toBeGreaterThan(0)
    expect(historyAt).toBeGreaterThan(recallAt)
    expect(guards).toContain('if (isProcessing) return false')
    expect(freeForm).toContain('handleStop()')
    expect(freeForm).toContain('featureWorkbenchHarnessChatChromeV1Atom')
  })

  it('shows session costUsd in the popover behind the chat-chrome flag', () => {
    expect(popover).toContain('formatCostUsd(session?.tokenUsage?.costUsd)')
    expect(popover).toContain("t('chat.sessionCost'")
    expect(popover).toContain('data-testid="session-cost-usd"')
  })

  it('opens the workspace via PATH editors and never spawns Terminal.app', () => {
    expect(definitions).toContain("'workspace.openInEditor'")
    expect(handler).toContain('RPC_CHANNELS.workspace.OPEN_IN_EDITOR')
    expect(handler).toContain('launchWorkspaceInEditor')
    expect(handler).not.toMatch(/open\s+-a\s+Terminal/)
    expect(handler).not.toMatch(/Terminal\.app/)
    expect(freeForm).not.toMatch(/open\s+-a\s+Terminal/)
  })
})
