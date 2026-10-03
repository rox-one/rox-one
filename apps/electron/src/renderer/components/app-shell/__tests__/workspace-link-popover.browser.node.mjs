import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../');
const require = createRequire(root + '/package.json');
const { chromium } = require('playwright');
const enabled = process.env.ROX_RAIL_POPOVER_BROWSER_TEST === '1';
const directory = process.env.ROX_RAIL_POPOVER_FIXTURE_DIST;
let browser, server, address;
if (!enabled) test('workspace link popover browser qualification requires explicit opt-in', { skip: true }, () => {});
else {
  before(async () => {
    assert.ok(directory, 'Supply the compiled production component fixture');
    server = createServer((req, res) => {
      const path = resolve(directory, '.' + (req.url === '/' ? '/index.html' : new URL(req.url, 'http://fixture').pathname));
      if (!path.startsWith(resolve(directory) + '/')) { res.writeHead(403).end(); return; }
      try { const body = readFileSync(path); res.setHeader('content-type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)] ?? 'application/octet-stream'); res.end(body); }
      catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    address = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.ROX_UI001_CHROMIUM_EXECUTABLE });
  }, { timeout: 20_000 });
  after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise(resolve => server?.close(resolve)); }, { timeout: 20_000 });
  async function pageFor(t, width = 1386, height = 800) {
    const context = await browser.newContext({ viewport: { width, height } });
    t.after(() => context.close());
    const page = await context.newPage(); page.setDefaultTimeout(3_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(address); await page.getByRole('button', { name: 'workspaceRail.addLink', exact: true }).click();
    await page.getByPlaceholder('workspaceRail.linkLabelPlaceholder').waitFor();
    assert.deepEqual(errors, [], 'Actual component must mount without runtime errors');
    return page;
  }
  const label = page => page.getByPlaceholder('workspaceRail.linkLabelPlaceholder');
  async function selectKind(page, kind) {
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: `workspaceRail.kind${kind}`, exact: true }).click();
  }
  test('desktop actual rail editor has usable fields and visible viewport bounds', { timeout: 20_000 }, async t => {
    const page = await pageFor(t); const input = await label(page).boundingBox();
    assert.ok(input.width > 200, `Actual field width ${input.width} must exceed 200px`);
    const dialog = await page.getByRole('dialog').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= 1386 && dialog.y + dialog.height <= 800);
    assert.equal(await label(page).evaluate(element => element === document.activeElement), true);
    if (process.env.ROX_RAIL_POPOVER_SCREENSHOTS) await page.screenshot({ path: process.env.ROX_RAIL_POPOVER_SCREENSHOTS + '/rail-links-desktop.png' });
  });
  test('narrow actual Radix portal remains within the 320px viewport', { timeout: 20_000 }, async t => {
    const page = await pageFor(t, 320, 480); const rect = await page.getByRole('dialog').boundingBox();
    assert.ok(rect.width <= 280 && rect.x >= 0 && rect.x + rect.width <= 320 && rect.y >= 0 && rect.y + rect.height <= 480, JSON.stringify(rect));
    assert.ok((await label(page).boundingBox()).width >= 200);
    if (process.env.ROX_RAIL_POPOVER_SCREENSHOTS) await page.screenshot({ path: process.env.ROX_RAIL_POPOVER_SCREENSHOTS + '/rail-links-narrow.png' });
  });
  for (const kind of ['Knowledge', 'Notes', 'External']) test(`${kind} saves with Enter through actual form and actual workspace storage`, { timeout: 20_000 }, async t => {
    const page = await pageFor(t); await label(page).fill(`  ${kind} link  `);
    if (kind !== 'Knowledge') await selectKind(page, kind);
    if (kind === 'Notes') await page.getByPlaceholder('workspaceRail.notesPathPlaceholder').fill('folder/path');
    if (kind === 'External') await page.getByPlaceholder('workspaceRail.linkUrlPlaceholder').fill('example.test/resource');
    await label(page).press('Enter'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    let links = await page.evaluate(() => window.railFixture.links());
    assert.equal(links.length, 1); assert.equal(links[0].label, `${kind} link`); assert.equal(links[0].kind, kind.toLowerCase());
    await page.reload(); await page.getByRole('button', { name: `${kind} link`, exact: true }).click();
    links = await page.evaluate(() => window.railFixture.links()); assert.equal(links.length, 1);
    assert.deepEqual(await page.evaluate(() => window.railFixture.navigations), [kind === 'External' ? 'https://example.test/resource' : kind === 'Notes' ? 'notes' : 'knowledge']);
    await page.evaluate(() => window.railFixture.scope('ws-b')); assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
    await page.evaluate(() => window.railFixture.scope('ws-a')); assert.equal((await page.evaluate(() => window.railFixture.links()))[0].label, `${kind} link`);
  });
  test('blank label and external missing URL refuse persistence', { timeout: 20_000 }, async t => {
    const page = await pageFor(t); await label(page).press('Enter');
    assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
    assert.equal((await page.evaluate(() => window.railFixture.toasts))[0][0], 'workspaceRail.linkLabelRequired');
    await label(page).fill('External'); await selectKind(page, 'External'); await label(page).press('Enter');
    assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
    assert.equal((await page.evaluate(() => window.railFixture.toasts)).at(-1)[0], 'workspaceRail.linkMissingUrl');
  });
  test('nested select Escape preserves form and draft; second Escape restores trigger focus', { timeout: 20_000 }, async t => {
    const page = await pageFor(t); await label(page).fill('Unsaved'); await page.getByRole('combobox').click();
    await page.getByRole('listbox').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('listbox').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 1); assert.equal(await label(page).inputValue(), 'Unsaved');
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'workspaceRail.addLink');
    assert.equal(await page.getByRole('button', { name: 'workspaceRail.addLink', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'workspaceRail.addLink', exact: true }).click(); assert.equal(await label(page).inputValue(), 'Unsaved');
    assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
  });
  test('cancel and outside dismissal retain unsubmitted draft without writing', { timeout: 20_000 }, async t => {
    const page = await pageFor(t); await label(page).fill('Draft'); await page.getByRole('button', { name: 'common.cancel', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'workspaceRail.addLink', exact: true }).click(); assert.equal(await label(page).inputValue(), 'Draft');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.mouse.click(1000, 400); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
  });
  test('workspace change closes pending form without persisting a foreign shortcut', { timeout: 20_000 }, async t => {
    const page = await pageFor(t); await label(page).fill('Not submitted'); await page.evaluate(() => window.railFixture.scope('ws-b'));
    await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
    await page.evaluate(() => window.railFixture.scope('ws-a')); assert.deepEqual(await page.evaluate(() => window.railFixture.links()), []);
  });
}
