// Phase 5 checklist (stock ledger, returns, adjustments, stock count, audit trail, reports), run in a real browser against index.html.
// Usage: node tests/phase5.spec.js   (needs the `playwright` package and Chromium)
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
  await page.goto(FILE + '#movements');
  await page.waitForSelector('#movTable table');

  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const toastText = () => page.textContent('#toastRoot');
  const qty = sku => page.evaluate(s => DB.variants.find(v => v.sku === s).qty, sku);
  const vid = sku => page.evaluate(s => DB.variants.find(v => v.sku === s).id, sku);
  const save = () => page.click('.modal-foot [data-action=save]');
  const closeModal = () => page.click('.modal-foot [data-action=close]');
  const formText = () => page.textContent('#mForm');
  const issues = () => page.evaluate(() => ledgerCheck().length);
  const lastMove = sku => page.evaluate(s => { const v = DB.variants.find(x => x.sku === s); return JSON.parse(JSON.stringify(DB.movements.filter(m => m.variantId === v.id).sort((a, b) => a.seq - b.seq).pop())); }, sku);
  const monthNet = () => page.evaluate(() => { const t = todayISO(); return salesStats(completedBetween(monthStart(t), t), returnsBetween(monthStart(t), t)); });

  // A completed sale of 10 reels to return against (sales UI itself is covered by the Phase 4 test).
  const saleId = await page.evaluate(() => {
    const v = DB.variants.find(x => x.sku === 'MSV-FH-118-BLK-R');
    let s; transact(() => { s = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Completed', payment: 'Paid', lines: [{ variantId: v.id, qty: 10, unitPrice: 120, discount: 0 }], charges: emptyCharges() }); completeSale(DB, s, { date: todayISO() }); });
    persist(); return s.id;
  });
  const saleNo = (await db()).sales.find(s => s.id === saleId).no;

  console.log('Stock movements');
  await check('movement IDs are unique and permanent', async () => {
    const d = await db(); const refs = d.movements.map(m => m.ref);
    eq(new Set(refs).size, refs.length, 'unique'); ok(refs.every(r => /^MOV-\d{4}-\d{6}$/.test(r)), 'format');
    ok(d.movements.every(m => m.by), 'every movement has Created By');
  });
  await check('previous and new quantities chain and add up to stock (no discrepancies)', async () => eq(await issues(), 0));
  await check('movement records cannot be edited', async () => {
    const res = await page.evaluate(() => { const m = DB.movements[0], before = m.change; try { m.change = 999; m.newQty = 999; } catch (e) {} return { frozen: Object.isFrozen(m), same: m.change === before }; });
    ok(res.frozen && res.same, 'frozen');
    const m = (await db()).movements[3];
    await page.goto(FILE + '#movement-' + m.id);
    const t = await page.textContent('#app');
    ok(t.includes("This movement can't be edited") && t.includes(m.ref) && t.includes('Created at'));
    ok(!(await page.$('[data-action^=edit]')), 'no edit action');
  });
  await check('movement detail links to the sale that caused it', async () => {
    const m = (await db()).movements.find(x => x.saleId === saleId);
    await page.goto(FILE + '#movement-' + m.id);
    await page.click(`a[href="#sale-${saleId}"]`); await page.waitForTimeout(50);
    ok(page.url().includes('#sale-' + saleId));
  });
  await check('ledger page shows type, direction, references and created by', async () => {
    await page.goto(FILE + '#movements');
    await page.fill('#movQ', saleNo);
    const cells = await page.$$eval('#movTable tbody tr:first-child td', t => t.map(x => x.innerText.trim()));
    ok(/^MOV-/.test(cells[1]) && cells[2] === 'Sale' && cells[4] === '−10' && cells[7] === saleNo && cells[8] === 'Kallang Tennis Hub' && cells[10] === 'Jasmine Koh', cells.join(' | '));
    await page.fill('#movQ', '');
  });

  console.log('Customer returns');
  let retId, retNo;
  await check('creates a partial resellable return from the original sale', async () => {
    const b = await qty('MSV-FH-118-BLK-R'), net0 = (await monthNet()).total;
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`[data-action=createReturn][data-id="${saleId}"]`);
    await page.fill('#mForm [data-r=qty]', '3');
    eq(await page.inputValue('#mForm [data-r=condition]'), 'Resellable');
    await save();
    ok((await formText()).includes('Choose a reason'), 'reason required');
    await page.selectOption('#mForm [name=reason]', 'Customer Changed Mind');
    await save();
    ok((await toastText()).includes('Return completed successfully'));
    eq(await qty('MSV-FH-118-BLK-R'), b + 3, 'stock +3');
    const d = await db(), r = d.returns.slice(-1)[0]; retId = r.id; retNo = r.no;
    ok(/^RET-\d{4}-\d{4}$/.test(r.no)); eq(r.saleId, saleId); eq(r.status, 'Completed'); eq(r.lines[0].qty, 3);
    const s = d.sales.find(x => x.id === saleId); eq(s.lines[0].qty, 10, 'original sale unchanged'); eq(s.status, 'Completed');
    const m = await lastMove('MSV-FH-118-BLK-R'); eq(m.type, 'customer_return'); eq(m.change, 3); eq(m.reference, r.no); eq(m.saleId, saleId); eq(m.customerId, 'c-kth');
    near((await monthNet()).total, net0 - 360, 'net sales reduced by returned value');
  });
  await check('return appears on the original sale and links back', async () => {
    await page.goto(FILE + '#sale-' + saleId);
    ok((await page.textContent('#app')).includes(retNo));
    await page.goto(FILE + '#return-' + retId);
    ok((await page.textContent('#app')).includes(saleNo));
  });
  await check('cannot return more than sold after previous returns', async () => {
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`[data-action=createReturn][data-id="${saleId}"]`);
    ok((await page.textContent('#mForm tbody')).includes('3'), 'shows already returned');
    await page.fill('#mForm [data-r=qty]', '8');
    await page.selectOption('#mForm [name=reason]', 'Wrong Item');
    await save();
    ok((await formText()).includes('Cannot return more than quantity sold') && (await formText()).includes('at most 7 more'));
    const err = await page.evaluate(id => { try { createCustomerReturn(DB, { saleId: id, date: todayISO(), reason: 'x', lines: [{ saleLineId: DB.sales.find(s => s.id === id).lines[0].id, qty: 8, condition: 'Resellable', restock: true }] }); return 'no error'; } catch (e) { return e.message; } }, saleId);
    ok(err.includes('Cannot return more than quantity sold'), err);
    await closeModal();
  });
  await check('damaged returns are recorded but not added to saleable stock', async () => {
    const b = await qty('MSV-FH-118-BLK-R');
    await page.click(`[data-action=createReturn][data-id="${saleId}"]`);
    await page.fill('#mForm [data-r=qty]', '2');
    await page.selectOption('#mForm [data-r=condition]', 'Damaged');
    ok(await page.$eval('#mForm [data-r=restock]', c => c.disabled && !c.checked), 'restock disabled for damaged');
    await page.selectOption('#mForm [name=reason]', 'Defective');
    await save();
    eq(await qty('MSV-FH-118-BLK-R'), b, 'stock unchanged');
    const m = await lastMove('MSV-FH-118-BLK-R'); eq(m.type, 'damaged_return'); eq(m.change, 0); eq(m.unitsNoted, 2);
    const r = (await db()).returns.slice(-1)[0]; eq(r.lines[0].restock, false); eq(r.lines[0].condition, 'Damaged');
    ok((await page.textContent('.stat-strip')).includes('Not Restocked'));
  });
  await check('a draft return does not change stock until completed', async () => {
    const b = await qty('MSV-FH-118-BLK-R');
    await page.goto(FILE + '#sale-' + saleId);
    await page.click(`[data-action=createReturn][data-id="${saleId}"]`);
    await page.fill('#mForm [data-r=qty]', '1'); await page.selectOption('#mForm [name=reason]', 'Shipping Error'); await page.selectOption('#mForm [name=status]', 'Draft');
    await save();
    eq(await qty('MSV-FH-118-BLK-R'), b);
    const r = (await db()).returns.slice(-1)[0]; eq(r.status, 'Draft');
    await page.click(`[data-action=completeReturn][data-id="${r.id}"]`);
    ok((await formText()).includes('Expected New Stock'), 'confirmation shows expected stock');
    await save();
    eq(await qty('MSV-FH-118-BLK-R'), b + 1);
    await page.evaluate(id => openCompleteReturn(id), r.id);
    ok((await toastText()).includes('already been completed'));
  });
  await check('a completed return can be reversed safely', async () => {
    const b = await qty('MSV-FH-118-BLK-R');
    await page.goto(FILE + '#return-' + retId);
    await page.click(`[data-action=reverseReturn][data-id="${retId}"]`);
    ok((await formText()).includes('Expected New Stock'));
    await page.fill('#mForm [name=reason]', 'Entered against the wrong sale'); await save();
    eq(await qty('MSV-FH-118-BLK-R'), b - 3);
    const d = await db(); eq(d.returns.find(r => r.id === retId).status, 'Reversed');
    const ms = d.movements.filter(m => m.returnId === retId); eq(ms.map(m => m.type).join(), 'customer_return,customer_return_reversal', 'both movements kept');
  });
  await check('sale reversal is blocked while it has completed returns', async () => {
    const err = await page.evaluate(id => { try { reverseSale(DB, DB.sales.find(s => s.id === id), { date: todayISO(), reason: 'x' }); return 'no error'; } catch (e) { return e.message; } }, saleId);
    ok(err.includes('completed customer returns'), err);
  });

  console.log('Supplier returns');
  let sretId;
  await check('creates a supplier return from the original purchase and reduces stock', async () => {
    const p = (await db()).purchases.find(x => x.no === 'PUR-2026-0001');
    const b = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#purchase-' + p.id);
    await page.click(`[data-action=returnToSupplier][data-id="${p.id}"]`);
    await page.fill('#mForm tbody tr:nth-child(1) [data-r=qty]', '2');
    await page.selectOption('#mForm [name=reason]', 'Quality Issue');
    await save();
    ok((await toastText()).includes('Supplier return completed'));
    eq(await qty('MSV-FH-123-BLK-R'), b - 2);
    const d = await db(), r = d.supplierReturns.slice(-1)[0]; sretId = r.id;
    ok(/^SRET-\d{4}-\d{4}$/.test(r.no)); eq(r.purchaseId, p.id); eq(r.supplierId, 's-msv');
    const m = await lastMove('MSV-FH-123-BLK-R'); eq(m.type, 'supplier_return'); eq(m.change, -2); eq(m.purchaseId, p.id); eq(m.supplierId, 's-msv'); eq(m.reference, r.no);
    await page.goto(FILE + '#purchase-' + p.id); ok((await page.textContent('#app')).includes(r.no), 'shown on purchase');
  });
  await check('cannot return more than received, after previous supplier returns', async () => {
    const p = (await db()).purchases.find(x => x.no === 'PUR-2026-0001');
    const line = p.lines.find(l => l.qty === 60);
    const err = await page.evaluate(([pid, lid]) => { try { const r = createSupplierReturn(DB, { purchaseId: pid, date: todayISO(), reason: 'x', lines: [{ purchaseLineId: lid, qty: 55 }] }); return 'no error'; } catch (e) { return e.message; } }, [p.id, line.id]);
    ok(err.includes('Cannot return more than quantity purchased'), err);
  });
  await check('cannot return more than is in stock', async () => {
    const p = (await db()).purchases.find(x => x.no === 'PUR-2026-0002'), q = await qty('MSV-OG-WHT-3P');
    await page.evaluate(n => { const v = DB.variants.find(x => x.sku === 'MSV-OG-WHT-3P'); postMovement(DB, v.id, { type: 'lost', change: -n, reason: 'Lost Stock', notes: 'test' }); persist(); }, q - 2);
    await page.goto(FILE + '#purchase-' + p.id);
    await page.click(`[data-action=returnToSupplier][data-id="${p.id}"]`);
    eq(await page.getAttribute('#mForm [data-r=qty]', 'max'), '2', 'max limited by stock');
    const err = await page.evaluate(id => { const p = DB.purchases.find(x => x.id === id); try { transact(() => { const r = createSupplierReturn(DB, { purchaseId: id, date: todayISO(), reason: 'x', lines: [{ purchaseLineId: p.lines[0].id, qty: 5 }] }); completeSupplierReturn(DB, r, { date: todayISO() }); }); return 'no error'; } catch (e) { return e.message; } }, p.id);
    ok(err.includes('Insufficient inventory for supplier return'), err);
    await closeModal();
  });
  await check('supplier return reversal restores stock and keeps both records', async () => {
    const b = await qty('MSV-FH-123-BLK-R');
    await page.goto(FILE + '#sreturn-' + sretId);
    await page.click(`[data-action=reverseSReturn][data-id="${sretId}"]`);
    await page.fill('#mForm [name=reason]', 'Supplier refused'); await save();
    eq(await qty('MSV-FH-123-BLK-R'), b + 2);
    eq((await db()).movements.filter(m => m.supplierReturnId === sretId).map(m => m.type).join(), 'supplier_return,supplier_return_reversal');
  });
  await check('purchase reversal is blocked while it has completed supplier returns', async () => {
    const p = (await db()).purchases.find(x => x.no === 'PUR-2026-0001');
    const err = await page.evaluate(id => { try { reversePurchase(DB, DB.purchases.find(x => x.id === id), { date: todayISO(), reason: 'x' }); return 'no error'; } catch (e) { return e.message; } }, p.id);
    ok(err.includes('completed supplier returns'), err);
  });

  console.log('Adjustments');
  await check('increase, decrease and set exact create typed movements; reason and notes required; no negatives', async () => {
    const id = await vid('MSV-BU-125-BLK-R'), b = await qty('MSV-BU-125-BLK-R');
    await page.goto(FILE + '#variant-' + id);
    const adj = async (type, q, reason, notes) => { await page.click(`.page-head [data-action=adjust][data-id="${id}"]`); await page.click(`[data-adjtype=${type}]`); await page.fill('#mForm [name=qty]', String(q)); if (reason) await page.selectOption('#mForm [name=reason]', reason); if (notes) await page.fill('#mForm [name=notes]', notes); await save(); };
    await adj('decrease', 1);
    const t = await formText(); ok(t.includes('Choose a reason') && t.includes('Add a short note'), 'reason and notes required'); await closeModal();
    await adj('decrease', b + 5, 'Lost Stock', 'test'); ok((await formText()).includes('negative inventory')); await closeModal();
    await adj('increase', 4, 'Data Correction', 'Found extra'); eq(await qty('MSV-BU-125-BLK-R'), b + 4); eq((await lastMove('MSV-BU-125-BLK-R')).type, 'adjustment');
    await adj('decrease', 1, 'Sample / Giveaway', 'Coach demo'); eq((await lastMove('MSV-BU-125-BLK-R')).type, 'sample');
    await adj('set', 40, 'Lost Stock', 'Shrinkage'); eq(await qty('MSV-BU-125-BLK-R'), 40); const m = await lastMove('MSV-BU-125-BLK-R'); eq(m.type, 'lost'); eq(m.change, 40 - (b + 3));
  });

  console.log('Stock count');
  await check('system qty, physical count and variance; confirmation creates a correction', async () => {
    const a = await vid('MSV-SW-125-BLK-R'), c = await vid('MSV-CF-123-RED-R'), qa = await qty('MSV-SW-125-BLK-R'), qc = await qty('MSV-CF-123-RED-R');
    await page.goto(FILE + '#stockcount');
    eq((await page.$$eval(`[data-cntrow="${a}"] td`, t => t[2].innerText.trim())), String(qa), 'system qty');
    await page.fill(`[data-count="${a}"]`, String(qa - 2));
    eq((await page.textContent(`[data-var="${a}"]`)).trim(), '−2');
    await page.fill(`[data-count="${c}"]`, String(qc));
    ok((await page.textContent(`[data-var="${c}"]`)).includes('matches'));
    await page.click('[data-action=applyCounts]');
    ok((await formText()).includes('Variance'));
    await save(); ok((await formText()).includes('Add a note'), 'notes required');
    await page.fill('#mForm [name=notes]', 'Shelf count by Jasmine'); await save();
    ok((await toastText()).includes('Stock count applied'));
    eq(await qty('MSV-SW-125-BLK-R'), qa - 2); eq(await qty('MSV-CF-123-RED-R'), qc);
    const d = await db(), cnt = d.counts.slice(-1)[0];
    eq(cnt.lines.length, 2); eq(cnt.lines.find(l => l.variantId === a).variance, -2);
    const m = await lastMove('MSV-SW-125-BLK-R'); eq(m.type, 'count'); eq(m.change, -2); eq(m.reference, cnt.no);
  });

  console.log('Audit trail');
  await check('important actions create readable audit entries that link to records', async () => {
    const acts = (await db()).audit.map(a => a.action);
    for (const a of ['Sale completed', 'Return created', 'Return completed', 'Return reversed', 'Supplier return completed', 'Stock adjusted', 'Stock count applied', 'Purchase received']) ok(acts.includes(a), 'missing: ' + a);
    ok((await db()).audit.every(a => a.user && a.at && a.entity), 'fields');
    await page.goto(FILE + '#audit');
    await page.fill('#audQ', retNo);
    ok((await page.textContent('#app')).includes('Return reversed'));
    await page.click(`#app tbody a[href="#return-${retId}"]`); await page.waitForTimeout(50);
    ok(page.url().includes('#return-' + retId));
  });

  console.log('Ledger, filters and reports');
  await check('running balance on the variant page matches stock', async () => {
    const id = await vid('MSV-FH-118-BLK-R'), q = await qty('MSV-FH-118-BLK-R');
    await page.goto(FILE + '#variant-' + id); await page.click('[data-vtab="Stock Movement"]');
    const bal = await page.$$eval('.card tbody tr', trs => trs.map(tr => tr.cells[5].innerText.trim()));
    eq(bal[bal.length - 1], String(q)); ok((await page.textContent('#app')).includes(`Ledger balance ${q} = stock ${q}`));
    await page.selectOption('[data-vmfilter=type]', 'customer_return');
    eq((await page.$$('.card tbody tr')).length, (await db()).movements.filter(m => m.variantId === id && m.type === 'customer_return').length, 'filter by type');
  });
  await check('stock movements search and filters', async () => {
    await page.goto(FILE + '#movements');
    const rows = () => page.$$eval('#movTable tbody tr', t => t.length);
    await page.fill('#movQ', retNo); eq(await rows(), 2, 'by return number');
    await page.fill('#movQ', ''); await page.selectOption('[data-mfilter=type]', 'supplier_return');
    ok((await page.$$eval('#movTable tbody tr td:nth-child(3)', t => t.every(x => x.innerText.trim() === 'Supplier Return'))), 'type');
    await page.selectOption('[data-mfilter=supplier]', 's-formosa'); eq(await rows(), 0, 'supplier filter');
    await page.click('[data-action=resetMov]');
    await page.selectOption('[data-mfilter=dir]', 'in');
    ok((await page.$$eval('#movTable tbody tr td:nth-child(5)', t => t.every(x => x.innerText.trim().startsWith('+')))), 'positive only');
    await page.selectOption('[data-mfilter=customer]', 'c-kth'); await page.fill('[data-mfilter=from]', await page.evaluate(() => todayISO()));
    ok(await rows() >= 2);
    await page.click('[data-action=resetMov]');
  });
  await check('CSV export follows the current filters', async () => {
    await page.selectOption('[data-mfilter=type]', 'count');
    const csv = await page.evaluate(() => exportMovementsCSV());
    const lines = csv.trim().split('\r\n'); ok(lines[0].includes('Movement ID') && lines[0].includes('Created By'));
    eq(lines.length - 1, (await db()).movements.filter(m => m.type === 'count').length);
    await page.click('[data-action=resetMov]');
  });
  await check('inventory movements report totals and breakdown are correct', async () => {
    await page.goto(FILE + '#reports'); await page.selectOption('#period', 'This Year'); await page.click('[data-rtab="Stock Movements"]');
    const exp = await page.evaluate(() => { const t = todayISO(), f = t.slice(0, 4) + '-01-01', ms = DB.movements.filter(m => m.date >= f && m.date <= t); const i = ms.filter(m => m.change > 0).reduce((a, m) => a + m.change, 0), o = ms.filter(m => m.change < 0).reduce((a, m) => a - m.change, 0); return { i, o, n: i - o }; });
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.replace(/\s+/g, '')));
    eq(k[1], '+' + exp.i.toLocaleString('en-SG')); eq(k[2], '−' + exp.o.toLocaleString('en-SG'));
    const t = await page.textContent('#app'); ok(t.includes('Customer Returns') && t.includes('Supplier Returns') && t.includes('Stock Count Corrections') && t.includes('Closing Stock') && t.includes('Reconciles'));
  });
  await check('sales report separates gross sales, returns and net sales', async () => {
    await page.click('[data-rtab="Sales"]');
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.replace(/\s+/g, '')));
    const st = await page.evaluate(() => { const t = todayISO(); const f = t.slice(0, 4) + '-01-01'; return salesStats(completedBetween(f, t), returnsBetween(f, t)); });
    eq(k[0], 'SGD' + Math.round(st.gross).toLocaleString('en-SG')); eq(k[1], 'SGD' + Math.round(st.returns).toLocaleString('en-SG')); eq(k[2], 'SGD' + Math.round(st.total).toLocaleString('en-SG'));
    near(st.total, st.gross - st.returns);
  });
  await check('gross profit after returns: resellable returns reverse COGS', async () => {
    const r = (await db()).returns.find(x => x.status === 'Completed' && x.lines[0].restock && x.saleId === saleId);
    const t = await page.evaluate(id => returnTotals(DB.returns.find(x => x.id === id)), r.id);
    near(t.revBase, 120); near(t.cogs, 82); near(t.gpImpact, -38);
  });

  console.log('Integrity');
  await check('a discrepancy is detected and shown, not silently corrected', async () => {
    await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-ST-130-WHT-S').qty += 5; persist(); });
    await page.goto(FILE + '#movements');
    const t = await page.textContent('#app'); ok(t.includes('Inventory discrepancy detected') && t.includes('MSV-ST-130-WHT-S'));
    await page.goto(FILE + '#dashboard'); ok((await page.textContent('#app')).includes('Inventory discrepancy detected'));
    eq(await issues(), 1, 'still there'); await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-ST-130-WHT-S').qty -= 5; persist(); });
    eq(await issues(), 0);
  });
  await check('every stock-changing action created a movement (ledger explains all stock)', async () => {
    eq(await issues(), 0);
    const d = await db(); ok(d.variants.every(v => d.movements.filter(m => m.variantId === v.id).reduce((a, m) => a + m.change, 0) === v.qty));
  });
  await check('data survives a reload', async () => { const n = (await db()).movements.length; await page.reload(); eq((await db()).movements.length, n); eq(await issues(), 0); });
  await check('no script errors', async () => eq(errors.length, 0, errors.join(' | ')));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
