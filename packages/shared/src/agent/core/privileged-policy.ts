/**
 * Single source of truth for privileged (admin) command classification.
 *
 * Used by PreToolUse prompts and PrivilegedExecutionBroker so the allowlist
 * cannot drift. This is policy only — it does not spawn processes.
 *
 * Matching is token-based (no backtracking regexes) so untrusted Bash input
 * cannot trip ReDoS.
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

function whitespaceTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const ch of command.trim()) {
    const code = ch.charCodeAt(0);
    const isSpace = code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0b || code === 0x0c;
    if (isSpace) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function hashPrivilegedCommand(command: string): string {
  return createHash('sha256').update(command, 'utf8').digest('hex');
}

export function matchPrivilegedCommand(command: string): PrivilegedCommandMatch | null {
  const trimmed = command.trim();
  const tokens = whitespaceTokens(trimmed.toLowerCase());

  if (tokens.length >= 4 && tokens[0] === 'brew' && tokens[2] === '--cask') {
    const appToken = tokens[3];
    if (!appToken) return null;
    if (tokens[1] === 'install') {
      return { kind: 'brew-install-cask', command: trimmed, appToken };
    }
    if (tokens[1] === 'upgrade') {
      return { kind: 'brew-upgrade-cask', command: trimmed, appToken };
    }
  }

  if (tokens[0] === 'installer' && tokens[1] === '-pkg') {
    const targetIdx = tokens.indexOf('-target', 2);
    // Require a pkg path token between -pkg and -target, and a / target.
    const target = tokens[targetIdx + 1];
    if (targetIdx >= 3 && target !== undefined && target.startsWith('/')) {
      return { kind: 'installer-pkg', command: trimmed };
    }
  }

  return null;
}

export function isPrivilegedCommandAllowed(command: string): boolean {
  return matchPrivilegedCommand(command) !== null;
}
