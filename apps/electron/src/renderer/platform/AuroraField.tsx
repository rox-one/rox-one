/**
 * Aurora field (G2 «Сияние» pilot) — the ambient luminous backdrop layer.
 *
 * Mounted once in AppShell's main return, before TopBar. Renders a single
 * fixed, pointer-transparent `<div class="aurora-field">` whose static gradient
 * stack is defined in `@rox/ui/styles/tokens/aurora.css`; when the flag is OFF
 * it renders nothing, so the shipped shell stays byte-identical.
 *
 * The element never animates at idle. Degradation to a flat canvas (high
 * contrast, scenic, zen, the low-power render profile, reduced transparency,
 * higher contrast) is owned entirely by the CSS layer — a flag left ON still
 * paints nothing in those modes.
 */
import { useAtomValue } from 'jotai'
import { featureAuroraFieldAtom } from '@/atoms/unified-shell'

export function AuroraField() {
  const enabled = useAtomValue(featureAuroraFieldAtom)
  if (!enabled) return null
  return <div className="aurora-field" aria-hidden />
}