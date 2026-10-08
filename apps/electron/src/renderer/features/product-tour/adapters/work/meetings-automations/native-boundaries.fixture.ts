import type { AppShellContextType } from '@/context/AppShellContext'
import type * as PersonalTaskBridge from '@/lib/extra-screens/personal-task-bridge'

interface NativeFixtureHost {
  workspaceId: string
  mutations: string[]
}

declare global { interface Window { fixture: NativeFixtureHost } }

// Only the shell fields consumed by the real MeetingsPage/AutomationEditor.
// The source types make renamed callbacks and return values fail type checking.
type NativeShellContext = Pick<AppShellContextType,
  'activeWorkspaceId' | 'onToggleAutomation' | 'onDeleteAutomation' | 'getAutomationHistory'>
const context: NativeShellContext = {
  get activeWorkspaceId() { return window.fixture.workspaceId },
  onToggleAutomation: () => { window.fixture.mutations.push('toggle') },
  onDeleteAutomation: () => { window.fixture.mutations.push('delete') },
  getAutomationHistory: async () => [],
}
export const useOptionalAppShellContext = (): NativeShellContext => context
export const useAppShellContext = (): NativeShellContext => context

function unexpectedTaskConversion(): never {
  window.fixture.mutations.push('task')
  throw new Error('Task conversion is outside this read-only native tour fixture')
}

// Keep the production hook mounted. A conversion has no synthetic task/receipt.
export const createPersonalTask: typeof PersonalTaskBridge.createPersonalTask = unexpectedTaskConversion
export const createPersonalTaskConfirmed: typeof PersonalTaskBridge.createPersonalTaskConfirmed = async () => unexpectedTaskConversion()
