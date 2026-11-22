import { expect, test } from '@playwright/test'

const SANDBOX = {
  id: 'sbx_test',
  object: 'sandbox',
  provider: 'daytona',
  state: 'running',
  display_name: 'Тестовая машина',
  created_at: '2026-11-22T09:00:00.000Z',
  expires_at: '2099-11-22T10:00:00.000Z',
  cost_so_far_cents: 3,
  routing_reason: null,
  spec: {
    os: 'linux',
    cpu: 2,
    memoryGb: 4,
    diskGb: 8,
    snapshot: 'rox-cloud-medium-2x4',
    image: null,
    gpu: null,
    region: 'us',
    ttlSec: 1800,
  },
  region: 'us',
  billing: {
    mode: 'managed',
    rate_cents_per_hour: 36,
    retail_cents_per_hour: 36,
    service_fee_cents_per_hour: 5,
  },
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

test('the machine workbench keeps the terminal, files and preview usable', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('rox_cloud_key', 'rox_sk_live_test')
    sessionStorage.setItem('rox_console_guest', '1')
    sessionStorage.setItem('rox_console_guest_name', 'Гость')
  })

  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/v1/account') {
      return route.fulfill(json({ object: 'account', balance_cents: 2000, reserved_cents: 0, month_spent_cents: 0, monthly_cap_cents: 2000, tenant_id: 'ten_test', tenant_name: 'Гость' }))
    }
    if (path === '/v1/sandboxes') {
      return route.fulfill(json({ object: 'list', data: [SANDBOX], has_more: false, next_cursor: null }))
    }
    if (path === '/v1/sandboxes/sbx_test') {
      return route.fulfill(json(SANDBOX))
    }
    if (path === '/v1/sandboxes/sbx_test/network') {
      return route.fulfill(json({ object: 'network', sandbox_id: 'sbx_test', private_ip: '172.20.0.42', public_ip: null, note: 'Публичного адреса нет' }))
    }
    if (path === '/v1/sandboxes/sbx_test/network-check') {
      return route.fulfill(json({ object: 'network_check', at: '2026-11-22T09:00:00.000Z', online: true, latency_ms: 12, download_mbps: 0, note: null }))
    }
    if (path === '/v1/sandboxes/sbx_test/metrics') {
      return route.fulfill(json({ object: 'metrics', at: '2026-11-22T09:00:00.000Z', cpu_percent: 7, memory_used_kb: 1024, memory_total_kb: 4096, disk_used_kb: 2048, disk_total_kb: 8192 }))
    }
    if (path === '/v1/sandboxes/sbx_test/processes') {
      return route.fulfill(json({ object: 'list', data: [{ pid: 7, user: 'rox', cpu_percent: 2, memory_kb: 1024, command: 'sleep 600' }] }))
    }
    if (path === '/v1/sandboxes/sbx_test/snapshots') {
      return route.fulfill(json({ object: 'list', data: [] }))
    }
    if (path === '/v1/sandboxes/sbx_test/files/list') {
      return route.fulfill(json({ object: 'list', path: '/home/daytona', data: [
        { name: '.bashrc', path: '/home/daytona/.bashrc', is_dir: false, size: 12, modified_at: '2026-11-22T09:00:00.000Z' },
        { name: 'notes', path: '/home/daytona/notes', is_dir: true, size: 0, modified_at: '2026-11-22T09:00:00.000Z' },
      ] }))
    }
    if (path === '/v1/sandboxes/sbx_test/files') {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '# ~/.bashrc mocked\n' })
    }
    if (path === '/v1/sandboxes/sbx_test/exec') {
      return route.fulfill(json({ stdout: 'HELLO\n', stderr: '', exit_code: 0 }))
    }
    if (path === '/v1/audit') {
      return route.fulfill(json({ object: 'list', data: [] }))
    }
    return route.fulfill(json({ object: 'list', data: [] }))
  })

  await page.goto('/console/machines/sbx_test')
  await expect(page.getByText('Сеть и доступ')).toBeVisible()
  await expect(page.getByText('2 CPU · 4 GB RAM · 8 GB SSD').first()).toBeVisible()

  const input = page.getByRole('textbox', { name: /Команда для машины/ })
  await input.fill('echo HELLO')
  await input.press('Enter')
  await expect(page.getByText('HELLO', { exact: true })).toBeVisible()
  await expect(page.getByText('код выхода 0')).toHaveCount(0)

  await page.getByRole('button', { name: /^\.bashrc/ }).first().click()
  await expect(page.getByText('# ~/.bashrc mocked')).toBeVisible()

  const before = await page.locator('.workspace-terminal').boundingBox()
  const splitter = await page.locator('.workspace-splitter').first().boundingBox()
  expect(before).not.toBeNull()
  expect(splitter).not.toBeNull()
  await page.mouse.move(splitter!.x + splitter!.width / 2, splitter!.y + splitter!.height / 2)
  await page.mouse.down()
  await page.mouse.move(splitter!.x + splitter!.width / 2 + 80, splitter!.y + splitter!.height / 2)
  await page.mouse.up()
  const after = await page.locator('.workspace-terminal').boundingBox()
  expect(after!.width).toBeGreaterThan(before!.width + 40)

  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.locator('.workspace-splitter').first()).toBeHidden()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow).toBe(false)
})
