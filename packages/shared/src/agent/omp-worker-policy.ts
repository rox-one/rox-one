import { OMP_TASK_TOOL_NAME } from '../utils/toolNames.ts';

/**
 * Managed OMP extension. Native factories rebind to task/eval/tan children,
 * including restricted specialists. No tool registration, thinking override,
 * or user-text prefix. Keep this source standalone: the installed profile
 * cannot import ROX code.
 *
 * Session thinking is owned by the host via `set_thinking_level` (S3-13).
 */
export const OMP_WORKER_POLICY_SOURCE = String.raw`
export default function roxWorkerPolicy(pi) {
  // Host owns thinking level and user text (S3-13). No prefix, no max force.
  pi.on('tool_call', event => {
    if (event.toolName !== '${OMP_TASK_TOOL_NAME}') return;
  });
}
`;
