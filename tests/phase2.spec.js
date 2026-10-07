// Phase 2 checklist, run in a real browser against index.html.
// Usage: node tests/phase2.spec.js   (needs the `playwright` package and Chromium)
const path = require('path');
const { chromium } = require('playwright');

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
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(FILE + '#products');
  await page.waitForSelector('.p-card');

  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const toastText = () => page.textContent('#toastRoot');
  const variantBySku = async sku => (await db()).variants.find(v => v.sku === sku);
  const save = () => page.click('.modal-foot [data-action=save]');

  console.log('Products');
  await check('creates a product with two variants, each with its own suggested SKU', async () => {
    await page.click('[data-action=addProduct]');
    await page.fill('#mForm [name=name]', 'MSV Test Spin');
    eq(await page.inputValue('#mForm [name=brand]'), 'MSV', 'brand default');
    const c1 = '#vList [data-vbox]:nth-child(1) ';
    await page.fill(c1 + '[name=gauge]', '1.23mm');
    await page.fill(c1 + '[name=colour]', 'Black');
    await page.fill(c1 + '[name=packaging]', 'Reel');
    eq(await page.inputValue(c1 + '[name=sku]'), 'MSV-TS-123-BLK-R', 'suggested SKU');
    await page.fill(c1 + '[name=cost]', '80');
    await page.fill(c1 + '[name=price]', '120');
    await page.fill(c1 + '[name=opening]', '20');
    await page.fill(c1 + '[name=reorder]', '5');
    await page.click('[data-action=addVariantCard]');
    const c2 = '#vList [data-vbox]:nth-child(2) ';
    await page.fill(c2 + '[name=colour]', 'White');
    eq(await page.inputValue(c2 + '[name=sku]'), 'MSV-TS-123-WHT-R', 'second SKU');
    await page.fill(c2 + '[name=opening]', '3');
    await save();
    await page.waitForSelector('#modalRoot:empty', { state: 'attached' });
    ok((await toastText()).includes('Product created successfully'), 'toast');
    const d = await db();
    const p = d.products.find(x => x.name === 'MSV Test Spin');
    ok(p, 'product saved');
    const vs = d.variants.filter(v => v.productId === p.id);
    eq(vs.length, 2, 'variant count');
    eq(vs.map(v => v.qty).join(','), '20,3', 'quantities kept per variant');
    ok(page.url().includes('#product-' + p.id), 'goes to product page');
    const strip = await page.textContent('.stat-strip');
    ok(strip.includes('23') && strip.includes('SGD 1,840'), 'product total stock 23 and value 1,840');
  });

  await check('opening stock creates an Opening Stock movement', async () => {
    const v = await variantBySku('MSV-TS-123-BLK-R');
    const ms = (await db()).movements.filter(m => m.variantId === v.id);
    eq(ms.length, 1); eq(ms[0].type, 'opening'); eq(ms[0].prevQty, 0); eq(ms[0].newQty, 20);
  });

  await check('rejects a duplicate SKU (existing SKU)', async () => {
    const p = (await db()).products.find(x => x.name === 'MSV Test Spin');
    await page.click(`[data-action=addVariant][data-id="${p.id}"]`);
    await page.fill('#mForm [name=sku]', 'msv-fh-123-blk-r');
    await page.fill('#mForm [name=cost]', '1'); await page.fill('#mForm [name=price]', '2'); await page.fill('#mForm [name=reorder]', '1');
    await save();
    ok((await page.textContent('#mForm')).includes('already used by MSV Focus Hex'), 'duplicate warning shown');
    ok(await page.$('#mForm [name=sku].invalid'), 'field marked invalid');
    await page.click('.modal-foot [data-action=close]');
  });

  await check('rejects duplicate SKUs within the same form', async () => {
    await page.goto(FILE + '#products');
    await page.click('[data-action=addProduct]');
    await page.fill('#mForm [name=name]', 'MSV Dupe Test');
    const c1 = '#vList [data-vbox]:nth-child(1) ';
    await page.fill(c1 + '[name=sku]', 'DUP-1'); await page.fill(c1 + '[name=cost]', '1'); await page.fill(c1 + '[name=price]', '2'); await page.fill(c1 + '[name=reorder]', '0');
    await page.click('[data-action=addVariantCard]');
    await page.fill('#vList [data-vbox]:nth-child(2) [name=sku]', 'DUP-1');
    await save();
    ok((await page.textContent('#mForm')).includes('Another variant in this form uses the same SKU'));
    await page.click('.modal-foot [data-action=close]');
    ok(!(await db()).products.some(p => p.name === 'MSV Dupe Test'), 'nothing saved');
  });

  await check('validates blank name and negative prices/stock', async () => {
    await page.goto(FILE + '#products');
    await page.click('[data-action=addProduct]');
    const c1 = '#vList [data-vbox]:nth-child(1) ';
    await page.fill(c1 + '[name=cost]', '-5'); await page.fill(c1 + '[name=price]', '-1'); await page.fill(c1 + '[name=opening]', '-2'); await page.fill(c1 + '[name=reorder]', '-1');
    await save();
    const t = await page.textContent('#mForm');
    for (const msg of ['Product name cannot be blank', 'Cost price cannot be negative', 'Selling price cannot be negative', 'Opening stock cannot be negative', 'Reorder level cannot be negative'])
      ok(t.includes(msg), 'missing: ' + msg);
    await page.click('.modal-foot [data-action=close]');
  });

  await check('edits product information', async () => {
    const p = (await db()).products.find(x => x.name === 'MSV Test Spin');
    await page.goto(FILE + '#product-' + p.id);
    await page.click(`[data-action=editProduct][data-id="${p.id}"]`);
    await page.fill('#mForm [name=description]', 'Test description');
    await page.selectOption('#mForm [name=categoryId]', 'cat-other');
    await save();
    const p2 = (await db()).products.find(x => x.id === p.id);
    eq(p2.description, 'Test description'); eq(p2.categoryId, 'cat-other');
    ok((await toastText()).includes('Product updated successfully'));
    await page.click(`[data-action=editProduct][data-id="${p.id}"]`);
    await page.selectOption('#mForm [name=categoryId]', 'cat-strings');
    await save();
  });

  await check('edits a variant without exposing stock quantity', async () => {
    const v = await variantBySku('MSV-TS-123-WHT-R');
    await page.goto(FILE + '#variant-' + v.id);
    await page.click(`[data-action=editVariant][data-id="${v.id}"]`);
    ok(!(await page.$('#mForm [name=opening]')) && !(await page.$('#mForm [name=qty]')), 'no quantity field');
    await page.fill('#mForm [name=price]', '130');
    await save();
    const v2 = await variantBySku('MSV-TS-123-WHT-R');
    eq(v2.price, 130); eq(v2.qty, 3, 'qty unchanged');
    ok((await toastText()).includes('Variant updated successfully'));
  });

  console.log('Stock adjustments and ledger');
  await check('decrease by 2 (Damaged Item) gives 20 → 18 and a ledger row', async () => {
    const v = await variantBySku('MSV-TS-123-BLK-R');
    await page.goto(FILE + '#variant-' + v.id);
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.fill('#mForm [name=qty]', '2');
    await page.selectOption('#mForm [name=reason]', 'Damaged Item');
    await page.fill('#mForm [name=notes]', 'Crushed box');
    await save();
    eq((await variantBySku('MSV-TS-123-BLK-R')).qty, 18);
    const m = (await db()).movements.filter(x => x.variantId === v.id).pop();
    eq(m.type, 'adjustment'); eq(m.change, -2); eq(m.prevQty, 20); eq(m.newQty, 18); eq(m.reason, 'Damaged Item');
    ok((await toastText()).includes('Stock adjusted successfully'));
  });

  await check('requires a reason', async () => {
    const v = await variantBySku('MSV-TS-123-BLK-R');
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.fill('#mForm [name=qty]', '1');
    await save();
    ok((await page.textContent('#mForm')).includes('Choose a reason'));
    await page.click('.modal-foot [data-action=close]');
    eq((await variantBySku('MSV-TS-123-BLK-R')).qty, 18);
  });

  await check('blocks negative stock', async () => {
    const v = await variantBySku('MSV-TS-123-BLK-R');
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.fill('#mForm [name=qty]', '50');
    await page.selectOption('#mForm [name=reason]', 'Lost Item');
    await save();
    ok((await page.textContent('#mForm')).includes('Only 18 in stock'));
    await page.click('.modal-foot [data-action=close]');
    eq((await variantBySku('MSV-TS-123-BLK-R')).qty, 18);
  });

  await check('increase and set exact quantity', async () => {
    const v = await variantBySku('MSV-TS-123-BLK-R');
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.click('[data-adjtype=increase]');
    await page.fill('#mForm [name=qty]', '4');
    await page.selectOption('#mForm [name=reason]', 'Returned Stock');
    await save();
    eq((await variantBySku('MSV-TS-123-BLK-R')).qty, 22);
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.click('[data-adjtype=set]');
    await page.fill('#mForm [name=qty]', '0');
    await page.selectOption('#mForm [name=reason]', 'Stock Count Correction');
    await save();
    const m = (await db()).movements.filter(x => x.variantId === v.id).pop();
    eq(m.change, -22); eq(m.newQty, 0);
  });

  await check('status is calculated: Out of Stock at 0, Low Stock at or below reorder, In Stock above', async () => {
    const st = await page.evaluate(() => DB.variants.filter(v => v.sku.startsWith('MSV-TS')).map(v => v.sku + ':' + stockStatus(v)).sort().join(','));
    eq(st, 'MSV-TS-123-BLK-R:Out of Stock,MSV-TS-123-WHT-R:Low Stock');
    eq(await page.evaluate(() => stockStatus({ qty: 6, reorder: 5 })), 'In Stock');
    eq(await page.evaluate(() => stockStatus({ qty: 5, reorder: 5 })), 'Low Stock');
  });

  await check('Stock Movement tab lists movements in order with previous and new stock', async () => {
    await page.click('[data-vtab="Stock Movement"]');
    const rows = await page.$$eval('.card tbody tr', trs => trs.map(tr => [...tr.cells].map(c => c.innerText.trim())));
    eq(rows.length, 4, 'four movements');
    eq(rows[0][1], 'Opening Stock'); eq(rows[0][2], '+20'); eq(rows[0][3] + '→' + rows[0][4], '0→20');
    eq(rows[1][2], '−2'); eq(rows[1][3] + '→' + rows[1][4], '20→18');
    eq(rows[3][4], '0');
  });

  console.log('Inventory page');
  await check('summary cards match the saved data', async () => {
    await page.goto(FILE + '#inventory');
    const t = await page.evaluate(() => { const t = totals(); return { v: Math.round(t.value), u: t.units, low: t.low, out: t.out }; });
    const k = await page.$$eval('.kpi .kpi-value', els => els.map(e => e.innerText.replace(/\s+/g, '')));
    eq(k[0], 'SGD' + t.v.toLocaleString('en-SG')); eq(k[1], t.u.toLocaleString('en-SG')); eq(k[2], String(t.low)); eq(k[3], String(t.out));
  });

  await check('search finds by name, SKU, gauge, colour and packaging', async () => {
    const count = async q => { await page.fill('#invQ', q); return (await page.$$('#invTable tbody tr')).length; };
    eq(await count('MSV-TS'), 2, 'SKU prefix');
    eq(await count('test spin white'), 1, 'name + colour');
    ok(await count('1.23') > 2, 'gauge');
    ok(await count('reel') > 5, 'packaging');
    eq(await count('zzz-nothing'), 0, 'no match');
    ok((await page.textContent('#invTable')).includes('No SKUs match'), 'empty state');
    await page.fill('#invQ', '');
  });

  await check('filters combine and Reset Filters clears them', async () => {
    const all = (await page.$$('#invTable tbody tr')).length;
    await page.selectOption('[data-filter=prod]', { label: 'MSV Focus Hex' });
    await page.selectOption('[data-filter=pack]', 'Reel');
    await page.selectOption('[data-filter=colour]', 'Black');
    const rows = await page.$$eval('#invTable tbody tr td:first-child', tds => tds.map(t => t.innerText));
    eq(rows.length, 4, 'Focus Hex black reels'); ok(rows.every(s => s.startsWith('MSV-FH-') && s.endsWith('-BLK-R')));
    await page.selectOption('[data-filter=status]', 'Low Stock');
    eq((await page.$$('#invTable tbody tr')).length, 1, 'plus Low Stock');
    await page.click('[data-action=resetInv]');
    eq((await page.$$('#invTable tbody tr')).length, all, 'reset');
  });

  await check('inventory value = quantity × cost on each row', async () => {
    const v = await variantBySku('MSV-FH-123-BLK-R');
    await page.fill('#invQ', 'MSV-FH-123-BLK-R');
    const cells = await page.$$eval('#invTable tbody tr:first-child td', tds => tds.map(t => t.innerText.trim()));
    eq(cells[5], String(v.qty)); eq(cells[8], 'SGD ' + (v.qty * v.cost).toLocaleString('en-SG'));
    await page.fill('#invQ', '');
  });

  console.log('Status, deletion and persistence');
  await check('deactivating a product hides it from inventory but keeps its history', async () => {
    const p = (await db()).products.find(x => x.name === 'MSV Test Spin');
    await page.goto(FILE + '#product-' + p.id);
    ok(!(await page.$('[data-action=deleteProduct]')), 'no Delete when there is history');
    await page.click(`[data-action=toggleProduct][data-id="${p.id}"]`);
    ok((await toastText()).includes('Product deactivated'));
    await page.goto(FILE + '#inventory');
    await page.fill('#invQ', 'MSV-TS');
    eq((await page.$$('#invTable tbody tr')).length, 0, 'hidden by default');
    await page.check('#showInactive');
    await page.fill('#invQ', 'MSV-TS');
    eq((await page.$$('#invTable tbody tr')).length, 2, 'shown with Show inactive');
    ok((await db()).movements.some(m => m.sku === 'MSV-TS-123-BLK-R'), 'movements kept');
  });

  await check('deactivates a single variant', async () => {
    const v = await variantBySku('MSV-FH-118-RED-S');
    await page.goto(FILE + '#variant-' + v.id);
    await page.click(`[data-action=toggleVariant][data-id="${v.id}"]`);
    eq((await variantBySku('MSV-FH-118-RED-S')).status, 'Inactive');
    ok((await toastText()).includes('Variant deactivated'));
  });

  await check('a product with no history can be deleted after confirmation', async () => {
    await page.goto(FILE + '#products');
    await page.click('[data-action=addProduct]');
    await page.fill('#mForm [name=name]', 'Delete Me Grip');
    await page.selectOption('#mForm [name=categoryId]', 'cat-grips');
    ok(!(await page.isVisible('#vList [name=gauge]')), 'gauge hidden for Grips');
    await page.fill('#vList [name=colour]', 'Black'); await page.fill('#vList [name=packaging]', '3-pack');
    await page.fill('#vList [name=cost]', '2'); await page.fill('#vList [name=price]', '5'); await page.fill('#vList [name=reorder]', '10');
    await save();
    const p = (await db()).products.find(x => x.name === 'Delete Me Grip');
    eq((await db()).variants.find(v => v.productId === p.id).gauge, '', 'no gauge stored');
    await page.click(`[data-action=deleteProduct][data-id="${p.id}"]`);
    await save();
    ok(!(await db()).products.some(x => x.id === p.id), 'deleted');
  });

  await check('categories can be added', async () => {
    await page.goto(FILE + '#settings');
    await page.fill('#addCatForm [name=name]', 'Bags');
    await page.click('#addCatForm button[type=submit]');
    ok((await db()).categories.some(c => c.name === 'Bags'));
  });

  await check('data survives a page reload', async () => {
    const before = await db();
    await page.reload();
    await page.waitForSelector('#app');
    const after = await db();
    eq(after.variants.length, before.variants.length); eq(after.movements.length, before.movements.length);
    eq(after.variants.find(v => v.sku === 'MSV-TS-123-BLK-R').qty, 0);
  });

  await check('dashboard inventory cards use live data', async () => {
    await page.goto(FILE + '#dashboard');
    const t = await page.evaluate(() => ({ v: Math.round(totals().value), u: totals().units, a: attention().length }));
    const k = await page.$$eval('.kpi .kpi-value', els => els.map(e => e.innerText.replace(/\s+/g, '')));
    eq(k[0], 'SGD' + t.v.toLocaleString('en-SG')); eq(k[2], t.u.toLocaleString('en-SG')); eq(k[3], String(t.a));
  });

  await check('no script errors', async () => { eq(errors.length, 0, 'errors: ' + errors.join(' | ')); });

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
