// Phase 7 checklist (branding, expenses, capital equipment, other income, profitability, landed cost, reports, audit), run in a real browser against index.html.
// Expected figures are worked out here from the stored records, not through the app's own report code.
// Usage: node tests/phase7.spec.js   (needs the `playwright` package and Chromium)
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
const near = (a, b, msg, tol = 0.02) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || 'expected'}: got ${a}, want ${b}`); };
const num = s => +String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-');
const parseCSV = csv => csv.replace(/^﻿/, '').trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"')));

/* Independent profit calculation from raw records (runs in the page). */
const RAW = `(from,to)=>{
  const sales=DB.sales.filter(s=>s.status==='Completed'&&s.completedDate>=from&&s.completedDate<=to);
  const rets=DB.returns.filter(r=>r.status==='Completed'&&r.completedDate>=from&&r.completedDate<=to);
  let gross=0,cogs=0;
  sales.forEach(s=>{let sub=0;s.lines.forEach(l=>{sub+=l.qty*l.unitPrice-(+l.discount||0);cogs+=l.qty*l.unitCost});gross+=(sub-(+s.charges.discount||0)+(+s.charges.shipping||0)+(+s.charges.other||0))*s.fxRate});
  let rv=0,rc=0; rets.forEach(r=>r.lines.forEach(l=>{rv+=l.qty*l.unitRevenueBase;if(l.restock)rc+=l.qty*l.unitCost}));
  const live=x=>x.status!=='Cancelled'&&x.date>=from&&x.date<=to, sgd=x=>x.amount*(x.currency==='SGD'?1:x.fxRate);
  const opex=DB.expenses.filter(e=>live(e)&&e.type==='Operating Expense').reduce((a,e)=>a+sgd(e),0);
  const capex=DB.expenses.filter(e=>live(e)&&e.type==='Capital Equipment').reduce((a,e)=>a+sgd(e),0);
  const income=DB.incomes.filter(live).reduce((a,i)=>a+sgd(i),0);
  const net=gross-rv, c=cogs-rc, gp=net-c, nop=gp-opex+income;
  return {net,cogs:c,gp,margin:net?gp/net:NaN,opex,capex,income,nop,ncr:nop-capex};
}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.num = s => +String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-'); });
  await page.goto(FILE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(FILE + '#dashboard');
  await page.waitForSelector('.kpi');

  const raw = (from, to) => page.evaluate(([f, a, b]) => eval(f)(a, b), [RAW, from, to]);
  const range = () => page.evaluate(() => periodRange());
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const save = () => page.click('.modal-foot [data-action=save]');
  const toastText = () => page.textContent('#toastRoot');
  const kpis = () => page.$$eval('.kpi .kpi-value', e => e.map(x => num(x.innerText)));
  const strip = () => page.$$eval('.stat-strip > div b', e => e.map(x => num(x.innerText)));
  const csvOf = name => page.evaluate(n => exportReport(n), name).then(parseCSV);
  const stock = () => page.evaluate(() => ({ units: DB.variants.reduce((a, v) => a + v.qty, 0), moves: DB.movements.length }));
  const fin = () => page.evaluate(() => { const p = periodRange(); return finStats(p.from, p.to); });
  const openFin = async (tab) => { await page.goto(FILE + '#financials'); await page.click(`[data-ftab="${tab}"]`); };
  async function fillFin({ date, type, category, newCategory, status, description, party, method, amount, currency, fx, reference, attachment, notes }, kind = 'expense') {
    if (date) await page.fill('#mForm [name=date]', date);
    if (type) await page.selectOption('#mForm [name=type]', type);
    if (newCategory) { await page.selectOption('#mForm [name=category]', '__new'); await page.fill('#mForm [name=categoryNew]', newCategory); }
    else if (category) await page.selectOption('#mForm [name=category]', category);
    if (status) await page.selectOption('#mForm [name=status]', status);
    if (description) await page.fill('#mForm [name=description]', description);
    if (party) await page.fill(`#mForm [name=${kind === 'expense' ? 'payee' : 'source'}]`, party);
    if (method) await page.selectOption('#mForm [name=method]', method);
    if (amount != null) await page.fill('#mForm [name=amount]', String(amount));
    if (currency) { await page.selectOption('#mForm [name=currency]', currency); if (fx) await page.fill('#mForm [name=fxRate]', String(fx)); }
    if (reference) await page.fill('#mForm [name=reference]', reference);
    if (attachment) await page.fill('#mForm [name=attachment]', attachment);
    if (notes) await page.fill('#mForm [name=notes]', notes);
  }
  const today = await page.evaluate(() => todayISO());
  const stock0 = await stock();

  console.log('Branding');
  await check('the application is called Evolve Tennis System', async () => {
    ok((await page.title()).endsWith('Evolve Tennis System'), await page.title());
    const side = await page.textContent('.brand'); ok(side.includes('EVOLVE TENNIS') && side.includes('Management System'), side);
    ok((await page.textContent('.side-foot')).includes('Evolve Tennis System'));
  });
  await check('old inventory-system branding is gone; MSV product branding stays', async () => {
    for (const h of ['dashboard', 'products', 'settings', 'financials', 'reports']) {
      await page.goto(FILE + '#' + h); const t = await page.evaluate(() => document.body.innerText + ' ' + document.title);
      for (const old of ['Inventory Management', 'MSV Inventory', 'MSV Southeast Asia Inventory', 'Evolve Tennis Inventory']) ok(!t.includes(old), `${h}: ${old}`);
    }
    await page.goto(FILE + '#products'); ok((await page.textContent('#app')).includes('MSV Focus Hex'), 'products keep MSV names');
    ok((await db()).suppliers.some(s => s.name === 'MSV GmbH'), 'supplier names unchanged');
  });

  console.log('Expenses');
  let expId, capId;
  await check('an operating expense can be recorded, with a unique reference', async () => {
    await openFin('Expenses'); const before = (await db()).expenses.length;
    await page.click('.page-head [data-action=recordExpense]'); await save();
    const t = await page.textContent('#mForm'); ok(t.includes('Choose or add a category') && t.includes('Add a short description') && t.includes('greater than 0'), 'validation');
    await fillFin({ date: today, type: 'Operating Expense', category: 'Packaging', description: 'Test bubble wrap', party: 'Test Supplies', method: 'PayNow', amount: 123.45, reference: 'INV-T-1', attachment: 'https://example.com/receipt.pdf', notes: 'Phase 7 test' });
    await save(); ok((await toastText()).includes('Expense recorded'));
    const d = await db(), e = d.expenses.slice(-1)[0]; expId = e.id;
    eq(d.expenses.length, before + 1); ok(/^EXP-2026-\d{4}$/.test(e.no), e.no);
    eq(e.type + '|' + e.category + '|' + e.amount + '|' + e.method + '|' + e.status + '|' + e.attachment, 'Operating Expense|Packaging|123.45|PayNow|Paid|https://example.com/receipt.pdf');
    ok(page.url().endsWith('#expense-' + e.id), 'opens the expense');
    const t2 = await page.textContent('#app'); ok(t2.includes(e.no) && t2.includes('Test Supplies') && t2.includes('INV-T-1') && t2.includes('Created at') && t2.includes('Audit history'));
  });
  await check('capital equipment can be recorded, in another currency, with a new category', async () => {
    await page.click('.page-head [data-action=dupExpense]'); // duplicate first, then replace the details
    ok((await page.inputValue('#mForm [name=description]')) === 'Test bubble wrap', 'duplicate prefills');
    await fillFin({ type: 'Capital Equipment', newCategory: 'Test Machinery', description: 'Test grommet press', party: 'Machine Co', amount: 500, currency: 'USD', fx: 1.3 });
    await save(); ok((await toastText()).includes('Capital equipment recorded'));
    const d = await db(), e = d.expenses.slice(-1)[0]; capId = e.id;
    eq(e.type, 'Capital Equipment'); eq(e.currency + '|' + e.fxRate, 'USD|1.3'); ok(d.expenseCategories.includes('Test Machinery'), 'custom category saved');
    ok((await page.textContent('.stat-strip')).includes('SGD 650.00'), 'shown in SGD');
  });
  await check('expense references are unique and searchable', async () => {
    const nos = (await db()).expenses.map(e => e.no); eq(new Set(nos).size, nos.length);
    await openFin('Expenses'); await page.fill('#expQ', nos[nos.length - 1]);
    eq(await page.$$eval('#app table tbody tr[data-go^="expense-"]', t => t.length), 1);
    await page.fill('#expQ', 'Machine Co'); eq(await page.$$eval('#app table tbody tr[data-go^="expense-"]', t => t.length), 1, 'search by payee');
    await page.fill('#expQ', '');
  });
  await check('filters by type, category, status and date range', async () => {
    await page.selectOption('#period', 'This Year');
    await page.selectOption('[data-ef=type]', 'Capital Equipment');
    const types = await page.$$eval('#app table tbody tr[data-go^="expense-"] td:nth-child(3)', t => t.map(x => x.innerText.trim()));
    ok(types.length >= 4 && types.every(x => x === 'Capital'), types.join());
    await page.selectOption('[data-ef=type]', ''); await page.selectOption('[data-ef=cat]', 'Packaging');
    const cats = await page.$$eval('#app table tbody tr[data-go^="expense-"] td:nth-child(4)', t => t.map(x => x.innerText.trim())); ok(cats.length && cats.every(x => x === 'Packaging'));
    await page.selectOption('[data-ef=cat]', ''); await page.selectOption('[data-ef=status]', 'Pending');
    ok((await page.$$eval('#app table tbody tr[data-go^="expense-"] td:nth-child(10)', t => t.map(x => x.innerText.trim()))).every(x => x === 'Pending'));
    const rows = await csvOf('expenses'); ok(rows.slice(1).every(r => r[9] === 'Pending'), 'CSV follows the filters');
    await page.click('[data-action=resetExpF]');
    await page.selectOption('#period', 'Custom Range'); await page.fill('#pFrom', '2026-06-01'); await page.fill('#pTo', '2026-06-30');
    const dates = (await csvOf('expenses')).slice(1).map(r => r[0]); ok(dates.length && dates.every(d => d >= '2026-06-01' && d <= '2026-06-30'), 'date range');
  });
  await check('expense totals are accurate and cancelled expenses drop out', async () => {
    await page.selectOption('#period', 'This Year'); const r = await range();
    const x = await raw(r.from, r.to), k = await kpis();
    near(k[0], Math.round(x.opex), 'operating', 0.5); near(k[1], Math.round(x.capex), 'capital', 0.5);
    const rows = (await csvOf('expenses')).slice(1).filter(c => c[2] === 'Operating Expense' && c[9] !== 'Cancelled');
    near(rows.reduce((a, c) => a + +c[8], 0), x.opex, 'CSV SGD column', 0.05);
    const op0 = (await fin()).opex;
    await page.goto(FILE + '#expense-' + expId); await page.click('[data-action=cancelExpense]'); await save();
    ok((await page.textContent('#mForm')).includes('Give a reason'), 'reason required');
    await page.fill('#mForm [name=reason]', 'Test cancel'); await save();
    eq((await db()).expenses.find(e => e.id === expId).status, 'Cancelled');
    near((await fin()).opex, op0 - 123.45, 'excluded from totals');
    ok(!(await page.$('.page-head [data-action=editExpense]')), 'cancelled expenses cannot be edited');
  });
  await check('editing an expense is recorded', async () => {
    await page.goto(FILE + '#expense-' + capId); await page.click('.page-head [data-action=editExpense]');
    await page.fill('#mForm [name=amount]', '520'); await save();
    const e = (await db()).expenses.find(x => x.id === capId); eq(e.amount, 520);
    ok((await page.textContent('#app')).includes('Expense edited'), 'audit history on the page');
  });

  console.log('Other income');
  let incId;
  await check('other income can be recorded with a unique reference and category', async () => {
    await page.goto(FILE + '#financials'); await page.selectOption('#period', 'This Month');
    const nop0 = (await fin()).nop;
    await page.click('.page-head [data-action=recordIncome]');
    await fillFin({ date: today, category: 'Commission', description: 'Test referral', party: 'Test Club', amount: 75 }, 'income');
    await save(); ok((await toastText()).includes('Other income recorded'));
    const d = await db(), i = d.incomes.slice(-1)[0]; incId = i.id;
    ok(/^INC-2026-\d{4}$/.test(i.no)); eq(new Set(d.incomes.map(x => x.no)).size, d.incomes.length, 'unique');
    eq(i.category + '|' + i.source + '|' + i.status, 'Commission|Test Club|Received');
    near((await fin()).nop, nop0 + 75, 'adds to Net Operating Profit');
  });
  await check('other income can be edited, filtered and exported', async () => {
    await page.click('.page-head [data-action=editIncome]'); await page.fill('#mForm [name=amount]', '80'); await save();
    eq((await db()).incomes.find(x => x.id === incId).amount, 80);
    await openFin('Other Income'); await page.selectOption('[data-if=cat]', 'Commission');
    const rows = await csvOf('incomes'); ok(rows.length > 1 && rows.slice(1).every(r => r[2] === 'Commission'));
    ok(rows.some(r => r[3] === 'Test Club'));
  });

  console.log('Profitability');
  await check('net sales, COGS, gross profit, expenses, income, net operating profit and net cash result', async () => {
    await page.goto(FILE + '#financials'); await page.click('[data-ftab="Overview"]'); await page.selectOption('#period', 'This Year');
    const r = await range(), x = await raw(r.from, r.to), k = await kpis(), s = await strip();
    near(k[0], Math.round(x.net), 'net sales', 0.5); near(k[1], Math.round(x.gp), 'gross profit', 0.5); near(k[2], Math.round(x.nop), 'NOP', 0.5); near(k[3], Math.round(x.ncr), 'NCR', 0.5);
    near(s[0], Math.round(x.cogs), 'COGS', 0.5); eq((await page.$$eval('.stat-strip > div b', e => e[1].innerText)), (x.margin * 100).toFixed(1) + '%', 'margin');
    near(s[2], Math.round(x.opex), 'opex', 0.5); near(s[3], Math.round(x.income), 'income', 0.5); near(s[4], Math.round(x.capex), 'capex', 0.5);
    near(x.nop, x.gp - x.opex + x.income, 'formula'); near(x.ncr, x.nop - x.capex, 'cash formula');
    const wf = await page.$$eval('.wf-row', rows => rows.map(r => [r.querySelector('.wf-label').innerText.trim(), r.querySelector('.wf-val').childNodes[0].textContent]));
    eq(wf.map(w => w[0]).join('|'), 'Net sales|Cost of goods sold|Gross profit|Operating expenses|Other income|Net operating profit|Capital equipment|Net cash result');
    near(num(wf[5][1]), x.nop, 'breakdown NOP', 0.5); near(num(wf[7][1]), x.ncr, 'breakdown NCR', 0.5);
  });
  await check('capital equipment is kept out of net operating profit and reduces net cash result', async () => {
    const f0 = await fin();
    await page.evaluate(d => { transact(() => createExpense(DB, { date: d, type: 'Capital Equipment', category: 'Equipment', description: 'Test laptop', payee: 'Shop', amount: 1000, currency: 'SGD', fxRate: 1, status: 'Paid' })); persist(); }, today);
    const f1 = await fin(); near(f1.nop, f0.nop, 'NOP unchanged'); near(f1.ncr, f0.ncr - 1000, 'NCR −1000'); near(f1.capex, f0.capex + 1000);
  });
  await check('gross margin is safe in a period with no sales', async () => {
    await page.goto(FILE + '#financials'); await page.selectOption('#period', 'Last Year');
    eq((await page.$$eval('.stat-strip > div b', e => e[1].innerText)).trim(), '—');
    ok(!(await page.textContent('#app')).includes('NaN') && !(await page.textContent('#app')).includes('Infinity'));
  });

  console.log('Inventory cost');
  await check('receiving inventory is not counted as an expense', async () => {
    await page.selectOption('#period', 'This Month'); const f0 = await fin();
    await page.evaluate(() => { const p = DB.purchases.find(x => x.status === 'Ordered'); transact(() => receivePurchase(DB, p, { date: todayISO() })); persist(); });
    const f1 = await fin(); near(f1.opex, f0.opex, 'opex unchanged'); near(f1.nop, f0.nop, 'NOP unchanged'); ok(f1.purchases > f0.purchases, 'shown as an inventory purchase');
  });
  await check('expenses and income never change stock', async () => {
    const s = await stock(), p = (await db()).purchases.find(x => x.no === 'PUR-2026-0003');
    const fromPurchase = p.lines.reduce((a, l) => a + l.qty, 0);
    eq(s.units, stock0.units + fromPurchase, 'only the received purchase changed stock'); eq(s.moves, stock0.moves + p.lines.length, 'no movements from expenses');
    eq(await page.evaluate(() => ledgerCheck().length), 0);
  });

  console.log('Landed cost');
  const P1 = await page.evaluate(() => DB.purchases.find(x => x.no === 'PUR-2026-0001').id);
  await check('additional purchase costs are available to allocate', async () => {
    await page.goto(FILE + '#purchase-' + P1); ok((await page.textContent('#app')).includes('Landed cost'));
    await page.click('.page-head [data-action=applyLanded]'); ok((await page.textContent('#mForm')).includes('Freight') && (await page.textContent('#mForm')).includes('Duties'));
  });
  await check('allocation by quantity and by value; totals reconcile; landed unit cost', async () => {
    const res = await page.evaluate(id => { const p = DB.purchases.find(x => x.id === id); return ['quantity', 'value'].map(m => { const pv = landedPreview(p, m); return { m, add: purchaseTotals(p).add, total: purchaseTotals(p).total, costs: p.costs, rows: pv.rows.map(r => ({ qty: r.l.qty, line: r.l.qty * r.l.unitCost, alloc: r.alloc, landed: r.landed, unit: r.unit })) }; }); }, P1);
    for (const x of res) {
      const base = x.rows.map(r => x.m === 'value' ? r.line : r.qty), tot = base.reduce((a, b) => a + b, 0);
      for (const k of ['shipping', 'duties', 'customs', 'handling', 'other']) {
        const c = +x.costs[k] || 0; near(x.rows.reduce((a, r) => a + r.alloc[k], 0), c, `${x.m} ${k} adds up`, 0.001);
        x.rows.forEach((r, i) => near(r.alloc[k], c * base[i] / tot, `${x.m} ${k} share`, 0.02));
      }
      near(x.rows.reduce((a, r) => a + r.landed, 0), x.total, `${x.m} landed = purchase total`, 0.001);
      x.rows.forEach(r => near(r.unit, r.landed / r.qty, 'landed unit', 0.0001));
    }
    ok(res[0].rows[2].alloc.shipping !== res[1].rows[2].alloc.shipping, 'methods differ');
  });
  await check('applying landed cost updates cost basis but never past sales', async () => {
    const before = await page.evaluate(() => { const t = { from: '2026-01-01', to: todayISO() }; return { cogs: periodSales(t.from, t.to).st.cogs, gp: periodSales(t.from, t.to).st.gp, sale: DB.sales.filter(s => s.status === 'Completed').map(s => saleTotals(s).cogs) }; });
    await page.click('#mForm .seg-radio:has([value=value])'); await save();
    ok((await toastText()).includes('Landed cost applied'));
    const p = (await db()).purchases.find(x => x.id === P1); eq(p.landed.method, 'value');
    const v = await page.evaluate(id => { const p = DB.purchases.find(x => x.id === id), l = p.landed.lines[0], v = DB.variants.find(x => x.id === l.variantId); return { cost: v.cost, unit: l.unit, fx: p.fxRate, latest: v.lastPurchaseId === id, landedUnit: v.landedUnitCost }; }, P1);
    if (v.latest) { near(v.cost, v.unit * v.fx, 'cost basis = landed unit × rate', 0.0001); near(v.landedUnit, v.unit * v.fx, 'landed unit stored', 0.0001); }
    const after = await page.evaluate(() => { const t = { from: '2026-01-01', to: todayISO() }; return { cogs: periodSales(t.from, t.to).st.cogs, gp: periodSales(t.from, t.to).st.gp, sale: DB.sales.filter(s => s.status === 'Completed').map(s => saleTotals(s).cogs) }; });
    near(after.cogs, before.cogs, 'COGS unchanged'); near(after.gp, before.gp, 'gross profit unchanged'); eq(after.sale.join(), before.sale.join(), 'every completed sale keeps its cost');
    ok((await page.textContent('#app')).includes('Applied') && (await page.textContent('#app')).includes('by purchase value'));
  });
  await check('recalculating landed cost is traceable', async () => {
    await page.click('.page-head [data-action=applyLanded]'); await page.click('#mForm .seg-radio:has([value=quantity])'); await save();
    eq((await db()).purchases.find(x => x.id === P1).landed.method, 'quantity');
    const acts = (await db()).audit.filter(a => a.link === 'purchase-' + P1).map(a => a.action);
    ok(acts.includes('Landed cost applied') && acts.includes('Landed cost recalculated'), acts.join());
  });
  await check('cost fields are shown separately on the SKU', async () => {
    const vid = await page.evaluate(id => DB.purchases.find(x => x.id === id).lines[0].variantId, P1);
    await page.goto(FILE + '#variant-' + vid);
    const t = await page.textContent('#app'); for (const f of ['Inventory cost basis', 'Last purchase cost', 'Landed unit cost', 'Cost at time of sale']) ok(t.includes(f), f);
  });
  await check('landed cost breakdown exports with the filters', async () => {
    await openFin('Landed Cost'); await page.selectOption('#period', 'This Year'); await page.click('[data-flc="Applied"]');
    const rows = await csvOf('landed'); ok(rows.length > 1 && rows.slice(1).every(r => r[0] === 'PUR-2026-0001'), 'applied only');
    const h = rows[0]; const tot = rows.slice(1).reduce((a, r) => a + +r[h.indexOf('Landed Cost')], 0);
    near(tot, await page.evaluate(id => purchaseTotals(DB.purchases.find(x => x.id === id)).total, P1), 'landed total = purchase total', 0.01);
  });

  console.log('Reporting');
  await check('expense breakdown by category drills into the expenses', async () => {
    await openFin('Overview'); await page.selectOption('#period', 'This Year');
    const f = await fin(), cats = await page.$$eval('[data-expcat]', r => r.map(x => [x.dataset.expcat, +x.cells[1].innerText.replace(/[^0-9.]/g, ''), +x.cells[3].innerText]));
    near(cats.reduce((a, c) => a + c[1], 0), f.opex, 'categories add up', 0.05);
    await page.click(`[data-expcat="${cats[0][0]}"]`);
    ok(await page.$('[data-ftab="Expenses"][aria-selected="true"]'), 'opens Expenses');
    eq(await page.$$eval('#app table tbody tr[data-go^="expense-"]', t => t.length), cats[0][2] + (await db()).expenses.filter(e => e.status === 'Cancelled' && e.category === cats[0][0] && e.type === 'Operating Expense' && e.date >= '2026-01-01').length, 'matching rows');
    await page.click('[data-action=resetExpF]');
  });
  await check('capital equipment report shows period spending', async () => {
    await page.click('[data-fexp="Capital Equipment"]');
    const x = await raw('2026-01-01', today), rows = await csvOf('capex');
    near(rows.slice(1).reduce((a, r) => a + +r[6], 0), x.capex, 'total', 0.05); near((await kpis())[0], Math.round(x.capex), 'card', 0.5);
    ok(rows.slice(1).some(r => r[2] === 'Electronic stringing machine'));
  });
  await check('profit trend shows net sales, gross profit and net operating profit', async () => {
    await page.click('[data-ftab="Overview"]');
    eq(await page.$$eval('.line-chart polyline', p => p.length), 3);
    const s = await page.evaluate(() => { const p = periodRange(), b = buckets(p.from, p.to); return profitSeries(b, p.from, p.to); }), f = await fin();
    near(s.net.reduce((a, x) => a + x, 0), f.net, 'net sales series', 0.05); near(s.nop.reduce((a, x) => a + x, 0), f.nop, 'NOP series', 0.05);
  });
  await check('product, customer and country profitability (gross profit = net sales − COGS)', async () => {
    await page.click('[data-ftab="Profitability"]');
    for (const [view, key, name] of [['Products', 'products', 2], ['Customers', 'customers', 0], ['Countries', 'countries', 0]]) {
      await page.click(`[data-fprof="${view}"]`);
      const rows = await csvOf(key), h = rows[0], ix = n => h.indexOf(n);
      ok(ix('COGS (SGD)') > 0 && ix('Gross Margin %') > 0, view + ' columns');
      rows.slice(1).forEach(r => { near(+r[ix('Net Sales (SGD)')] - +r[ix('COGS (SGD)')], +r[ix('Gross Profit (SGD)')], `${view} ${r[name]}`, 0.02); });
    }
    const f = await fin(), c = (await csvOf('customers')).slice(1);
    near(c.reduce((a, r) => a + +r[9], 0), f.gp, 'customer gross profit adds up to the total', 0.5);
  });
  await check('reports include a financial section with exports', async () => {
    await page.goto(FILE + '#reports'); await page.click('[data-rtab="Financial"]');
    for (const v of ['Profitability', 'Operating Expenses', 'Capital Equipment', 'Other Income', 'Landed Cost', 'Product Profitability', 'Customer Profitability', 'Country Profitability']) {
      await page.click(`[data-rfin="${v}"]`); const csv = parseCSV(await page.evaluate(() => exportReport())); ok(csv.length >= 1 && csv[0].length > 1, v);
    }
    await page.click('[data-rfin="Profitability"]'); const rows = await csvOf('fin');
    const x = await raw((await range()).from, (await range()).to);
    near(+rows.find(r => r[0] === 'Net Operating Profit')[1], x.nop, 'NOP row', 0.5); near(+rows.find(r => r[0] === 'Net Cash Result')[1], x.ncr, 'NCR row', 0.5);
  });
  await check('dashboard shows net operating profit and operating expenses', async () => {
    await page.goto(FILE + '#dashboard'); await page.selectOption('#period', 'This Month');
    const r = await range(), x = await raw(r.from, r.to);
    near((await kpis())[3], Math.round(x.nop), 'NOP card', 0.5); near((await strip())[3], Math.round(x.opex), 'opex', 0.5);
  });

  console.log('Audit trail');
  await check('financial actions create audit records', async () => {
    const acts = (await db()).audit.map(a => a.action);
    for (const a of ['Expense created', 'Capital equipment added', 'Expense edited', 'Expense cancelled', 'Other income created', 'Other income edited', 'Landed cost applied', 'Landed cost recalculated']) ok(acts.includes(a), 'missing ' + a);
    await page.goto(FILE + '#audit'); await page.selectOption('#audEnt', 'Expense'); ok((await page.textContent('#app')).includes('Expense cancelled'));
  });

  console.log('Data');
  await check('existing data upgrades to the financial version without losing records', async () => {
    const counts = await page.evaluate(() => { const d = JSON.parse(JSON.stringify(DB)); d.version = 6; delete d.expenses; delete d.incomes; delete d.expenseCategories; delete d.incomeCategories; localStorage.setItem('msv-inventory-v2', JSON.stringify(d)); return { s: d.sales.length, m: d.movements.length }; });
    await page.goto(FILE + '#dashboard'); await page.reload(); await page.waitForSelector('.kpi');
    const d = await db(); eq(d.version, 7); eq(d.expenses.length, 0); eq(d.sales.length, counts.s); eq(d.movements.length, counts.m); ok(d.expenseCategories.includes('Marketplace Fees'));
  });
  await check('no script errors', async () => eq(errors.length, 0, errors.join(' | ')));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
