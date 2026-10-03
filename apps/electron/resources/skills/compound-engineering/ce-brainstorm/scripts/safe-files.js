import fs from "node:fs"
import path from "node:path"

// Read from the descriptor we checked, never reopen a validated pathname.
export function readContainedFile(rootDir, candidate) {
  let fd
  try {
    const root = fs.realpathSync(rootDir)
    const requested = path.resolve(candidate)
    const outside = relative => !relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)
    // The explicitly selected root may itself use a platform alias (/tmp on
    // macOS). Resolve that alias once, while refusing symlinks below the root.
    let relative = path.relative(root, requested)
    if (outside(relative)) relative = path.relative(path.resolve(rootDir), requested)
    if (outside(relative)) return null
    const lexical = path.join(root, relative)
    let component = root
    for (const part of relative.split(path.sep)) {
      component = path.join(component, part)
      if (fs.lstatSync(component).isSymbolicLink()) return null
    }
    const real = fs.realpathSync(lexical)
    if (real !== lexical || !real.startsWith(root + path.sep)) return null
    fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const stat = fs.fstatSync(fd)
    const current = fs.lstatSync(real)
    if (!stat.isFile() || !current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || fs.realpathSync(real) !== real || fs.realpathSync(rootDir) !== root) return null
    const data = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return null
    return { path: real, data, mtimeMs: stat.mtimeMs }
  } catch { return null } finally { if (fd !== undefined) fs.closeSync(fd) }
}

export function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error("Private state directory must not be a symlink")
  fs.chmodSync(directory, 0o700)
}

export function writePrivate(filePath, contents) {
  const directory = path.dirname(filePath)
  ensurePrivateDirectory(directory)
  // mkdtemp owns the temporary name; wx prevents replacing/following a file.
  const temporaryDirectory = fs.mkdtempSync(path.join(directory, ".ce-write-"))
  const temporary = path.join(temporaryDirectory, "contents")
  let fd
  try {
    fd = fs.openSync(temporary, "wx", 0o600)
    fs.writeFileSync(fd, contents)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temporary, filePath)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

export function openPrivateAppend(filePath) {
  ensurePrivateDirectory(path.dirname(filePath))
  const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600)
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Private output must be a regular file")
    fs.fchmodSync(fd, 0o600)
    return fd
  } catch (error) { fs.closeSync(fd); throw error }
}

export function appendPrivate(filePath, contents) {
  const fd = openPrivateAppend(filePath)
  try { fs.writeFileSync(fd, contents) } finally { fs.closeSync(fd) }
}
