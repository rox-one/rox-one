/**
 * Rox home display path for docs and prompts (W1-13).
 *
 * Kept in its own module so both `docs/index.ts` and `docs/doc-links.ts` can
 * use the same helper without a circular import.
 */

import { homedir } from 'os';
import { sep } from 'path';
import { CONFIG_DIR } from '../config/paths.ts';
import { isVisibleRoxHomeActive } from '../config/env.ts';

/**
 * Placeholder in bundled docs (apps/electron/resources/docs/*.md) for the Rox
 * home as shown to agents and users (W1-13). Rendered when the docs are
 * written to {configDir}/docs, so the text always matches the real tree.
 */
export const ROX_HOME_DOC_PLACEHOLDER = '{{ROX_HOME}}';

/** Flag-OFF display text — the legacy hidden home, exactly as before W1-13. */
const LEGACY_ROX_HOME_DISPLAY = '~/.rox';

/**
 * How docs refer to the Rox home. With `storage.visible-root.v1` OFF this is
 * always the legacy `~/.rox` text (unchanged docs). With the flag ON it is
 * the resolved config dir, `~`-abbreviated under the home dir — `~/rox`
 * after migration, or the legacy dir while the migration is deferred.
 */
export function roxHomeDocDisplay(
  configDir: string = CONFIG_DIR,
  options?: { homeDir?: string; visibleRootActive?: boolean },
): string {
  const visibleRootActive = options?.visibleRootActive ?? isVisibleRoxHomeActive();
  if (!visibleRootActive) return LEGACY_ROX_HOME_DISPLAY;
  const home = options?.homeDir ?? homedir();
  if (configDir === home) return '~';
  if (configDir.startsWith(home + sep)) {
    return `~/${configDir.slice(home.length + 1).split(sep).join('/')}`;
  }
  return configDir;
}

/** Replace every `{{ROX_HOME}}` in a bundled doc with the display path. */
export function renderBundledDoc(content: string, roxHome: string = roxHomeDocDisplay()): string {
  return content.split(ROX_HOME_DOC_PLACEHOLDER).join(roxHome);
}