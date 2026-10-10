// Phase 3 checklist (suppliers, purchases, receiving, reversal), run in a real browser against index.html.
// Usage: node tests/phase3.spec.js   (needs the `playwright` package and Chromium)
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
  await page.goto(FILE + '#suppliers');
  await page.waitForSelector('#app table');

  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const toastText = () => page.textContent('#toastRoot');
  const qty = sku => page.evaluate(s => DB.variants.find(v => v.sku === s).qty, sku);
  const save = () => page.click('.modal-foot [data-action=save]');
  const closeModal = () => page.click('.modal-foot [data-action=close]');
  const formText = () => page.textContent('#mForm');
  async function pickItem(n, query, sku) {
    const row = `#pLines [data-pline]:nth-child(${n}) `;
    await page.fill(row + '[data-l=search]', query);
    await page.click(`${row} .combo-list [data-opt="${await page.evaluate(s => DB.variants.find(v => v.sku === s).id, sku)}"]`);
    return row;
  }
  let purId, purNo;

  console.log('Suppliers');
  await check('creates a supplier with a default currency', async () => {
    await page.click('[data-action=addSupplier]');
    await page.fill('#mForm [name=name]', 'Osaka String Trading');
    await page.fill('#mForm [name=country]', 'Japan');
    await page.fill('#mForm [name=contact]', 'Ken Sato');
    await page.selectOption('#mForm [name=currency]', 'JPY');
    await save();
    ok((await toastText()).includes('Supplier created successfully'));
    const s = (await db()).suppliers.find(x => x.name === 'Osaka String Trading');
    ok(s && s.currency === 'JPY' && s.status === 'Active', 'saved');
    ok(page.url().includes('#supplier-' + s.id), 'opens supplier page');
  });
  await check('requires a supplier name and a valid email', async () => {
    await page.goto(FILE + '#suppliers');
    await page.click('[data-action=addSupplier]');
    await page.fill('#mForm [name=email]', 'not-an-email');
    await save();
    const t = await formText();
    ok(t.includes('Supplier name is required') && t.includes('valid email'));
    await closeModal();
  });
  await check('edits a supplier', async () => {
    const s = (await db()).suppliers.find(x => x.name === 'Osaka String Trading');
    await page.goto(FILE + '#supplier-' + s.id);
    await page.click(`[data-action=editSupplier][data-id="${s.id}"]`);
    await page.fill('#mForm [name=contact]', 'Yuki Sato');
    await save();
    eq((await db()).suppliers.find(x => x.id === s.id).contact, 'Yuki Sato');
    ok((await toastText()).includes('Supplier updated successfully'));
  });
  await check('supplier default currency fills in on a new purchase', async () => {
    const s = (await db()).suppliers.find(x => x.name === 'Osaka String Trading');
    await page.goto(FILE + '#purchases');
    await page.click('.page-head [data-action=purchase]');
    await page.selectOption('#mForm [name=supplierId]', s.id);
    eq(await page.inputValue('#mForm [name=currency]'), 'JPY');
    await page.selectOption('#mForm [name=supplierId]', 's-msv');
    eq(await page.inputValue('#mForm [name=currency]'), 'EUR');
    await closeModal();
  });
  await check('deactivates a supplier and hides it from new purchases', async () => {
    const s = (await db()).suppliers.find(x => x.name === 'Osaka String Trading');
    await page.goto(FILE + '#supplier-' + s.id);
    await page.click(`[data-action=toggleSupplier][data-id="${s.id}"]`);
    ok((await toastText()).includes('Supplier deactivated'));
    await page.goto(FILE + '#purchases');
    await page.click('.page-head [data-action=purchase]');
    const opts = await page.$$eval('#mForm [name=supplierId] option', o => o.map(x => x.value));
    ok(!opts.includes(s.id), 'inactive supplier not offered');
    await closeModal();
  });

  console.log('Purchases');
  await check('validates required fields, quantity and unit cost', async () => {
    await page.click('.page-head [data-action=purchase]');
    await save();
    ok((await formText()).includes('Add at least one item'), 'needs an item');
    await page.fill('#mForm [name=date]', '');
    await pickItem(1, 'MSV-FH-123-BLK-R', 'MSV-FH-123-BLK-R');
    await page.fill('#pLines [data-pline]:nth-child(1) [data-l=qty]', '0');
    await page.fill('#pLines [data-pline]:nth-child(1) [data-l=cost]', '-1');
    await save();
    const t = await formText();
    for (const m of ['Choose a supplier', 'Purchase date is required', 'greater than 0', 'Unit cost cannot be negative']) ok(t.includes(m), 'missing: ' + m);
    await closeModal();
  });
  await check('creates a draft with multiple items, totals and additional costs', async () => {
    const before = [await qty('MSV-FH-123-BLK-R'), await qty('MSV-SW-130-BLK-R')];
    await page.click('.page-head [data-action=purchase]');
    await page.selectOption('#mForm [name=supplierId]', 's-msvasia');
    eq(await page.inputValue('#mForm [name=currency]'), 'SGD', 'supplier currency');
    await page.fill('#mForm [name=invoiceNo]', 'INV-TEST-77');
    const r1 = await pickItem(1, 'focus hex 1.23 black reel', 'MSV-FH-123-BLK-R');
    await page.fill(r1 + '[data-l=qty]', '20'); await page.fill(r1 + '[data-l=cost]', '82');
    eq((await page.textContent(r1 + '[data-l=total]')).trim(), 'SGD 1,640.00', 'line total');
    await page.click('[data-action=addPLine]');
    const r2 = await pickItem(2, 'swift 1.30', 'MSV-SW-130-BLK-R');
    await page.fill(r2 + '[data-l=qty]', '5'); await page.fill(r2 + '[data-l=cost]', '78');
    await page.fill('#mForm [name=cost_shipping]', '200');
    await page.fill('#mForm [name=cost_duties]', '100');
    await page.fill('#mForm [name=cost_other]', '50');
    await page.fill('#mForm [name=otherDesc]', 'Pallet wrap');
    const sum = (await page.textContent('#pSum')).replace(/\s+/g, ' ');
    ok(sum.includes('SGD 2,030.00') && sum.includes('SGD 350.00') && sum.includes('SGD 2,380.00'), 'summary ' + sum);
    await save();
    ok((await toastText()).includes('Purchase saved as draft'));
    const p = (await db()).purchases.find(x => x.invoiceNo === 'INV-TEST-77');
    purId = p.id; purNo = p.no;
    eq(p.status, 'Draft'); eq(p.lines.length, 2); eq(p.costs.shipping + p.costs.duties + p.costs.other, 350);
    eq([await qty('MSV-FH-123-BLK-R'), await qty('MSV-SW-130-BLK-R')].join(), before.join(), 'draft does not change stock');
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.replace(/\s+/g, '')));
    eq(k[0], '25'); eq(k[1], 'SGD2,030.00'); eq(k[2], 'SGD350.00'); eq(k[3], 'SGD2,380.00');
  });
  await check('purchase numbers are unique, sequential and never reused', async () => {
    eq(purNo, 'PUR-2026-0005');
    const mk = async () => { await page.goto(FILE + '#purchases'); await page.click('.page-head [data-action=purchase]'); await page.selectOption('#mForm [name=supplierId]', 's-msv'); const r = await pickItem(1, 'MSV-OG-BLK', 'MSV-OG-BLK-3P'); await page.fill(r + '[data-l=qty]', '1'); await page.fill(r + '[data-l=cost]', '1'); await save(); return (await db()).purchases.slice(-1)[0]; };
    const a = await mk(); eq(a.no, 'PUR-2026-0006');
    await page.click(`[data-action=deletePurchase][data-id="${a.id}"]`); await save();
    ok(!(await db()).purchases.some(x => x.id === a.id), 'draft deleted');
    const b = await mk(); eq(b.no, 'PUR-2026-0007', 'deleted number not reused');
    const nos = (await db()).purchases.map(x => x.no); eq(new Set(nos).size, nos.length, 'all unique');
  });
  await check('identical duplicate lines are combined', async () => {
    await page.goto(FILE + '#purchases'); await page.click('.page-head [data-action=purchase]');
    await page.selectOption('#mForm [name=supplierId]', 's-msv');
    const r1 = await pickItem(1, 'MSV-BU-125-BLK-R', 'MSV-BU-125-BLK-R'); await page.fill(r1 + '[data-l=qty]', '2'); await page.fill(r1 + '[data-l=cost]', '60');
    await page.click('[data-action=addPLine]');
    const r2 = await pickItem(2, 'MSV-BU-125-BLK-R', 'MSV-BU-125-BLK-R'); await page.fill(r2 + '[data-l=qty]', '3'); await page.fill(r2 + '[data-l=cost]', '60');
    ok((await page.textContent(r2 + '[data-l=warn]')).includes('Same SKU as item 1'), 'warning shown');
    await save();
    const p = (await db()).purchases.slice(-1)[0];
    eq(p.lines.length, 1); eq(p.lines[0].qty, 5);
    ok((await toastText()).includes('combined'));
  });

  console.log('Receiving');
  await check('ordered purchase does not affect inventory', async () => {
    const before = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#purchase-' + purId);
    await page.click(`[data-action=orderPurchase][data-id="${purId}"]`);
    ok((await toastText()).includes('Purchase marked as ordered'));
    eq((await db()).purchases.find(x => x.id === purId).status, 'Ordered');
    eq(await qty('MSV-FH-123-BLK-R'), before);
  });
  await check('receiving increases inventory and records one movement per line', async () => {
    const b1 = await qty('MSV-FH-123-BLK-R'), b2 = await qty('MSV-SW-130-BLK-R');
    await page.click(`.page-head [data-action=receivePurchase][data-id="${purId}"]`);
    await save();
    ok((await toastText()).includes('Purchase received successfully'));
    ok((await toastText()).includes('25 units added to inventory'));
    eq(await qty('MSV-FH-123-BLK-R'), b1 + 20); eq(await qty('MSV-SW-130-BLK-R'), b2 + 5);
    const ms = (await db()).movements.filter(m => m.purchaseId === purId);
    eq(ms.length, 2); ok(ms.every(m => m.type === 'purchase' && m.reference === purNo && m.supplierId === 's-msvasia'));
    const m1 = ms.find(m => m.sku === 'MSV-FH-123-BLK-R'); eq(m1.prevQty, b1); eq(m1.newQty, b1 + 20); eq(m1.change, 20);
  });
  await check('receiving only happens once', async () => {
    const b = await qty('MSV-FH-123-BLK-R');
    ok(!(await page.$(`.page-head [data-action=receivePurchase]`)), 'no Receive button after receiving');
    const err = await page.evaluate(id => { try { receivePurchase(DB, DB.purchases.find(p => p.id === id), { date: todayISO() }); return 'no error'; } catch (e) { return e.message; } }, purId);
    ok(err.includes("can't be received again"), err);
    await page.evaluate(id => openReceive(id), purId);
    ok((await toastText()).includes('Already received'));
    eq(await qty('MSV-FH-123-BLK-R'), b);
    eq((await db()).movements.filter(m => m.purchaseId === purId).length, 2);
  });
  await check('received items and quantities are locked', async () => {
    ok(!(await page.$('[data-action=editPurchase]')), 'no Edit on a received purchase');
    ok(await page.$('[data-action=reversePurchase]'), 'Reverse available');
  });
  await check('inventory page shows the new quantity', async () => {
    const q = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#inventory'); await page.fill('#invQ', 'MSV-FH-123-BLK-R');
    eq((await page.$$eval('#invTable tbody tr:first-child td', t => t[5].innerText.trim())), String(q));
  });
  await check('creating as Received adds stock straight away; SGD cost can be updated', async () => {
    const b = await qty('MSV-ST-125-WHT-R');
    await page.goto(FILE + '#purchases'); await page.click('.page-head [data-action=purchase]');
    await page.selectOption('#mForm [name=supplierId]', 's-msvasia');
    await page.selectOption('#mForm [name=status]', 'Received');
    const r = await pickItem(1, 'soft touch 1.25 reel', 'MSV-ST-125-WHT-R'); await page.fill(r + '[data-l=qty]', '4'); await page.fill(r + '[data-l=cost]', '101.5');
    await page.check('#mForm [name=updateCost]');
    await save();
    eq(await qty('MSV-ST-125-WHT-R'), b + 4);
    const v = (await db()).variants.find(x => x.sku === 'MSV-ST-125-WHT-R'); eq(v.cost, 101.5); eq(v.lastPurchaseCost, 101.5);
  });
  await check('a foreign-currency receipt keeps the SGD cost and stores last purchase cost', async () => {
    const before = (await db()).variants.find(x => x.sku === 'MSV-FHU-130-BLU-R');
    const p = (await db()).purchases.find(x => x.no === 'PUR-2026-0003');
    await page.goto(FILE + '#purchase-' + p.id);
    await page.click(`.page-head [data-action=receivePurchase][data-id="${p.id}"]`);
    ok(!(await page.$('#mForm [name=updateCost]')), 'no cost update option for EUR');
    await save();
    const v = (await db()).variants.find(x => x.sku === 'MSV-FHU-130-BLU-R');
    eq(v.qty, before.qty + 8); eq(v.cost, before.cost); eq(v.lastPurchaseCost, 78); eq(v.lastPurchaseCurrency, 'EUR');
  });

  console.log('Search and filters');
  await check('search finds by number, supplier, invoice, product, SKU and notes', async () => {
    await page.goto(FILE + '#purchases');
    const n = async q => { await page.fill('#purQ', q); return page.$$eval('#purTable tbody tr td:first-child', t => t.map(x => x.innerText.trim())); };
    ok((await n(purNo)).includes(purNo), 'number');
    ok((await n('INV-TEST-77')).includes(purNo), 'invoice');
    ok((await n('MSV-SW-130')).includes(purNo), 'SKU');
    ok((await n('swift')).includes(purNo), 'product name');
    ok((await n('asia logistics')).includes(purNo), 'supplier');
    ok((await n('sea freight')).includes('PUR-2026-0001'), 'notes');
    eq((await n('nothing-like-this')).length, 0);
    await page.fill('#purQ', '');
  });
  await check('filters combine and reset', async () => {
    const all = (await page.$$('#purTable tbody tr')).length;
    await page.selectOption('[data-pfilter=status]', 'Received');
    await page.selectOption('[data-pfilter=currency]', 'EUR');
    const rows = await page.$$eval('#purTable tbody tr td:first-child', t => t.map(x => x.innerText.trim()));
    eq(rows.sort().join(), 'PUR-2026-0001,PUR-2026-0003');
    await page.selectOption('[data-pfilter=status]', '');
    await page.selectOption('[data-pfilter=supplier]', 's-msvasia');
    await page.fill('[data-pfilter=from]', '2026-10-01');
    ok((await page.$$('#purTable tbody tr')).length === 0, 'SGD from MSV Asia only, but currency filter is EUR');
    await page.selectOption('[data-pfilter=currency]', '');
    ok((await page.$$eval('#purTable tbody tr td:first-child', t => t.map(x => x.innerText.trim()))).includes(purNo));
    await page.selectOption('[data-pfilter=country]', 'Germany');
    eq((await page.$$('#purTable tbody tr')).length, 0, 'country');
    await page.click('[data-action=resetPur]');
    eq((await page.$$('#purTable tbody tr')).length, all);
  });

  console.log('Purchase history');
  await check('purchase appears on the supplier page', async () => {
    await page.goto(FILE + '#supplier-s-msvasia');
    ok((await page.textContent('#app')).includes(purNo));
  });
  await check('purchase appears on the variant page and opens the purchase', async () => {
    const v = (await db()).variants.find(x => x.sku === 'MSV-FH-123-BLK-R');
    await page.goto(FILE + '#variant-' + v.id);
    await page.click('[data-vtab="Purchases"]');
    ok((await page.textContent('#app')).includes(purNo));
    await page.click(`[data-go="purchase-${purId}"]`);
    ok(page.url().includes('#purchase-' + purId));
  });
  await check('stock movement links to the purchase', async () => {
    const v = (await db()).variants.find(x => x.sku === 'MSV-FH-123-BLK-R');
    await page.goto(FILE + '#variant-' + v.id);
    await page.click('[data-vtab="Stock Movement"]');
    ok(await page.$(`a[href="#purchase-${purId}"]`), 'reference link');
    await page.click(`a[href="#purchase-${purId}"]`);
    await page.waitForTimeout(50);
    ok(page.url().includes('#purchase-' + purId));
  });

  console.log('Reversal');
  await check('reversal is blocked if it would make stock negative', async () => {
    const q = await qty('MSV-SW-130-BLK-R');
    await page.evaluate(n => { const v = DB.variants.find(x => x.sku === 'MSV-SW-130-BLK-R'); postMovement(DB, v.id, { type: 'adjustment', change: -n, reason: 'Lost Item' }); persist(); }, q - 2);
    await page.goto(FILE + '#purchase-' + purId);
    await page.click(`[data-action=reversePurchase][data-id="${purId}"]`);
    ok((await formText()).includes('Reversal is blocked'));
    ok(await page.$eval('.modal-foot [data-action=save]', b => b.disabled), 'save disabled');
    const err = await page.evaluate(id => { try { reversePurchase(DB, DB.purchases.find(p => p.id === id), { date: todayISO(), reason: 'x' }); return 'no error'; } catch (e) { return e.message; } }, purId);
    ok(err.includes('Not enough stock'), err);
    eq(await qty('MSV-SW-130-BLK-R'), 2);
    await closeModal();
    await page.evaluate(n => { const v = DB.variants.find(x => x.sku === 'MSV-SW-130-BLK-R'); postMovement(DB, v.id, { type: 'adjustment', change: n, reason: 'Stock Count Correction' }); persist(); }, q - 2);
  });
  await check('reversal reduces stock, keeps the original and records its own movements', async () => {
    await page.goto(FILE + '#purchase-' + purId);
    const b1 = await qty('MSV-FH-123-BLK-R'), b2 = await qty('MSV-SW-130-BLK-R');
    await page.click(`[data-action=reversePurchase][data-id="${purId}"]`);
    await save();
    ok((await formText()).includes('Choose a reason'), 'reason required');
    await page.selectOption('#mForm [name=reason]', 'Recorded in error');
    await save();
    ok((await toastText()).includes('Purchase reversed successfully'));
    eq(await qty('MSV-FH-123-BLK-R'), b1 - 20); eq(await qty('MSV-SW-130-BLK-R'), b2 - 5);
    const d = await db(), p = d.purchases.find(x => x.id === purId), ms = d.movements.filter(m => m.purchaseId === purId);
    eq(p.status, 'Reversed');
    eq(ms.filter(m => m.type === 'purchase').length, 2, 'original movements kept');
    eq(ms.filter(m => m.type === 'purchase_reversal').length, 2, 'reversal movements');
    ok(ms.filter(m => m.type === 'purchase_reversal').every(m => m.change < 0));
    ok((await page.textContent('#app')).includes(purNo), 'purchase still visible');
    ok(!(await page.$('[data-action=reversePurchase]')), 'cannot reverse twice');
  });
  await check('ordered purchases can be cancelled without touching stock', async () => {
    const d = await db(), b = d.purchases.find(x => x.status === 'Draft' && x.lines.some(l => d.variants.find(v => v.id === l.variantId).sku === 'MSV-BU-125-BLK-R'));
    const q = await qty('MSV-BU-125-BLK-R');
    await page.goto(FILE + '#purchase-' + b.id);
    await page.click(`[data-action=orderPurchase][data-id="${b.id}"]`);
    await page.click(`[data-action=cancelPurchase][data-id="${b.id}"]`);
    await page.selectOption('#mForm [name=reason]', 'Ordered by mistake');
    await save();
    eq((await db()).purchases.find(x => x.id === b.id).status, 'Cancelled'); eq(await qty('MSV-BU-125-BLK-R'), q);
  });

  console.log('Dashboard');
  await check('recent purchases, activity and inventory metrics', async () => {
    await page.goto(FILE + '#dashboard');
    const t = await page.textContent('#app');
    ok(t.includes(purNo), 'recent purchases');
    ok(t.includes(`Received ${purNo} from MSV Asia Logistics`) || t.includes(`Purchase ${purNo} reversed`), 'activity');
    ok(t.includes(`Purchase ${purNo} reversed`), 'reversal in activity');
    const live = await page.evaluate(() => ({ v: Math.round(totals().value), u: totals().units, a: attention().length }));
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.replace(/\s+/g, '')));
    eq(k[2], 'SGD' + live.v.toLocaleString('en-SG'));
    const strip = await page.$$eval('.stat-strip > div b', e => e.map(x => +x.innerText.replace(/\D/g, ''))); eq(strip[0] + strip[1], live.a, 'low + out of stock'); eq(strip[5], live.u, 'units in stock');
  });
  await check('every stock quantity equals the sum of its movements', async () => {
    const bad = await page.evaluate(() => DB.variants.filter(v => DB.movements.filter(m => m.variantId === v.id).reduce((a, m) => a + m.change, 0) !== v.qty).map(v => v.sku));
    eq(bad.length, 0, bad.join());
  });
  await check('data survives a reload', async () => {
    const n = (await db()).purchases.length; await page.reload(); eq((await db()).purchases.length, n);
  });
  await check('no script errors', async () => eq(errors.length, 0, errors.join(' | ')));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
