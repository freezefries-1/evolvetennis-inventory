// Phone layout checks at iPhone size (390 × 844), run in a real browser against index.html.
// Usage: node tests/phone.spec.js   (needs the `playwright` package and Chromium)
const path = require('path');
const { chromium } = require('playwright');
const { signIn, closeM } = require('./auth');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failures.push(name); console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'expected'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await signIn(page);
  const open = async h => { await page.goto(FILE + '#' + h); await page.reload(); await page.waitForSelector('#app .page-head'); await page.waitForTimeout(150); };

  console.log('Phone layout');
  await check('no page scrolls sideways', async () => {
    for (const r of ['dashboard', 'inventory', 'movements', 'products', 'purchases', 'suppliers', 'sales', 'customers', 'returns', 'reports', 'financials', 'audit', 'settings', 'notifications']) {
      await open(r);
      eq(await page.evaluate(() => document.documentElement.scrollWidth), 390, r);
    }
  });
  await check('tables show as cards with a label on every value', async () => {
    await open('sales');
    const t = await page.evaluate(() => {
      const tb = document.querySelector('#app table'), row = tb.tBodies[0].rows[0], cell = row.cells[1];
      return { head: getComputedStyle(tb.tHead).display, row: getComputedStyle(row).display, label: cell.dataset.label, before: getComputedStyle(cell, '::before').content };
    });
    eq(t.head, 'none', 'header hidden'); eq(t.row, 'grid', 'row is a card'); eq(t.label, 'Date'); eq(t.before, '"Date"');
  });
  await check('rows added after paging or sorting are labelled too', async () => {
    await open('sales');
    await page.evaluate(() => document.querySelector('#app th').click()); await page.waitForTimeout(200);
    ok(await page.evaluate(() => [...document.querySelectorAll('#app table tbody tr')].every(r => r.dataset.lb)), 'every row labelled');
  });
  await check('long filter lists fold behind a Filters button that stays open while filtering', async () => {
    await open('sales');
    ok(!(await page.isVisible('#app .toolbar select')), 'filters folded');
    await page.click('.filter-toggle'); ok(await page.isVisible('#app .toolbar select'), 'filters shown');
    await page.selectOption('#app .toolbar select >> nth=0', { index: 1 }); await page.waitForTimeout(200);
    ok(await page.isVisible('#app .toolbar select'), 'still open after re-render');
    ok((await page.textContent('.filter-toggle')).includes('1'), 'active filter count');
  });
  await check('forms open at the top with Save always on screen', async () => {
    await open('sales');
    await page.evaluate(() => ACTIONS.sale({})); await page.waitForTimeout(200);
    const top = await page.evaluate(() => document.querySelector('.modal').getBoundingClientRect().top);
    ok(top >= 0 && top < 60, 'modal top visible: ' + top);
    const foot = await page.evaluate(() => document.querySelector('.modal-foot').getBoundingClientRect().bottom);
    ok(foot <= 844 + 1, 'save bar in view: ' + foot);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('[data-sline]>:nth-child(2)'), '::before').content === '"Quantity"'), 'line item labels');
    await closeM(page);
  });
  await check('text fields are 16px so iPhones do not zoom in', async () => {
    await open('products');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('#app .input')).fontSize), '16px');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('#globalSearchInput')).fontSize), '16px');
  });
  await check('the bottom tab bar moves between sections and opens the menu', async () => {
    await open('dashboard');
    ok(await page.isVisible('#mnav'), 'tab bar shown');
    await page.click('#mnav a[href="#sales"]'); await page.waitForTimeout(200);
    eq(await page.evaluate(() => location.hash), '#sales');
    eq(await page.getAttribute('#mnav a[href="#sales"]', 'aria-current'), 'page');
    await page.click('#mnavMore'); ok(await page.evaluate(() => document.querySelector('#shell').classList.contains('open')), 'menu opens');
  });
  await check('desktop is unchanged: no tab bar, tables keep their columns', async () => {
    await page.setViewportSize({ width: 1400, height: 900 }); await open('sales');
    ok(!(await page.isVisible('#mnav')), 'no tab bar');
    eq(await page.evaluate(() => getComputedStyle(document.querySelector('#app table thead')).display), 'table-header-group');
    ok(await page.isVisible('#app .toolbar select'), 'filters visible');
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check('no script errors', async () => { eq(errors.length, 0, errors.join(' | ')); });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
