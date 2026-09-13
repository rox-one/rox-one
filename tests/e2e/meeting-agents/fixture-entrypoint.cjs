/**
 * TEST-ONLY Electron main. Not a production entrypoint.
 * productionFixtureGuard must reject this when NODE_ENV=production.
 *
 * Boots a real Electron process with isolated userData, persists a JSON
 * store under ROX_CONFIG_DIR, and talks only to the loopback fixture gateway.
 * Does not mock React, RPC, or the product Task store.
 */
const { app, BrowserWindow, session } = require('electron')
const { writeFileSync, mkdirSync, readFileSync, existsSync } = require('fs')
const { join } = require('path')

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

function persistStore() {
  mkdirSync(join(storeFile, '..'), { recursive: true })
  let bootCount = 1
  if (existsSync(storeFile)) {
    try {
      const prev = JSON.parse(readFileSync(storeFile, 'utf8'))
      if (prev && typeof prev.bootCount === 'number') bootCount = prev.bootCount + 1
    } catch {
      bootCount = 1
    }
  }
  writeFileSync(
    storeFile,
    JSON.stringify({ caseId, bootCount, writtenAt: new Date().toISOString() }),
    'utf8',
  )
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
