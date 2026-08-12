/**
 * Mode model — ADR-0001 decision 1 (Mode ≠ Surface ≠ Tab ≠ Panel).
 *
 * A Mode is a permanent work mode of the application (Home, Chat, Meetings,
 * Tasks, Knowledge, Feed, Inbox, …): it never closes, switches the app
 * context, selects a LayoutProfile and swaps the context panel contents.
 * Replaces hardcoded `APP_NAV_DESTINATIONS` so modules and extensions can
 * contribute modes without editing the shell.
 *
 * Pure TS: the renderer binds `rootRoute` to its ViewRoute union.
 */

import type { Disposable } from '../types.ts';
import type { ContextKeys } from '../context-keys/types.ts';

export interface ModeContribution {
  /** Globally unique, dotted: `core.chat`, `extension.crm`. */
  id: string;
  /** i18n key, resolved in the renderer (never a pre-translated string). */
  title: string;
  icon: string;
  /** Route opened when the mode is activated without a remembered surface. */
  rootRoute: string;
  /** Sort order in the mode bar; ties break by id. */
  order: number;
  /** Pinned in the mode bar unless the user hides it. */
  defaultPinned: boolean;
  /** LayoutProfile applied on mode switch (user overrides stay delta-only). */
  layoutProfileId: string;
  /** PanelContribution id shown in the context sidebar for this mode. */
  contextPanelId?: string;
  /** Capabilities the workspace must have for the mode to be offered. */
  requiredCapabilities?: string[];
  /** Context Keys expression; no `when` = always available. */
  when?: string;
  source: { type: 'core' | 'extension' | 'siyuan-plugin'; id: string };
}

/**
 * Store of mode contributions. Same discipline as PanelRegistry:
 * duplicate id throws, `list` is ordered and `when`-filtered.
 */
export interface ModeRegistry {
  register(contribution: ModeContribution): Disposable;
  unregister(id: string): void;
  get(id: string): ModeContribution | undefined;
  list(ctx: ContextKeys): ModeContribution[];
  onDidChange(listener: () => void): Disposable;
}
