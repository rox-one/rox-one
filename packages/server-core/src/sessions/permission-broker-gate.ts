/**
 * Privileged-exec broker only binds admin_approval requests that have a
 * command hash (real privileged bash). OMP host-tool and extension_ui
 * prompts reuse type `admin_approval` without a command — gating those
 * through the broker fail-closes a user Allow ("No pending privileged
 * request found") and the live ask-mode turn cannot run host/MCP tools.
 */
export function shouldBrokerGatePermission(meta?: {
  type?: string
  commandHash?: string
} | null): boolean {
  return meta?.type === 'admin_approval' && Boolean(meta.commandHash)
}
