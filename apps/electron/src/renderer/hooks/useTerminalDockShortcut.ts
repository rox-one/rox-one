import { useSetAtom } from 'jotai'
import { useAction } from '@/actions/useAction'
import { bottomTerminalOpenAtom } from '@/atoms/unified-shell'

/** #11: ⌘J toggles the bottom terminal dock (real pty via InspectorTerminal). Mount once in the shell. */
export function useTerminalDockShortcut(): void {
  const setOpen = useSetAtom(bottomTerminalOpenAtom)
  useAction('view.toggleTerminal', () => setOpen((open) => !open))
}
