/**
 * git-npm supply-chain путь: installGitNpmPinned.
 * - апстрим bun.lock есть → checkout + HEAD pin verify + --frozen-lockfile + global из чекаута
 * - bun.lock нет → throw fail-closed (refuse unpinned transitives); never github: global
 * - git недоступен (ENOENT) → throw fail-closed; never github: global
 * - HEAD !== pin → throw (no install)
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installGitNpmPinned } from '../installer';

function makePaths(name: string) {
  const base = join(tmpdir(), `gitnpm-pinned-${name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  return { base, workDir: join(base, 'work'), versionDir: join(base, 'version') };
}

const REPO = 'garrytan/gbrain';
const COMMIT = 'a'.repeat(40);

function writeDetachedHead(cwd: string, sha: string): void {
  mkdirSync(join(cwd, '.git'), { recursive: true });
  writeFileSync(join(cwd, '.git', 'HEAD'), `${sha}\n`);
}

function collectRunCmd(impl: (args: string[], options: { cwd?: string }) => Promise<void>) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const fn = async (args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void> => {
    calls.push({ args, cwd: options?.cwd });
    await impl(args, options ?? {});
  };
  return { calls, fn };
}

describe('installGitNpmPinned', () => {
  it('uses managed git and exposes managed git/bun to checkout and install subprocesses', async () => {
    const { base, workDir, versionDir } = makePaths('managed-git');
    const git = join(base, 'managed git', 'git.exe');
    const bun = join(base, 'managed bun', 'bun.exe');
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    try {
      await installGitNpmPinned({ bun, git, versionDir, repo: REPO, commit: COMMIT, workDir,
        runCmd: async (args, opts) => {
          calls.push({ args, env: opts?.env });
          if (args.includes('checkout')) {
            writeDetachedHead(opts!.cwd!, COMMIT);
            writeFileSync(join(opts!.cwd!, 'bun.lock'), 'fake');
          }
        },
      });
      expect(calls.slice(0, 4).every((call) => call.args[0] === git)).toBe(true);
      for (const call of calls) {
        const pathKey = Object.keys(call.env!).find((key) => key.toUpperCase() === 'PATH')!;
        expect(call.env![pathKey]).toContain(dirname(git));
        expect(call.env![pathKey]).toContain(dirname(bun));
      }
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it('has upstream bun.lock → installs transitives via --frozen-lockfile, then global from checkout', async () => {
    const { base, workDir, versionDir } = makePaths('lock');
    const { calls, fn } = collectRunCmd(async (args, options) => {
      if (args.includes('checkout')) {
        writeDetachedHead(options!.cwd!, COMMIT);
        writeFileSync(join(options!.cwd!, 'bun.lock'), 'fake');
        writeFileSync(join(options!.cwd!, 'package.json'), '{}');
      }
    });
    const logs: string[] = [];
    await installGitNpmPinned({ bun: '/bun', versionDir, repo: REPO, commit: COMMIT, workDir, runCmd: fn, onLog: (m) => logs.push(m) });

    const seq = calls.map((c) => c.args.join(' '));
    expect(seq).toEqual([
      `git init -q ${workDir}`,
      `git remote add origin https://github.com/${REPO}.git`,
      `git fetch -q --depth 1 origin ${COMMIT}`,
      `git -c advice.detachedHead=false checkout -q FETCH_HEAD`,
      `/bun install --frozen-lockfile`,
      `/bun install --global ${workDir}`,
    ]);
    expect(calls[4]?.cwd).toBe(workDir);
    expect(logs).toEqual([]);
    expect(existsSync(workDir)).toBe(false); // cleanup
    rmSync(base, { recursive: true, force: true });
  });

  it('no upstream bun.lock → throw fail-closed, never github: global', async () => {
    const { base, workDir, versionDir } = makePaths('nolock');
    const { calls, fn } = collectRunCmd(async (args, options) => {
      if (args.includes('checkout')) {
        writeDetachedHead(options!.cwd!, COMMIT);
        writeFileSync(join(options!.cwd!, 'package.json'), '{}');
      }
    });
    await expect(
      installGitNpmPinned({ bun: '/bun', versionDir, repo: REPO, commit: COMMIT, workDir, runCmd: fn }),
    ).rejects.toThrow(/fail-closed.*bun\.lock/);
    expect(calls.some((c) => c.args.includes('github:') || c.args.some((a) => a.startsWith('github:')))).toBe(false);
    expect(calls.some((c) => c.args.includes('--frozen-lockfile'))).toBe(false);
    expect(existsSync(workDir)).toBe(false); // cleaned up
    rmSync(base, { recursive: true, force: true });
  });

  it('git unavailable (ENOENT) → throw fail-closed, never github: global', async () => {
    const { base, workDir, versionDir } = makePaths('nogit');
    const { calls, fn } = collectRunCmd(async (args) => {
      if (args[0] === 'git') throw new Error('spawn git ENOENT');
    });
    await expect(
      installGitNpmPinned({ bun: '/bun', versionDir, repo: REPO, commit: COMMIT, workDir, runCmd: fn }),
    ).rejects.toThrow(/fail-closed.*git unavailable/);
    expect(calls.some((c) => c.args.includes('github:') || c.args.some((a) => a.startsWith('github:')))).toBe(false);
    expect(calls.some((c) => c.args[0] === '/bun')).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });

  it('HEAD !== pinned commit → throws (no install)', async () => {
    const { base, workDir, versionDir } = makePaths('badhead');
    const { calls, fn } = collectRunCmd(async (args, options) => {
      if (args.includes('checkout')) {
        writeDetachedHead(options!.cwd!, 'b'.repeat(40));
        writeFileSync(join(options!.cwd!, 'bun.lock'), 'fake');
      }
    });
    await expect(
      installGitNpmPinned({ bun: '/bun', versionDir, repo: REPO, commit: COMMIT, workDir, runCmd: fn }),
    ).rejects.toThrow(/ref mismatch/);
    expect(calls.some((c) => c.args.includes('--frozen-lockfile'))).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });
});
