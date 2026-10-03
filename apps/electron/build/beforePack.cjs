// Keep payload staging in the packaging hook so every electron-builder entrypoint gets it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { ensureWindowsOemPayload } = require('./windows-release-preflight.cjs');
const originalFileSettings = new WeakMap();

function configureWindowsFileFilters(packager) {
  const rootFilters = [];
  const otherMappings = [];
  for (const entry of [...(packager.config.files || []), ...(packager.platformSpecificBuildOptions.files || [])]) {
    if (typeof entry === 'string') rootFilters.push(entry);
    else if ((!entry.from || entry.from === '.') && (!entry.to || entry.to === '.')) rootFilters.push(...(entry.filter || []));
    else otherMappings.push(entry);
  }
  if (!rootFilters.some(filter => !filter.startsWith('!'))) throw new Error('Windows packaging requires an explicit app allowlist');
  originalFileSettings.set(packager, {
    files: packager.config.files,
    platformFiles: packager.platformSpecificBuildOptions.files,
    shouldSignFile: packager.shouldSignFile,
  });
  // Builder normalizes global `files` into FileSets but leaves win.files as
  // strings. Separate negative-only matchers prepend **/* and copy the source
  // tree. Merge them into ONE root FileSet instead, retaining custom mappings.
  packager.config.files = [...otherMappings, { filter: [...rootFilters, '!build/**/*', '!src/**/*', '!scripts/**/*'] }];
  packager.platformSpecificBuildOptions.files = [];
  const shouldSignFile = packager.shouldSignFile.bind(packager);
  // Raw exe/SFX payloads must remain byte-for-byte equal to their pinned hashes.
  packager.shouldSignFile = (file, fallbackValue) => /[\\/]windows-dependencies[\\/]/i.test(file)
    ? false : shouldSignFile(file, fallbackValue);
}

function restoreWindowsFileFilters(packager) {
  const previous = originalFileSettings.get(packager);
  if (!previous) return;
  packager.config.files = previous.files;
  packager.platformSpecificBuildOptions.files = previous.platformFiles;
  packager.shouldSignFile = previous.shouldSignFile;
  originalFileSettings.delete(packager);
}

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return;
  // electron-builder's Arch.x64 is 1. Our runtime pins currently support only Windows x64.
  if (context.arch !== 1) throw new Error('Windows dependency payload supports x64 only');
  const projectDir = context.packager.projectDir;
  const oem = ensureWindowsOemPayload(projectDir, { stage: true });
  if (oem.mode === 'optional-development') {
    context.packager.config.extraMetadata = { ...context.packager.config.extraMetadata, roxWindowsBuild: oem.mode };
    context.packager.platformSpecificBuildOptions.artifactName = 'Rox-development-${arch}.${ext}';
    // Explicit development artifacts are unsigned. Avoid rcedit's winCodeSign
    // archive, whose macOS symlinks otherwise require privileged Windows setup.
    context.packager.platformSpecificBuildOptions.signAndEditExecutable = false;
    if (context.packager.info.options.publish !== 'never') {
      throw new Error('OEM-optional development builds require --publish never');
    }
  }
  // Also prepare Bun/uv + SDK for direct electron-builder entrypoints. Pins live
  // in common.ts, not a second hand-maintained PowerShell download path.
  execFileSync(process.env.ROX_BUILD_BUN || 'bun', [
    path.resolve(projectDir, '../../scripts/build/windows-release.ts'), '--prepare-only', '--project-dir', projectDir,
  ], { cwd: projectDir, env: { ...process.env }, stdio: 'inherit', windowsHide: true });
  execFileSync(process.env.ROX_BUILD_BUN || 'bun', [
    path.resolve(projectDir, '../../scripts/stage-windows-dependencies.ts'),
    path.join(projectDir, 'build/windows-dependencies'),
  ], { cwd: projectDir, env: { ...process.env }, stdio: 'inherit', windowsHide: true });
  configureWindowsFileFilters(context.packager);
};
module.exports.configureWindowsFileFilters = configureWindowsFileFilters;
module.exports.restoreWindowsFileFilters = restoreWindowsFileFilters;
