/**
 * Single source of truth for privileged (admin) command classification.
 *
 * Used by PreToolUse prompts and PrivilegedExecutionBroker so the allowlist
 * cannot drift. This is policy only — it does not spawn processes.
 */
import { createHash } from 'node:crypto';

export const PRIVILEGED_POLICY_REASON =
  'Privileged execution policy only allows brew cask install/upgrade and installer -pkg -target / commands';

export type PrivilegedCommandKind = 'brew-install-cask' | 'brew-upgrade-cask' | 'installer-pkg';

export interface PrivilegedCommandMatch {
  kind: PrivilegedCommandKind;
  command: string;
  /** Cask token when kind is a brew cask command. */
  appToken?: string;
}

const BREW_INSTALL_CASK = /^brew\s+install\s+--cask\s+([^\s]+).*$/;
const BREW_UPGRADE_CASK = /^brew\s+upgrade\s+--cask\s+([^\s]+).*$/;
const INSTALLER_PKG = /^installer\s+-pkg\s+.+\s+-target\s+\//;

export function hashPrivilegedCommand(command: string): string {
  return createHash('sha256').update(command, 'utf8').digest('hex');
}

export function matchPrivilegedCommand(command: string): PrivilegedCommandMatch | null {
  const trimmed = command.trim();
  const normalized = trimmed.toLowerCase();

  const brewInstall = normalized.match(BREW_INSTALL_CASK);
  if (brewInstall) {
    return {
      kind: 'brew-install-cask',
      command: trimmed,
      appToken: brewInstall[1] ?? 'application',
    };
  }

  const brewUpgrade = normalized.match(BREW_UPGRADE_CASK);
  if (brewUpgrade) {
    return {
      kind: 'brew-upgrade-cask',
      command: trimmed,
      appToken: brewUpgrade[1] ?? 'application',
    };
  }

  if (INSTALLER_PKG.test(normalized)) {
    return { kind: 'installer-pkg', command: trimmed };
  }

  return null;
}

export function isPrivilegedCommandAllowed(command: string): boolean {
  return matchPrivilegedCommand(command) !== null;
}
