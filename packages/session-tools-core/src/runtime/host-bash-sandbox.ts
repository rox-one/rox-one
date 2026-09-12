import { applyFilesystemIsolation, type FilesystemIsolationPlan } from './filesystem-isolation.ts';
import { applyNetworkIsolation, type NetworkIsolationPlan } from './network-isolation.ts';

/**
 * Optional FS+net jail for host-tool Bash (issue 111 / rox/host-bash-sandbox).
 *
 * Defaults to off. Enable with CRAFT_FEATURE_HOST_BASH_SANDBOX=1.
 * When on, local spawn is wrapped with the same backends as script_sandbox
 * (macOS sandbox-exec, Linux bwrap/unshare/firejail). Fail-closed if no
 * backend is available — do not fall back to an unsandboxed shell.
 */
export function isHostBashSandboxEnabled(): boolean {
  const value = process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export interface HostBashSandboxPlan {
  status: 'enforced' | 'unavailable';
  command: string;
  args: string[];
  filesystem: FilesystemIsolationPlan;
  network: NetworkIsolationPlan;
}

/**
 * Compose FS+net isolation around a host-tool Bash argv.
 * Jail writes to `jailRoot` (workspace root). Same darwin single-profile
 * composition as script_sandbox to avoid nested sandbox-exec.
 */
export function planHostBashSandbox(
  command: string,
  args: string[],
  jailRoot: string,
): HostBashSandboxPlan {
  let network: NetworkIsolationPlan;
  let filesystem: FilesystemIsolationPlan;

  if (process.platform === 'darwin') {
    filesystem = applyFilesystemIsolation(command, args, jailRoot, {
      includeNetworkDeny: true,
    });
    network = {
      status: filesystem.status,
      backend: filesystem.status === 'enforced' ? 'sandbox-exec' : 'none',
      command,
      args,
    };
  } else {
    network = applyNetworkIsolation(command, args);
    filesystem = applyFilesystemIsolation(
      network.status === 'enforced' ? network.command : command,
      network.status === 'enforced' ? network.args : args,
      jailRoot,
    );
  }

  const enforced = network.status === 'enforced' && filesystem.status === 'enforced';
  return {
    status: enforced ? 'enforced' : 'unavailable',
    command: filesystem.command,
    args: filesystem.args,
    filesystem,
    network,
  };
}
