/**
 * Minimal placeholder Conation inspector host.
 * No Timeline mode, no domain bridges — host + flags only.
 */
import { CONATION_INSPECTOR_PLACEHOLDER } from './conation-inspector-model'

export function ConationInspectorPanel() {
  return (
    <aside
      className="w-[320px] shrink-0 overflow-y-auto border-l border-border/60 bg-muted/[0.12] p-3"
      data-testid="conation-inspector-placeholder"
      aria-label="Conation"
    >
      <p className="text-sm text-muted-foreground">{CONATION_INSPECTOR_PLACEHOLDER}</p>
    </aside>
  )
}
