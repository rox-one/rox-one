// Restore per-platform temporary file filters before other platforms are packed.
const { restoreWindowsFileFilters } = require('./beforePack.cjs');
const existingAfterPack = require('../scripts/afterPack.cjs');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') restoreWindowsFileFilters(context.packager);
  await existingAfterPack(context);
};
