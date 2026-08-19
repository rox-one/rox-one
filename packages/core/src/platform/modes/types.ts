/**
 * Mode registry — static application modes (ADR-0001).
 *
 * A Mode is not a Surface, Tab, or Panel. Modes do not close; they switch
 * the working context, default LayoutProfile, and context sidebar.
 */

import type { Disposable } from '../types.ts';
import type { ContextKeys } from '../context-keys/types.ts';

export interface ModeContribution {
  id: string;
  /** i18n key resolved by the renderer (`workbench.mode.*`). */
  titleKey: string;
  /** Lucide (or other) icon name; the renderer maps it to a component. */
  icon: string;
  /**
   * Route to the mode's root view. `null` means the mode is registered but
   * not yet navigable (disabled in the Mode Bar).
   */
  rootRoute: string | null;
  order: number;
  defaultPinned: boolean;
  layoutProfileId: string;
  contextPanelId?: string;
  requiredCapabilities?: string[];
  /** Context-key `when` expression; omitted = always eligible. */
  when?: string;
}

export interface ModeRegistry {
  register(contribution: ModeContribution): Disposable;
  unregister(id: string): void;
  get(id: string): ModeContribution | undefined;
  list(ctx?: ContextKeys): ModeContribution[];
  onDidChange(listener: () => void): Disposable;
}
