/**
 * Rox History page. W0 lazy-imports this default export from the route + panel
 * dispatch; it takes no props and renders the panel inside the app shell's page
 * chrome (full-height, shell background/tone like the sibling mode screens).
 */
import { ClipboardHistoryPanel } from '@/components/clipboard-history/ClipboardHistoryPanel'

export default function ClipboardHistoryPage() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background font-sans text-body text-foreground"
      data-testid="clipboard-history-page"
    >
      <ClipboardHistoryPanel />
    </div>
  )
}