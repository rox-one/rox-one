/**
 * M1-B1 — Lima runtime-asset bundling contract.
 *
 * Lima resolves its runtime assets (guest agent + templates) as
 * <dirname(dir-of-limactl)>/share/lima — `pkg/usrlocal.ShareLima()` and
 * `pkg/templatestore` both search that tree. The app ships limactl at
 * Contents/Resources/bin/darwin-<arch>/limactl (`mac.binaries`), so the assets
 * must land at Contents/Resources/bin/share/lima. These assertions pin the
 * cross-file contract: the electron-builder mapping, the files-glob negatives,
 * and the helpers downloadLima() stages with.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limaRuntimeAssets } from '../build/common';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const yml = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf8');

describe('Lima runtime assets bundling (M1-B1)', () => {
  it('stages share/lima into the bundle exactly where Lima resolves it', () => {
    const exe = yml.match(/-\s+(Contents\/Resources\/bin\/darwin-(?:arm64|x64)\/limactl)\s*$/m);
    expect(exe).not.toBeNull();
    const limaPrefix = posix.dirname(posix.dirname(exe![1]!));
    const runtimeCandidate = posix.join(limaPrefix, 'share', 'lima');

    const mapping = yml.match(/- from:\s+resources\/bin\/share\s*\n\s+to:\s+(\S+)/);
    expect(mapping).not.toBeNull();
    // `to:` maps the share dir itself, which carries `lima/` inside it.
    expect(posix.join('Contents/Resources', mapping![1]!, 'lima')).toBe(runtimeCandidate);
  });

  it('prevents the share tree from being copied twice via files globs', () => {
    expect(yml).toContain('"!resources/bin/share/**"');
    expect(yml).toContain('"!dist/resources/bin/share/**"');
  });

  it('names the vendored guest agent and staging dir per host arch', () => {
    expect(limaRuntimeAssets('/repo/apps/electron', 'arm64')).toEqual({
      dir: '/repo/apps/electron/resources/bin/share/lima',
      guestAgent: 'lima-guestagent.Linux-aarch64.gz',
    });
    expect(limaRuntimeAssets('/repo/apps/electron', 'x64').guestAgent).toBe('lima-guestagent.Linux-x86_64.gz');
  });
});
