/** Install the probe's pinned native graph with the production checksum and lock. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { MANIFEST_DATA } from '../../packages/shared/src/toolchain/manifest-data'
import { getNpmLock } from '../../packages/shared/src/toolchain/npm-locks'

const destination = resolve(process.argv[2] ?? (() => { throw new Error('Supply an isolated probe directory') })())
const pin = MANIFEST_DATA.omp!
const artifact = pin.artifacts['linux-x64']!
const lock = getNpmLock('omp', pin.version)
if (!lock || pin.version !== '18.4.12') throw new Error('Missing pinned native runtime graph')
await mkdir(destination, { recursive: true })
const response = await fetch(artifact.url)
if (!response.ok) throw new Error(`Native package download failed: ${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Native package integrity mismatch')
const archive = join(destination, 'omp.tgz')
await writeFile(archive, bytes)
const unpack = Bun.spawn(['tar', '--no-same-owner', '-xzf', archive, '-C', destination], { stdout: 'inherit', stderr: 'inherit' })
if (await unpack.exited !== 0) throw new Error('Native package extraction failed')
const packageDir = join(destination, 'package')
const packagePath = join(packageDir, 'package.json')
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
if (pkg.version !== pin.version) throw new Error('Unpacked runtime version mismatch')
delete pkg.devDependencies
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const [name, version] of Object.entries(pkg[field] ?? {})) if (String(version).startsWith('workspace:')) delete pkg[field][name]
}
await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n')
await writeFile(join(packageDir, 'package-lock.json'), lock)
const install = Bun.spawn(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: packageDir, stdout: 'inherit', stderr: 'inherit' })
if (await install.exited !== 0) throw new Error('Pinned native dependency installation failed')
console.log(`Prepared OMP ${pin.version}: ${packageDir}`)
