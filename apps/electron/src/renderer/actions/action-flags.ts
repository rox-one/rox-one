/**
 * W1-07 (#1504) — workbench flags that gate shell actions.
 */
import { WORKBENCH_FLAG } from '@rox/core/platform'

export const W1_07_ACTION_FLAG = {
  /**
   * W1-15 (#1512) registers `agent.panel.v1` (`packages/core/src/platform/workbench/flags.ts:99`,
   * mirrored at `packages/shared/src/feature-flags.ts:427`), so the id resolves like every other
   * workbench flag. The ⌘J / ⌘⇧J actions stay inert for a different reason: nothing subscribes to
   * `agent.togglePanel` / `agent.askAboutSelection` yet (only `actions/definitions.ts` names them).
   */
  agentPanel: 'agent.panel.v1',
  messenger: WORKBENCH_FLAG.modeMessengerV1,
  docsShared: WORKBENCH_FLAG.docsSharedV1,
} as const
