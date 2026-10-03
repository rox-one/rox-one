// Production payload gate; Node-only so it can run before dependency installation.
const fs = require('node:fs');
const path = require('node:path');

function hasRuntimeFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true }).some(entry =>
    entry.isDirectory() ? hasRuntimeFiles(path.join(dir, entry.name)) :
      entry.isFile() && !/^(readme(?:\.md)?|\.gitkeep)$/i.test(entry.name));
}

function validateWindowsOemPayload(dir) {
  // Match the runtime resolver's alias order, so a stale ELF sibling cannot
  // shadow a valid .exe after passing the release gate.
  const name = ['knowledge-engine', 'knowledge-engine.exe', 'SiYuan-Kernel', 'SiYuan-Kernel.exe']
    .find(name => fs.existsSync(path.join(dir, name)) && fs.statSync(path.join(dir, name)).isFile());
  if (!name) throw new Error(`Windows OEM kernel executable missing in ${dir} (README-only staging is not a release payload)`);
  const file = path.join(dir, name);
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if (fs.readSync(fd, header, 0, 64, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Not a Windows PE kernel: ${file}`);
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, pe, 0, 6, header.readUInt32LE(60)) !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error(`OEM kernel is not a Windows x64 PE: ${file}`);
    }
  } finally { fs.closeSync(fd); }
  for (const asset of ['stage', 'appearance']) {
    if (!hasRuntimeFiles(path.join(dir, asset))) throw new Error(`Windows OEM kernel ${asset}/ assets missing in ${dir}`);
  }
  return file;
}

function ensureWindowsOemPayload(projectDir, { env = process.env, stage = false } = {}) {
  const dev = env.ROX_WINDOWS_DEV_WITHOUT_OEM === '1';
  if (dev) {
    if (env.CRAFT_DEV_RUNTIME !== '1') throw new Error('OEM omission requires CRAFT_DEV_RUNTIME=1 as well as ROX_WINDOWS_DEV_WITHOUT_OEM=1');
    console.warn('DEVELOPMENT BUILD: OEM kernel is explicitly optional; managed knowledge is unavailable without a real payload.');
    return { mode: 'optional-development', binary: null };
  }
  const pin = JSON.parse(fs.readFileSync(path.join(projectDir, 'resources/oem-kernel-pin.json'), 'utf8'));
  if (!pin.version || !/^[a-f0-9]{64}$/i.test(pin.sha256?.['win32-x64'] || '')) throw new Error('Windows OEM pin metadata missing/invalid');
  // Pin digests describe vendor tarballs, NOT the executable: no false binary hash claim.
  const destination = path.join(projectDir, 'resources/oem-kernel');
  if (stage && env.OEM_KERNEL_PAYLOAD_DIR) {
    const source = path.resolve(env.OEM_KERNEL_PAYLOAD_DIR, 'win32-x64');
    validateWindowsOemPayload(source);
    fs.mkdirSync(destination, { recursive: true });
    if (source !== path.resolve(destination)) {
      for (const entry of fs.readdirSync(destination)) {
        if (!['README.md', '.gitkeep'].includes(entry)) fs.rmSync(path.join(destination, entry), { recursive: true, force: true });
      }
      fs.cpSync(source, destination, { recursive: true, dereference: true, filter: file => !['README.md', '.gitkeep'].includes(path.basename(file)) });
    }
  }
  try { return { mode: 'required-production', binary: validateWindowsOemPayload(destination), version: pin.version }; }
  catch (error) {
    throw new Error(`${error.message}\nSupply the vendor's unpacked Windows payload via OEM_KERNEL_PAYLOAD_DIR/<win32-x64>, or explicitly use build-win.ps1 -DevWithoutOemKernel for a development-only build.`);
  }
}

module.exports = { ensureWindowsOemPayload, validateWindowsOemPayload };
if (require.main === module) {
  try { console.log(JSON.stringify(ensureWindowsOemPayload(path.resolve(process.argv[2]), { stage: process.argv.includes('--stage') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
