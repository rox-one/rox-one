/**
 * Workbench/WorkGraph flag catalog (ADR-0001 §Rollout, convergence plan §39).
 *
 * Every flag ships disabled by default; rollout order is encoded through
 * `dependencies` (e.g. `tasks.work-items.v1` cannot resolve enabled until the
 * workgraph read/write/views flags are on).
 */

import type { FeatureFlagDefinition, FeatureFlagRegistry } from './types.ts';
import { createFeatureFlagRegistry } from './registry.ts';

export const WORKBENCH_FEATURE_FLAGS = [
  // --- Workbench shell ---
  {
    id: 'workbench.mode-registry.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'Mode contributions registered through ModeRegistry instead of hardcoded APP_NAV_DESTINATIONS.',
  },
  {
    id: 'workbench.top-chrome.v2',
    defaultValue: false,
    dependencies: ['workbench.mode-registry.v1'],
    rollbackSafe: true,
    description: 'UnifiedTopChrome: merged title bar + mode bar; BrowserTabStrip removed from top chrome.',
  },
  {
    id: 'workbench.tab-groups.v2',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    migrationRequired: true,
    description: 'WorkbenchLayout v2: real TabGroups with preview/pinned tabs and splits (migrates SurfaceLayoutSnapshot v1).',
  },
  {
    id: 'workbench.browser-surface.v2',
    defaultValue: false,
    dependencies: ['workbench.tab-groups.v2'],
    rollbackSafe: true,
    description: 'Browser windows render as ordinary SurfaceTabs inside tab groups.',
  },
  {
    id: 'workbench.status-bar.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'StatusBarHost on the existing `status` PanelSlot with registered status contributions.',
  },
  {
    id: 'workbench.panel-registry.v2',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'PanelRegistry as the real host for context/inspector/bottom panels (mode-specific layout profiles).',
  },
  // --- WorkGraph ---
  {
    id: 'workgraph.read.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'Read-only WorkGraph projections of legacy objects (shadow mode).',
  },
  {
    id: 'workgraph.write.v1',
    defaultValue: false,
    dependencies: ['workgraph.read.v1'],
    rollbackSafe: false,
    description: 'Command-driven writes into the WorkGraph (transactional event log + outbox).',
  },
  {
    id: 'workgraph.views.v2',
    defaultValue: false,
    dependencies: ['workgraph.read.v1'],
    rollbackSafe: true,
    description: 'ViewDefinition v2: stored query/projection definitions (list/board/table/calendar/canvas).',
  },
  // --- Domains ---
  {
    id: 'tasks.work-items.v1',
    defaultValue: false,
    dependencies: ['workgraph.read.v1', 'workgraph.write.v1', 'workgraph.views.v2'],
    rollbackSafe: false,
    migrationRequired: true,
    description: 'User-facing tasks as WorkItems (Inbox/Today/Upcoming/Anytime/Someday), migrating task metadata off Session.',
  },
  {
    id: 'meetings.pipeline.v1',
    defaultValue: false,
    dependencies: ['workgraph.read.v1', 'workgraph.write.v1'],
    rollbackSafe: true,
    description: 'CalendarEvent/Meeting aggregates and the transcript → summary → action-item pipeline.',
  },
  {
    id: 'activity.ledger.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'Persistent ActivityEvent ledger projected from domain events.',
  },
  {
    id: 'notifications.in-app.v1',
    defaultValue: false,
    dependencies: ['activity.ledger.v1'],
    rollbackSafe: true,
    description: 'Persistent in-app Notification ledger; useNotifications becomes a delivery adapter.',
  },
  {
    id: 'presence.workspace.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'Workspace presence for humans and agents (server-authoritative, ephemeral).',
  },
  {
    id: 'usage.ledger.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'UsageLedgerEntry-based credits/costs (hosted/BYOK/local separated).',
  },
  {
    id: 'artifacts.structured.v1',
    defaultValue: false,
    dependencies: [],
    rollbackSafe: true,
    description: 'Structured Artifact AST for AI responses (collapsible blocks, stable ids, provenance).',
  },
  {
    id: 'proposals.generic.v1',
    defaultValue: false,
    dependencies: ['workgraph.write.v1'],
    rollbackSafe: true,
    description: 'Generic ChangeProposal review/apply/conflict/rollback for AI-initiated graph mutations.',
  },
] as const satisfies readonly FeatureFlagDefinition[];

export type WorkbenchFeatureFlagId = (typeof WORKBENCH_FEATURE_FLAGS)[number]['id'];

export function createWorkbenchFeatureFlagRegistry(): FeatureFlagRegistry {
  return createFeatureFlagRegistry(WORKBENCH_FEATURE_FLAGS);
}
