/** Application-owned skill identities and optional links for external agents. */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readlinkSync, realpathSync, readdirSync, unlinkSync, symlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function isSafeSkillName(value: string): boolean {
  return value.length <= 200 && /^[a-z0-9_][a-z0-9._-]*$/i.test(value);
}

export function pathEntryExists(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

export function isSkillLinkTo(link: string, target: string): boolean {
  try {
    if (!lstatSync(link).isSymbolicLink()) return false;
    const linkedTarget = readlinkSync(link);
    const normalizedTarget = process.platform === 'win32' && linkedTarget.startsWith('\\\\?\\') ? linkedTarget.slice(4) : linkedTarget;
    return resolve(link, '..', normalizedTarget) === resolve(target);
  } catch { return false; }
}

export function isInsideSkillStore(path: string, root: string): boolean {
  try {
    const rel = relative(realpathSync(root), realpathSync(path));
    return rel !== '' && rel !== '..' && !rel.startsWith(`../`) && !rel.startsWith(`..\\`) && !isAbsolute(rel);
  } catch { return false; }
}

/** A deterministic alternative keeps every foreign directory intact. */
export function chooseManagedSkillName(pack: string, skill: string, available: (name: string) => boolean, previous?: string): string {
  if (!isSafeSkillName(pack) || !isSafeSkillName(skill)) throw new Error('Invalid managed skill name');
  if (previous && isSafeSkillName(previous) && available(previous)) return previous;
  const qualified = `${pack}--${skill}`;
  const bounded = qualified.length <= 200 ? qualified : `${qualified.slice(0, 180)}-${createHash('sha256').update(qualified).digest('hex').slice(0, 12)}`;
  for (const name of [skill, bounded]) if (available(name)) return name;
  const suffix = createHash('sha256').update(`${pack}\0${skill}`).digest('hex').slice(0, 12);
  for (let n = 0; n < 1000; n++) {
    const name = `${bounded.slice(0, 170)}-${suffix}${n ? `-${n + 1}` : ''}`;
    if (available(name)) return name;
  }
  throw new Error('No available managed skill identity');
}

/** Never replace a real directory or somebody else's link, including dangling links. */
export function linkManagedSkill(target: string, linksRoot: string, name: string): string | null {
  if (!isSafeSkillName(name)) return null;
  try {
    mkdirSync(linksRoot, { recursive: true });
    const previous = readdirSync(linksRoot).sort().find(candidate => isSafeSkillName(candidate) && isSkillLinkTo(join(linksRoot, candidate), target));
    const linkName = chooseManagedSkillName('rox', name, (candidate) => {
      const link = join(linksRoot, candidate);
      return !pathEntryExists(link) || isSkillLinkTo(link, target);
    }, previous);
    const link = join(linksRoot, linkName);
    if (!pathEntryExists(link)) symlinkSync(resolve(target), link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const candidate of readdirSync(linksRoot)) {
      if (candidate !== linkName && isSafeSkillName(candidate) && isSkillLinkTo(join(linksRoot, candidate), target)) unlinkSync(join(linksRoot, candidate));
    }
    return link;
  } catch { return null; } // The app reads its own store even when links are unsupported.
}

/** Works after target deletion too; the link itself proves the exact target. */
export function unlinkManagedSkill(target: string, linksRoot: string): void {
  try {
    for (const name of readdirSync(linksRoot)) {
      if (!isSafeSkillName(name)) continue;
      const link = join(linksRoot, name);
      if (isSkillLinkTo(link, target)) unlinkSync(link);
    }
  } catch { /* External links are optional. */ }
}
