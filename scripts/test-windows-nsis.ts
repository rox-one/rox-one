/** Compile-only validation. Never executes an installer. Optional compiler download stays in TempRoot. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const tempRoot = value('--temp-root');
if (process.platform !== 'win32' || !tempRoot || !existsSync(tempRoot)) {
  throw new Error('Usage (Windows): bun scripts/test-windows-nsis.ts --temp-root <existing-temp-dir> [--nsis-dir <compiler-dir> | --download]');
}
const work = mkdtempSync(join(resolve(tempRoot), 'rox-nsis-check-'));
try {
  let compilerDir = value('--nsis-dir');
  if (!compilerDir) {
    if (!args.includes('--download')) throw new Error('Supply --nsis-dir or explicitly opt in to --download');
    // Same compiler and digest pinned by electron-builder 26.0.12 nsisUtil.ts.
    const url = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z';
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Compiler download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = 'VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==';
    if (createHash('sha512').update(bytes).digest('base64') !== digest) throw new Error('NSIS compiler SHA512 mismatch');
    const archive = join(work, 'nsis.7z');
    writeFileSync(archive, bytes);
    compilerDir = join(work, 'nsis');
    mkdirSync(compilerDir);
    execFileSync('tar.exe', ['-xf', archive, '-C', compilerDir], { stdio: 'inherit' });
  }
  compilerDir = resolve(compilerDir);
  const include = resolve(import.meta.dir, '../apps/electron/build/windows/installer.nsh');
  for (const uninstaller of [false, true]) {
    const script = join(work, uninstaller ? 'uninstaller.nsi' : 'installer.nsi');
    // Reproduce builder header ordering: flags/custom include, then pages/languages.
    writeFileSync(script, `Unicode true
Name "Rox bootstrap compile test"
OutFile "${join(work, uninstaller ? 'uninstall-check.exe' : 'install-check.exe')}"
RequestExecutionLevel user
!include LogicLib.nsh
Var isUpdated
Var hasPerMachineInstallation
!define isUpdated '$isUpdated == "1"'
!define isForAllUsers '$isUpdated == "2"'
!macro setInstallModePerUser
StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\Rox"
!macroend
${uninstaller ? '!define BUILD_UNINSTALLER' : ''}
!include "${include}"
${uninstaller ? '' : '!insertmacro customPageAfterChangeDir'}
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"
Function .onInit
StrCpy $isUpdated "0"
StrCpy $hasPerMachineInstallation "0"
${uninstaller ? '' : '!insertmacro customInit'}
FunctionEnd
Section
${uninstaller ? '' : '!insertmacro customInstall'}
SectionEnd
`);
    execFileSync(join(compilerDir, 'Bin/makensis.exe'), ['-WX', '-INPUTCHARSET', 'UTF8', script], {
      env: { ...process.env, NSISDIR: compilerDir }, stdio: 'inherit', windowsHide: true,
    });
  }
  console.log('PASS: NSIS installer and uninstaller includes compile with warnings as errors; neither EXE executed');
} finally { rmSync(work, { recursive: true, force: true }); }
