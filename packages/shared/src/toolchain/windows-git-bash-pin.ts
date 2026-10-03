/** Full portable Git for Windows, separate from the managed MinGit manifest.
 * Vendor release checksum and GitHub asset size, verified 2026-10-03:
 * https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3
 */
export const WINDOWS_GIT_BASH_PIN = {
  name: 'git-bash',
  version: '2.55.0.3',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/PortableGit-2.55.0.3-64-bit.7z.exe',
  sha256: 'ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d',
  size: 58919776,
  archive: '7z-sfx',
  payload: 'git-bash-2.55.0.3.7z.exe',
  binPaths: ['bin/bash.exe', 'usr/bin/bash.exe', 'usr/bin/msys-2.0.dll', 'cmd/git.exe'],
} as const;
