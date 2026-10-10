/**
 * W1-07 (#1504) — workbench flags that gate shell actions.
 */
import { WORKBENCH_FLAG } from '@rox/core/platform'

export const W1_07_ACTION_FLAG = {
  /**
   * A6/A7 (decision 010-ui-agent-task-controls.md): the `agent.panel.v1` agent
   * actions were removed — the panel is not mounted (W1-15 registers the flag
   * and the `right-dock.ts` layout, but no agent column renders), so the ⌘J /
   * ⌘⇧J registrations were dead. The flag id lives on in
   * `packages/core/src/platform/workbench/flags.ts`.
   */
  messenger: WORKBENCH_FLAG.modeMessengerV1,
  docsShared: WORKBENCH_FLAG.docsSharedV1,
} as const
