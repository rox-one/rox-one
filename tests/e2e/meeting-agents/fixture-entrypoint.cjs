/**
 * TEST-ONLY Electron main. Not a production entrypoint.
 * productionFixtureGuard must reject this when NODE_ENV=production.
 *
 * Boots a real Electron process with isolated userData, persists a JSON
 * store under ROX_CONFIG_DIR, and talks only to the loopback fixture gateway.
 * Does not mock React, RPC, or the product Task store.
 */
const { app, BrowserWindow, session } = require('electron')
const {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
  writeSync,
} = require('fs')
const { isAbsolute, join, relative, resolve, sep } = require('path')

const userData = process.env.ROX_USER_DATA_DIR || process.env.CRAFT_USER_DATA_DIR
const configDir = process.env.ROX_CONFIG_DIR || process.env.CRAFT_CONFIG_DIR
const readyFile = process.env.HARNESS_READY_FILE
const storeFile = process.env.HARNESS_STORE_FILE
const caseId = process.env.HARNESS_CASE_ID || ''
const gatewayOrigin = process.env.ROX_MEETING_FIXTURE_ORIGIN || ''
const gatewayToken = process.env.ROX_MEETING_FIXTURE_TOKEN || ''

if (!userData || !configDir || !readyFile || !storeFile) {
  console.error('fixture-entrypoint missing isolated profile env')
  app.exit(2)
}

app.setPath('userData', userData)

function resolveInside(root, candidate, label) {
  if (!root || !candidate) {
    throw new Error(`${label}: missing path`)
  }
  if (!isAbsolute(root) || !isAbsolute(candidate)) {
    throw new Error(`${label}: path must be absolute`)
  }
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  const rel = relative(resolvedRoot, resolvedCandidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label}: path escapes isolated root`)
  }
  return resolvedCandidate
}

function persistStore() {
  let bounded
  try {
    bounded = resolveInside(configDir, storeFile, 'HARNESS_STORE_FILE')
  } catch (err) {
    console.error('fixture store fail-closed', err instanceof Error ? err.message : err)
    app.exit(2)
    throw err
  }

  mkdirSync(join(bounded, '..'), { recursive: true })
  let bootCount = 1
  const nofollow = constants.O_NOFOLLOW ?? 0
  // Open first (O_NOFOLLOW). Never existsSync/lstat then write — CodeQL js/file-system-race.
  let readFd
  try {
    readFd = openSync(bounded, constants.O_RDONLY | nofollow)
    try {
      const st = fstatSync(readFd)
      if (!st.isFile()) {
        const notFile = new Error('store-not-file')
        notFile.code = 'ENOTFILE'
        throw notFile
      }
      const size = Math.min(st.size, 65536)
      const buf = Buffer.alloc(size)
      const n = readSync(readFd, buf, 0, size, 0)
      const prev = JSON.parse(buf.subarray(0, n).toString('utf8'))
      if (prev && typeof prev.bootCount === 'number') bootCount = prev.bootCount + 1
    } finally {
      closeSync(readFd)
    }
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT' || err instanceof SyntaxError) {
      bootCount = 1
    } else {
      console.error('fixture store fail-closed', code || (err instanceof Error ? err.message : err))
      app.exit(2)
      throw err
    }
  }

  const payload = JSON.stringify({ caseId, bootCount, writtenAt: new Date().toISOString() })
  try {
    const writeFd = openSync(
      bounded,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | nofollow,
      0o600,
    )
    try {
      writeSync(writeFd, payload, 'utf8')
    } finally {
      closeSync(writeFd)
    }
  } catch (err) {
    console.error('fixture store write fail-closed', err && err.code)
    app.exit(2)
    throw err
  }
  return bootCount
}

function isLoopback(urlString) {
  try {
    const u = new URL(urlString)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch {
    return false
  }
}

async function recordForbidden() {
  if (!gatewayOrigin || !gatewayToken) return
  try {
    await fetch(`${gatewayOrigin}/forbidden`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${gatewayToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
  } catch {
    // gateway may already be down during dispose
  }
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isLoopback(details.url) || details.url.startsWith('data:') || details.url.startsWith('file:')) {
      callback({ cancel: false })
      return
    }
    void recordForbidden()
    callback({ cancel: true })
  })

  const bootCount = persistStore()

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  })
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<!doctype html><html><body data-harness="meeting-agents" data-case="${caseId}">fixture</body></html>`,
      ),
  )

  if (gatewayOrigin && gatewayToken) {
    const health = await fetch(`${gatewayOrigin}/health`, {
      headers: { authorization: `Bearer ${gatewayToken}` },
    })
    if (!health.ok) {
      console.error('fixture gateway health failed', health.status)
      app.exit(3)
      return
    }
  }

  mkdirSync(join(readyFile, '..'), { recursive: true })
  writeFileSync(
    readyFile,
    JSON.stringify({
      pid: process.pid,
      caseId,
      bootCount,
      ok: true,
      entrypoint: 'test-fixture',
    }),
    'utf8',
  )
  console.log('HARNESS_READY', process.pid)
})
