/**
 * W1-07 (#1504) — workbench flags that gate shell actions.
 */
import { WORKBENCH_FLAG } from '@rox/core/platform'

export const W1_07_ACTION_FLAG = {
  /**
   * STUB(#1512): W1-15 registers `agent.panel.v1` in `flags.ts`. Until then the
   * id is unregistered, never resolves as enabled, and ⌘J / ⌘⇧J stay unbound.
   */
  agentPanel: 'agent.panel.v1',
  messenger: WORKBENCH_FLAG.modeMessengerV1,
  docsShared: WORKBENCH_FLAG.docsSharedV1,
} as const
