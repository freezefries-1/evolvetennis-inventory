// Phase 4 checklist (customers, sales, stock out, gross profit, reversal, dashboard), run in a real browser against index.html.
// Usage: node tests/phase4.spec.js   (needs the `playwright` package and Chromium)
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
const near = (a, b, msg) => { if (Math.abs(a - b) > 0.005) throw new Error(`${msg || 'expected'}: got ${a}, want ${b}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(FILE + '#customers');
  await page.waitForSelector('#app table');

  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const toastText = () => page.textContent('#toastRoot');
  const qty = sku => page.evaluate(s => DB.variants.find(v => v.sku === s).qty, sku);
  const vid = sku => page.evaluate(s => DB.variants.find(v => v.sku === s).id, sku);
  const save = () => page.click('.modal-foot [data-action=save]');
  const closeModal = () => page.click('.modal-foot [data-action=close]');
  const formText = () => page.textContent('#mForm');
  const openSale = async () => { await page.goto(FILE + '#sales'); await page.click('.page-head [data-action=sale]'); };
  async function item(n, query, sku) {
    const row = `#sLines [data-sline]:nth-child(${n}) `;
    if (n > 1 && !(await page.$(row))) await page.click('[data-action=addSLine]');
    await page.fill(row + '[data-l=search]', query);
    await page.click(`${row} .combo-list [data-opt="${await vid(sku)}"]`);
    return row;
  }
  const totalsOf = id => page.evaluate(i => { const t = saleTotals(DB.sales.find(s => s.id === i)); return { rev: t.revBase, cogs: t.cogs, gp: t.gp, total: t.total, sub: t.sub }; }, id);
  let saleId, saleNo, aceId;

  console.log('Customers');
  await check('creates a customer', async () => {
    await page.click('[data-action=addCustomer]');
    await page.fill('#mForm [name=name]', 'Ace Tennis Academy');
    await page.selectOption('#mForm [name=type]', 'Tennis Academy');
    await page.fill('#mForm [name=country]', 'Malaysia');
    await page.selectOption('#mForm [name=currency]', 'MYR');
    await page.fill('#mForm [name=contact]', 'Aisha Rahman');
    await save();
    ok((await toastText()).includes('Customer created successfully'));
    const c = (await db()).customers.find(x => x.name === 'Ace Tennis Academy');
    ok(c && c.type === 'Tennis Academy' && c.country === 'Malaysia' && c.currency === 'MYR');
    aceId = c.id;
  });
  await check('requires a customer name', async () => {
    await page.goto(FILE + '#customers'); await page.click('[data-action=addCustomer]'); await save();
    ok((await formText()).includes('Customer name is required')); await closeModal();
  });
  await check('edits a customer', async () => {
    await page.goto(FILE + '#customer-' + aceId);
    await page.click(`[data-action=editCustomer][data-id="${aceId}"]`);
    await page.fill('#mForm [name=phone]', '+60 3 1234 5678'); await save();
    eq((await db()).customers.find(x => x.id === aceId).phone, '+60 3 1234 5678');
    ok((await toastText()).includes('Customer updated successfully'));
  });
  await check('customer default country, currency and rate fill in on a new sale', async () => {
    await openSale();
    await page.selectOption('#mForm [name=customerId]', aceId);
    eq(await page.inputValue('#mForm [name=country]'), 'Malaysia');
    eq(await page.inputValue('#mForm [name=currency]'), 'MYR');
    eq(await page.inputValue('#mForm [name=fxRate]'), '0.29');
    await page.selectOption('#mForm [name=customerId]', 'c-kth');
    eq(await page.inputValue('#mForm [name=country]'), 'Singapore'); eq(await page.inputValue('#mForm [name=currency]'), 'SGD');
    ok(!(await page.isVisible('#mForm [name=fxRate]')), 'no rate for SGD');
    await closeModal();
  });
  await check('deactivated customers are not offered on new sales', async () => {
    await page.goto(FILE + '#customer-c-stan');
    await page.click('[data-action=toggleCustomer][data-id="c-stan"]');
    ok((await toastText()).includes('Customer deactivated'));
    await openSale();
    ok(!(await page.$$eval('#mForm [name=customerId] option', o => o.map(x => x.value))).includes('c-stan'));
    await closeModal();
  });

  console.log('Sales');
  await check('validates customer, items, quantity, price and discounts', async () => {
    await openSale(); await save();
    ok((await formText()).includes('Add at least one product'), 'needs items');
    const r = await item(1, 'focus hex 1.23 black reel', 'MSV-FH-123-BLK-R');
    await page.fill(r + '[data-l=qty]', '0'); await page.fill(r + '[data-l=price]', '-5'); await page.fill('#mForm [name=date]', '');
    await save();
    let t = await formText();
    for (const m of ['Choose a customer', 'Sale date is required', 'greater than 0', 'Selling price cannot be negative']) ok(t.includes(m), 'missing: ' + m);
    await page.selectOption('#mForm [name=customerId]', 'c-kth'); await page.fill('#mForm [name=date]', '2026-10-09');
    await page.fill(r + '[data-l=qty]', '1'); await page.fill(r + '[data-l=price]', '100'); await page.fill(r + '[data-l=disc]', '150');
    await save();
    ok((await formText()).includes('Discount cannot be more than the line amount'));
    await page.fill(r + '[data-l=disc]', ''); await page.fill('#mForm [name=ch_discount]', '500');
    await save();
    ok((await formText()).includes('Order discount cannot be more than the subtotal'));
    await closeModal();
  });
  await check('creates a draft with multiple items, discounts and charges', async () => {
    const before = [await qty('MSV-FH-123-BLK-R'), await qty('MSV-SW-125-BLK-R')];
    await openSale();
    await page.selectOption('#mForm [name=customerId]', 'c-kth');
    await page.fill('#mForm [name=reference]', 'KTH-PO-777');
    await page.fill('#mForm [name=notes]', 'Deliver to academy front desk');
    const r1 = await item(1, 'MSV-FH-123-BLK-R', 'MSV-FH-123-BLK-R');
    ok((await page.textContent(r1 + '[data-l=meta]')).includes(`Available: ${before[0]}`), 'shows available stock');
    await page.fill(r1 + '[data-l=qty]', '5'); await page.fill(r1 + '[data-l=price]', '120');
    eq((await page.textContent(r1 + '[data-l=total]')).trim(), 'SGD 600.00');
    const r2 = await item(2, 'swift 1.25 black reel', 'MSV-SW-125-BLK-R');
    await page.fill(r2 + '[data-l=qty]', '2'); await page.fill(r2 + '[data-l=price]', '115'); await page.fill(r2 + '[data-l=disc]', '10');
    eq((await page.textContent(r2 + '[data-l=total]')).trim(), 'SGD 220.00');
    await page.fill('#mForm [name=ch_discount]', '20'); await page.fill('#mForm [name=ch_shipping]', '15'); await page.fill('#mForm [name=ch_other]', '5'); await page.fill('#mForm [name=otherDesc]', 'Courier');
    const sum = (await page.textContent('#sSum')).replace(/\s+/g, ' ');
    ok(sum.includes('SGD 830.00') && sum.includes('−SGD 30.00') && sum.includes('SGD 20.00') && sum.includes('SGD 820.00'), sum);
    await save();
    ok((await toastText()).includes('Sale saved as draft'));
    const s = (await db()).sales.find(x => x.reference === 'KTH-PO-777');
    saleId = s.id; saleNo = s.no;
    eq(s.status, 'Draft'); eq(s.lines.length, 2);
    eq([await qty('MSV-FH-123-BLK-R'), await qty('MSV-SW-125-BLK-R')].join(), before.join(), 'draft does not change stock');
    const t = await totalsOf(saleId); eq(t.total, 820); eq(t.sub, 820);
  });
  await check('sale numbers are unique, sequential and never reused', async () => {
    const seeded = (await db()).sales.length;
    eq(saleNo, 'SAL-2026-' + String(seeded).padStart(4, '0'));
    const mk = async () => { await openSale(); await page.selectOption('#mForm [name=customerId]', 'c-kth'); const r = await item(1, 'MSV-OG-BLK', 'MSV-OG-BLK-3P'); await page.fill(r + '[data-l=qty]', '1'); await page.fill(r + '[data-l=price]', '6.9'); await save(); return (await db()).sales.slice(-1)[0]; };
    const a = await mk(); eq(a.no, 'SAL-2026-' + String(seeded + 1).padStart(4, '0'));
    await page.click(`[data-action=deleteSale][data-id="${a.id}"]`); await save();
    ok(!(await db()).sales.some(x => x.id === a.id), 'draft deleted');
    const b = await mk(); eq(b.no, 'SAL-2026-' + String(seeded + 2).padStart(4, '0'), 'deleted number not reused');
    const nos = (await db()).sales.map(x => x.no); eq(new Set(nos).size, nos.length);
  });
  await check('identical duplicate lines are combined', async () => {
    await openSale(); await page.selectOption('#mForm [name=customerId]', 'c-tta');
    const r1 = await item(1, 'MSV-BU-125-BLK-R', 'MSV-BU-125-BLK-R'); await page.fill(r1 + '[data-l=qty]', '1'); await page.fill(r1 + '[data-l=price]', '118');
    const r2 = await item(2, 'MSV-BU-125-BLK-R', 'MSV-BU-125-BLK-R'); await page.fill(r2 + '[data-l=qty]', '2'); await page.fill(r2 + '[data-l=price]', '118');
    ok((await page.textContent(r2 + '[data-l=warn]')).includes('Same SKU as item 1'));
    await save();
    const s = (await db()).sales.slice(-1)[0]; eq(s.lines.length, 1); eq(s.lines[0].qty, 3);
  });
  await check('warns when quantity is more than available and blocks completing', async () => {
    const have = await qty('MSV-SW-130-BLK-R');
    await openSale(); await page.selectOption('#mForm [name=customerId]', 'c-kth');
    await page.selectOption('#mForm [name=status]', 'Completed');
    const r = await item(1, 'MSV-SW-130-BLK-R', 'MSV-SW-130-BLK-R'); await page.fill(r + '[data-l=qty]', String(have + 10)); await page.fill(r + '[data-l=price]', '115');
    ok((await page.textContent(r + '[data-l=warn]')).includes(`Only ${have} units are currently available`), 'warning');
    await save();
    ok((await formText()).includes('Not enough stock to complete this sale'), 'blocked');
    eq(await qty('MSV-SW-130-BLK-R'), have);
    await page.selectOption('#mForm [name=status]', 'Confirmed'); await save();
    const s = (await db()).sales.slice(-1)[0]; eq(s.status, 'Confirmed');
    await page.click(`.page-head [data-action=completeSale][data-id="${s.id}"]`);
    ok((await formText()).includes('Not enough stock'), 'complete dialog warns');
    ok(await page.$eval('.modal-foot [data-action=save]', b => b.disabled), 'save disabled');
    const err = await page.evaluate(i => { try { transact(() => completeSale(DB, DB.sales.find(s => s.id === i), { date: todayISO() })); return 'no error'; } catch (e) { return e.message; } }, s.id);
    ok(err.includes(`Only ${have}`), err);
    eq(await qty('MSV-SW-130-BLK-R'), have); eq((await db()).sales.find(x => x.id === s.id).status, 'Confirmed', 'nothing half-done');
    await closeModal();
  });

  console.log('Inventory');
  await check('confirmed sale does not affect inventory', async () => {
    const b = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`[data-action=confirmSale][data-id="${saleId}"]`);
    ok((await toastText()).includes('Sale confirmed'));
    eq((await db()).sales.find(x => x.id === saleId).status, 'Confirmed'); eq(await qty('MSV-FH-123-BLK-R'), b);
  });
  await check('completing decreases inventory with one movement per line', async () => {
    const b1 = await qty('MSV-FH-123-BLK-R'), b2 = await qty('MSV-SW-125-BLK-R');
    await page.click(`.page-head [data-action=completeSale][data-id="${saleId}"]`);
    await save();
    ok((await toastText()).includes('Sale completed successfully') && (await toastText()).includes('7 units removed from inventory'));
    eq(await qty('MSV-FH-123-BLK-R'), b1 - 5); eq(await qty('MSV-SW-125-BLK-R'), b2 - 2);
    const ms = (await db()).movements.filter(m => m.saleId === saleId);
    eq(ms.length, 2); ok(ms.every(m => m.type === 'sale' && m.reference === saleNo && m.customerId === 'c-kth' && m.change < 0));
    const m1 = ms.find(m => m.sku === 'MSV-FH-123-BLK-R'); eq(m1.prevQty, b1); eq(m1.newQty, b1 - 5);
  });
  await check('completing only affects inventory once', async () => {
    const b = await qty('MSV-FH-123-BLK-R');
    ok(!(await page.$('.page-head [data-action=completeSale]')), 'no Complete button');
    const err = await page.evaluate(i => { try { completeSale(DB, DB.sales.find(s => s.id === i), { date: todayISO() }); return 'no error'; } catch (e) { return e.message; } }, saleId);
    ok(err.includes("can't be completed again"), err);
    await page.evaluate(i => openCompleteSale(i), saleId); ok((await toastText()).includes('Already completed'));
    await page.reload(); eq(await qty('MSV-FH-123-BLK-R'), b);
    eq((await db()).movements.filter(m => m.saleId === saleId).length, 2);
  });
  await check('inventory table updates', async () => {
    const q = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#inventory'); await page.fill('#invQ', 'MSV-FH-123-BLK-R');
    eq(await page.$$eval('#invTable tbody tr:first-child td', t => t[5].innerText.trim()), String(q));
  });
  await check('stock cannot drop below zero through the ledger', async () => {
    const err = await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-FH-127-BLK-R'); try { postMovement(DB, v.id, { type: 'sale', change: -(v.qty + 1) }); return 'no error'; } catch (e) { return e.message; } });
    ok(err.includes("can't remove"), err);
  });

  console.log('Financial data');
  await check('revenue, cost snapshot, COGS and gross profit', async () => {
    const s = (await db()).sales.find(x => x.id === saleId);
    const fh = s.lines.find(l => l.qty === 5), sw = s.lines.find(l => l.qty === 2);
    eq(fh.unitCost, 82); eq(sw.unitCost, 78);
    near((await totalsOf(saleId)).rev, 800, 'product revenue = 830 − 10 line discount − 20 order discount');
  });
  await check('gross profit = product revenue − COGS (800 − 566 = 234)', async () => {
    const t = await totalsOf(saleId); near(t.rev, 800); near(t.cogs, 566); near(t.gp, 234);
    const s = (await db()).sales.find(x => x.id === saleId);
    near(s.lines.reduce((a, l) => a + l.grossProfit, 0), 234, 'line snapshots'); near(s.lines.reduce((a, l) => a + l.cogs, 0), 566);
  });
  await check('historical profit does not change when the cost price changes', async () => {
    await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-FH-123-BLK-R').cost = 95; persist(); });
    near((await totalsOf(saleId)).gp, 234);
    await page.goto(FILE + '#sale-' + saleId);
    ok((await page.textContent('.stat-strip')).includes('SGD 234.00'));
    await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-FH-123-BLK-R').cost = 82; persist(); });
  });
  await check('a foreign-currency sale converts revenue to SGD at its own rate', async () => {
    await openSale(); await page.selectOption('#mForm [name=customerId]', aceId);
    await page.fill('#mForm [name=fxRate]', '0.3');
    await page.selectOption('#mForm [name=status]', 'Completed');
    const r = await item(1, 'hepta twist 1.27', 'MSV-HT-127-BLK-R'); await page.fill(r + '[data-l=qty]', '2'); await page.fill(r + '[data-l=price]', '400');
    await save();
    const s = (await db()).sales.slice(-1)[0]; eq(s.currency, 'MYR'); eq(s.fxRate, 0.3); eq(s.status, 'Completed');
    const t = await totalsOf(s.id); near(t.rev, 240); near(t.cogs, 176); near(t.gp, 64);
  });

  console.log('Customer and product history');
  await check('sale appears on the customer page with updated totals', async () => {
    await page.goto(FILE + '#customer-c-kth');
    const txt = await page.textContent('#app'); ok(txt.includes(saleNo));
    const st = await page.evaluate(() => { const c = DB.customers.find(x => x.id === 'c-kth'); const s = customerStats(c); return { count: s.count, last: s.last, total: s.total }; });
    ok((await page.textContent('.stat-strip')).includes(String(st.count)));
    eq(st.last, await page.evaluate(() => todayISO()), 'last purchase date');
  });
  await check('sale appears under the variant Sales tab and links to the sale', async () => {
    await page.goto(FILE + '#variant-' + await vid('MSV-FH-123-BLK-R'));
    await page.click('[data-vtab="Sales"]');
    ok((await page.textContent('#app')).includes(saleNo));
    await page.click(`[data-go="sale-${saleId}"]`); ok(page.url().includes('#sale-' + saleId));
  });
  await check('stock movement links to the sale', async () => {
    await page.goto(FILE + '#variant-' + await vid('MSV-FH-123-BLK-R'));
    await page.click('[data-vtab="Stock Movement"]');
    await page.click(`a[href="#sale-${saleId}"]`); await page.waitForTimeout(50);
    ok(page.url().includes('#sale-' + saleId));
  });

  console.log('Search and filters');
  await check('search by number, customer, product, SKU, country, reference and notes', async () => {
    await page.goto(FILE + '#sales');
    const n = async q => { await page.fill('#salQ', q); return page.$$eval('#salTable tbody tr td:first-child', t => t.map(x => x.innerText.trim())); };
    for (const q of [saleNo, 'kallang', 'swift 1.25', 'MSV-SW-125-BLK-R', 'KTH-PO-777', 'front desk']) ok((await n(q)).includes(saleNo), q);
    ok((await n('Malaysia')).length > 0, 'country'); eq((await n('zzz-none')).length, 0);
    await page.fill('#salQ', '');
  });
  await check('filters combine and reset', async () => {
    const all = (await page.$$('#salTable tbody tr')).length;
    await page.selectOption('[data-sfilter=customer]', 'c-kth');
    await page.selectOption('[data-sfilter=status]', 'Completed');
    await page.fill('[data-sfilter=from]', await page.evaluate(() => todayISO()));
    let rows = await page.$$eval('#salTable tbody tr td:first-child', t => t.map(x => x.innerText.trim()));
    ok(rows.includes(saleNo), 'found');
    await page.selectOption('[data-sfilter=currency]', 'MYR'); eq((await page.$$('#salTable tbody tr')).length, 0);
    await page.selectOption('[data-sfilter=currency]', ''); await page.selectOption('[data-sfilter=country]', 'Singapore'); await page.selectOption('[data-sfilter=payment]', 'Unpaid');
    await page.selectOption('[data-sfilter=product]', 'p-sw');
    rows = await page.$$eval('#salTable tbody tr td:first-child', t => t.map(x => x.innerText.trim())); ok(rows.includes(saleNo));
    await page.click('[data-action=resetSal]'); eq((await page.$$('#salTable tbody tr')).length, all);
  });
  await check('payment status updates separately', async () => {
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`.page-head [data-action=paySale][data-id="${saleId}"]`);
    await page.selectOption('#mForm [name=payment]', 'Paid'); await save();
    ok((await toastText()).includes('Payment status updated'));
    eq((await db()).sales.find(x => x.id === saleId).payment, 'Paid');
  });

  console.log('Dashboard');
  await check('dashboard sales figures use completed sales', async () => {
    await page.goto(FILE + '#dashboard');
    const live = await page.evaluate(() => { const t = todayISO(); const m = salesStats(completedBetween(monthStart(t), t)); return { total: Math.round(m.total) }; });
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.replace(/\s+/g, '')));
    eq(k[1], 'SGD' + live.total.toLocaleString('en-SG'));
    const txt = await page.textContent('#app');
    ok(txt.includes(saleNo), 'recent sales'); ok(txt.includes(`Sale ${saleNo} completed`), 'activity');
    ok(txt.includes('Sales by Country') && txt.includes('Singapore'), 'country card');
    ok(txt.includes('MSV Focus Hex'), 'top products');
  });
  await check('sales overview chart totals the completed sales in range', async () => {
    for (const r of ['Last 30 Days', '3 Months', '6 Months', '12 Months']) {
      await page.click(`[data-drange="${r}"]`);
      const exp = await page.evaluate(r => { const t = todayISO(); const f = DASH_RANGES[r](t); return Math.round(salesStats(completedBetween(f, t)).total); }, r);
      ok((await page.textContent('.card-head .sub')).includes('SGD ' + exp.toLocaleString('en-SG')), r);
    }
  });
  await check('top products can rank by units', async () => {
    await page.click('[data-dtop="Units"]'); ok((await page.textContent('#app')).includes(' units'));
  });

  console.log('Reversal');
  await check('reverses a completed sale, restores stock and keeps history', async () => {
    const t0 = await page.evaluate(() => { const t = todayISO(); return salesStats(completedBetween(monthStart(t), t)).total; });
    const b1 = await qty('MSV-FH-123-BLK-R'), b2 = await qty('MSV-SW-125-BLK-R');
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`[data-action=reverseSale][data-id="${saleId}"]`);
    await save(); ok((await formText()).includes('Choose a reason'), 'reason required');
    await page.selectOption('#mForm [name=reason]', 'Wrong customer'); await save();
    ok((await toastText()).includes('Sale reversed successfully'));
    eq(await qty('MSV-FH-123-BLK-R'), b1 + 5); eq(await qty('MSV-SW-125-BLK-R'), b2 + 2);
    const d = await db(), s = d.sales.find(x => x.id === saleId), ms = d.movements.filter(m => m.saleId === saleId);
    eq(s.status, 'Reversed'); eq(s.payment, 'Refunded', 'paid sale suggested as refunded');
    eq(ms.filter(m => m.type === 'sale').length, 2); eq(ms.filter(m => m.type === 'sale_reversal').length, 2);
    ok((await page.textContent('#app')).includes(saleNo), 'still visible');
    const t1 = await page.evaluate(() => { const t = todayISO(); return salesStats(completedBetween(monthStart(t), t)).total; });
    near(t1, t0 - 820, 'revenue excludes the reversed sale');
  });
  await check('confirmed sales can be cancelled without touching stock', async () => {
    const s = (await db()).sales.find(x => x.status === 'Confirmed' && x.lines.some(l => l.qty > 10));
    const q = await page.evaluate(i => DB.variants.find(v => v.id === i).qty, s.lines[0].variantId);
    await page.goto(FILE + '#sale-' + s.id);
    await page.click(`[data-action=cancelSale][data-id="${s.id}"]`); await page.selectOption('#mForm [name=reason]', 'Out of stock'); await save();
    eq((await db()).sales.find(x => x.id === s.id).status, 'Cancelled');
    eq(await page.evaluate(i => DB.variants.find(v => v.id === i).qty, s.lines[0].variantId), q);
  });

  console.log('Integrity');
  await check('purchases still add stock and the ledger shows the whole sequence', async () => {
    const p = (await db()).purchases.find(x => x.status === 'Ordered');
    const v = p.lines[0].variantId, b = await page.evaluate(i => DB.variants.find(x => x.id === i).qty, v);
    await page.goto(FILE + '#purchase-' + p.id); await page.click(`.page-head [data-action=receivePurchase][data-id="${p.id}"]`); await save();
    eq(await page.evaluate(i => DB.variants.find(x => x.id === i).qty, v), b + p.lines[0].qty);
    const types = await page.evaluate(() => [...new Set(DB.movements.map(m => m.type))].sort().join());
    eq(types, 'adjustment,opening,purchase,sale,sale_reversal');
  });
  await check('every stock quantity equals the sum of its movements', async () => {
    const bad = await page.evaluate(() => DB.variants.filter(v => DB.movements.filter(m => m.variantId === v.id).reduce((a, m) => a + m.change, 0) !== v.qty).map(v => v.sku));
    eq(bad.length, 0, bad.join());
  });
  await check('reports tabs render with live figures', async () => {
    await page.goto(FILE + '#reports');
    for (const t of ['Sales', 'Product Performance', 'Customers', 'Sales by Country', 'Gross Profit', 'Inventory', 'Purchases']) { await page.click(`[data-rtab="${t}"]`); ok(!(await page.textContent('#app')).includes('Sample data'), t); }
    await page.click('[data-range="This Year"]'); await page.click('[data-rtab="Sales by Country"]');
    ok((await page.textContent('#app')).includes('Malaysia'));
  });
  await check('no script errors', async () => eq(errors.length, 0, errors.join(' | ')));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
