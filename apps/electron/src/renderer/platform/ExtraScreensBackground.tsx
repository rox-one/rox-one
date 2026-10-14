/**
 * Boot-closure split for the extra-screens background work.
 *
 * `AppShell` used to call `useExtraScreensBackground()` directly, and AppShell is
 * itself in the boot module graph — so the whole extra-screens subsystem (radar
 * daily sweep, focus day-summary, meeting extraction, calendar autostart) sat in
 * `index.html`'s modulepreload closure. Measured on 2026-10-14 it was the largest
 * single entry there (~1.94 MB, chunk emitted as `calendar-autostart-*.js`).
 *
 * Rendering the hook through `React.lazy` moves that graph behind a dynamic edge.
 * Nothing is lost for first paint: every timer in the subsystem starts at least
 * `FIRST_CHECK_MS` (30 s) after mount, and the hooks are effect-only, so loading
 * one chunk later is unobservable.
 */
import { useExtraScreensBackground } from '@/pages/extra-screens/background'

export default function ExtraScreensBackground({ workspaceId }: { workspaceId: string | null }) {
  useExtraScreensBackground(workspaceId)
  return null
}
