// Phase 6 checklist (dashboard, reports, drill-downs, CSV export), run in a real browser against index.html.
// Expected figures are worked out here straight from the stored records, not through the report code.
// Usage: node tests/phase6.spec.js   (needs the `playwright` package and Chromium)
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
function parseCSV(csv) {
  return csv.replace(/^﻿/, '').trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"')));
}

/* Independent calculation from raw records (runs in the page). */
const RAW = `(from,to)=>{
  const sales=DB.sales.filter(s=>s.status==='Completed'&&s.completedDate>=from&&s.completedDate<=to);
  const rets=DB.returns.filter(r=>r.status==='Completed'&&r.completedDate>=from&&r.completedDate<=to);
  let gross=0,prod=0,cogs=0,units=0; const byV={},byC={},byK={};
  const add=(m,k,f)=>{m[k]=m[k]||{orders:0,units:0,gross:0,returns:0,rev:0,cogs:0};f(m[k])};
  sales.forEach(s=>{const fx=s.fxRate;let sub=0;s.lines.forEach(l=>{sub+=l.qty*l.unitPrice-(+l.discount||0)});
    const od=+s.charges.discount||0, pr=(sub-od)*fx, g=(sub-od+(+s.charges.shipping||0)+(+s.charges.other||0))*fx, c=s.lines.reduce((a,l)=>a+l.qty*l.unitCost,0), u=s.lines.reduce((a,l)=>a+l.qty,0);
    gross+=g;prod+=pr;cogs+=c;units+=u;
    [[byC,s.customerId],[byK,s.country||'Not set']].forEach(([m,k])=>add(m,k,x=>{x.orders++;x.units+=u;x.gross+=g;x.rev+=pr;x.cogs+=c}));
    s.lines.forEach(l=>{const net=l.qty*l.unitPrice-(+l.discount||0),share=sub>0?net/sub:0;add(byV,l.variantId,x=>{x.units+=l.qty;x.rev+=(net-od*share)*fx;x.cogs+=l.qty*l.unitCost})})});
  let rv=0,rc=0,ru=0;
  rets.forEach(r=>{const s=DB.sales.find(x=>x.id===r.saleId);r.lines.forEach(l=>{const v=l.qty*l.unitRevenueBase,c=l.restock?l.qty*l.unitCost:0;rv+=v;rc+=c;ru+=l.qty;
    [[byC,r.customerId],[byK,(s&&s.country)||'Not set'],[byV,l.variantId]].forEach(([m,k])=>add(m,k,x=>{x.returns+=v;x.rev-=v;x.cogs-=c;if(m===byV)x.returned=(x.returned||0)+l.qty}))})});
  return {count:sales.length,gross,returns:rv,net:gross-rv,rev:prod-rv,cogs:cogs-rc,gp:gross-rv-(cogs-rc),units,ru,byV,byC,byK};
}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(FILE + '#dashboard');
  await page.waitForSelector('.kpi');

  const raw = (from, to) => page.evaluate(([f, a, b]) => eval(f)(a, b), [RAW, from, to]);
  const range = () => page.evaluate(() => periodRange());
  const kpis = () => page.$$eval('.kpi .kpi-value', e => e.map(x => num(x.innerText)));
  await page.addInitScript(() => { window.num = s => +String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-'); });
  await page.reload(); await page.waitForSelector('.kpi');
  const setPeriod = async p => { await page.selectOption('#period', p); await page.waitForTimeout(30); };
  const tab = async t => { await page.click(`[data-rtab="${t}"]`); };
  const csvOf = name => page.evaluate(n => exportReport(n), name).then(parseCSV);
  const today = await page.evaluate(() => todayISO());

  // A known sale today: 10 × MSV-FH-118-BLK-R at SGD 120 with SGD 20 shipping, plus a draft and a cancelled sale that must not count.
  const setup = await page.evaluate(() => {
    const v = DB.variants.find(x => x.sku === 'MSV-FH-118-BLK-R'); let s, d, c;
    transact(() => {
      s = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Completed', payment: 'Paid', lines: [{ variantId: v.id, qty: 10, unitPrice: 120, discount: 0 }], charges: { ...emptyCharges(), shipping: 20 } });
      completeSale(DB, s, { date: todayISO() });
      d = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Draft', payment: 'Unpaid', lines: [{ variantId: v.id, qty: 5, unitPrice: 999, discount: 0 }], charges: emptyCharges() });
      c = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Confirmed', payment: 'Unpaid', lines: [{ variantId: v.id, qty: 5, unitPrice: 999, discount: 0 }], charges: emptyCharges() });
      c.status = 'Cancelled';
    });
    persist(); return { saleId: s.id, saleNo: s.no, cost: s.lines[0].unitCost, vid: v.id };
  });
  await page.reload(); await page.waitForSelector('.kpi');

  console.log('Dashboard');
  await check('sales card uses real completed sales only (drafts and cancelled excluded)', async () => {
    const r = await range(), x = await raw(r.from, r.to), k = await kpis();
    eq(r.from, today.slice(0, 8) + '01', 'defaults to this month');
    near(k[0], Math.round(x.net), 'net sales', 0.5);
    ok(x.gross >= 1220, 'includes the new sale');
  });
  await check('gross profit is accurate', async () => {
    const r = await range(), x = await raw(r.from, r.to), k = await kpis();
    near(k[1], Math.round(x.gp), 'gross profit', 0.5);
    ok((await page.textContent('.kpi:nth-child(2) .kpi-note')).includes((x.gp / x.net * 100).toFixed(1) + '% margin'), 'margin');
  });
  await check('inventory value and units in stock are accurate', async () => {
    const t = await page.evaluate(() => ({ v: DB.variants.reduce((a, v) => a + v.qty * v.cost, 0), u: DB.variants.reduce((a, v) => a + v.qty, 0) })), k = await kpis();
    eq(k[2], Math.round(t.v)); eq((await page.$$eval('.stat-strip > div b', e => e.map(x => num(x.innerText))))[5], t.u, 'units in stock');
    await page.goto(FILE + '#inventory'); eq((await kpis())[0], Math.round(t.v), 'matches the Inventory page');
    await page.goto(FILE + '#dashboard');
  });
  await check('low stock and out of stock counts are accurate', async () => {
    const exp = await page.evaluate(() => { const live = DB.variants.filter(v => v.status === 'Active' && DB.products.find(p => p.id === v.productId).status === 'Active'); return { low: live.filter(v => v.qty > 0 && v.qty <= v.reorder).length, out: live.filter(v => v.qty <= 0).length }; });
    const strip = await page.$$eval('.stat-strip > div b', e => e.map(x => num(x.innerText)));
    eq(strip[0], exp.low, 'low'); eq(strip[1], exp.out, 'out');
    ok((await page.textContent('#app')).includes(`${exp.low} SKU${exp.low === 1 ? '' : 's'} low stock`), 'alert');
  });
  await check('date filtering updates the cards, including a custom range', async () => {
    for (const p of ['Today', 'Last 7 Days', 'Last Month', 'Last 6 Months', 'This Year', 'Last Year']) {
      await setPeriod(p); const r = await range(), x = await raw(r.from, r.to), k = await kpis();
      near(k[0], Math.round(x.net), p, 0.5); near(k[1], Math.round(x.gp), p + ' gp', 0.5);
    }
    eq((await range()).from, (+today.slice(0, 4) - 1) + '-01-01');
    ok((await page.textContent('#app')).includes('No sales found for this period.'), 'empty state, no broken chart');
    await setPeriod('Custom Range'); await page.fill('#pFrom', '2026-06-01'); await page.fill('#pTo', '2026-06-30');
    const r = await range(); eq(r.from + '|' + r.to, '2026-06-01|2026-06-30');
    near((await kpis())[0], Math.round((await raw('2026-06-01', '2026-06-30')).net), 'custom', 0.5);
  });
  await check('previous-period comparison is worked out against the equivalent period', async () => {
    await setPeriod('Last Month'); const r = await range(), a = await raw(r.from, r.to), b = await raw(r.prevFrom, r.prevTo);
    const ch = (Math.round(a.net * 100) / 100 - Math.round(b.net * 100) / 100) / Math.abs(Math.round(b.net * 100) / 100) * 100;
    const note = await page.textContent('.kpi:nth-child(1) .kpi-note');
    ok(note.includes(`${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(1)}%`) && note.includes('vs the month before'), note);
    eq(r.prevFrom.slice(5, 7), String((+r.from.slice(5, 7) + 10) % 12 + 1).padStart(2, '0'), 'previous month');
  });
  await check('the selected period is remembered during the session', async () => {
    await setPeriod('Last 3 Months'); await page.reload(); await page.waitForSelector('#period');
    eq(await page.inputValue('#period'), 'Last 3 Months');
    await page.goto(FILE + '#reports'); eq(await page.inputValue('#period'), 'Last 3 Months', 'shared with Reports');
  });
  await check('chart metric switches between revenue, units and gross profit', async () => {
    await page.goto(FILE + '#dashboard'); await setPeriod('This Month'); const x = await raw((await range()).from, today);
    await page.click('[data-tmetric="Units Sold"]'); ok((await page.textContent('#app')).includes(`${(x.units - x.ru).toLocaleString('en-SG')} units in this period`));
    await page.click('[data-tmetric="Gross Profit"]'); ok((await page.textContent('#app')).includes(`SGD ${Math.round(x.gp).toLocaleString('en-SG')} in this period`));
    await page.click('[data-tmetric="Revenue"]');
  });
  await check('alerts open the matching report', async () => {
    await page.click('.list-item[data-rsub="Low Stock"]'); await page.waitForTimeout(50);
    ok(page.url().endsWith('#reports')); ok(await page.$('[data-rinv="Low Stock"][aria-pressed="true"]'), 'low stock view');
  });
  await check('recent activity shows real events and skips draft noise', async () => {
    await page.goto(FILE + '#dashboard');
    const t = await page.textContent('#app');
    ok(t.includes(`Sale ${setup.saleNo} completed`), 'sale completed');
    const act = await page.$$eval('.card', cs => cs.find(c => c.querySelector('h3') && c.querySelector('h3').innerText === 'Recent Activity').innerText);
    ok(!/Sale SAL-\d{4}-\d{4} created/.test(act), 'no draft-created noise');
  });

  console.log('Sales reports');
  await page.goto(FILE + '#reports'); await setPeriod('This Year'); await tab('Sales');
  const yr = await range();
  await check('gross sales match completed sales; table lists exactly the completed sales', async () => {
    const x = await raw(yr.from, yr.to), k = await kpis();
    near(k[0], Math.round(x.gross), 'gross', 0.5); near(k[2], Math.round(x.net), 'net', 0.5);
    const rows = await csvOf('sales'); eq(rows.length - 1, x.count, 'rows');
    near(rows.slice(1).reduce((a, r) => a + +r[7], 0), x.gross, 'CSV total', 0.5);
  });
  let retNo;
  await check('returns reduce net sales; restocked returns add back their cost', async () => {
    const before = await raw(yr.from, yr.to);
    await page.evaluate(id => { const s = DB.sales.find(x => x.id === id); transact(() => { const r = createCustomerReturn(DB, { saleId: id, date: todayISO(), reason: 'Customer Changed Mind', lines: [{ saleLineId: s.lines[0].id, qty: 2, condition: 'Resellable', restock: true }] }); completeCustomerReturn(DB, r, { date: todayISO() }); }); persist(); }, setup.saleId);
    retNo = (await page.evaluate(() => DB.returns.slice(-1)[0].no));
    await page.goto(FILE + '#reports'); await tab('Sales');
    const after = await raw(yr.from, yr.to), k = await kpis();
    near(after.net, before.net - 240, 'net −240'); near(after.cogs, before.cogs - 2 * setup.cost, 'cogs back');
    near(k[1], Math.round(after.returns), 'returns card', 0.5); near(k[2], Math.round(after.net), 'net card', 0.5);
  });
  await check('COGS uses stored cost snapshots, not today\'s cost', async () => {
    const c0 = await page.evaluate(() => { const p = periodRange(); return periodSales(p.from, p.to).st.cogs; });
    await page.evaluate(id => { DB.variants.find(v => v.id === id).cost = 999; persist(); }, setup.vid);
    const c1 = await page.evaluate(() => { const p = periodRange(); return periodSales(p.from, p.to).st.cogs; });
    near(c1, c0, 'unchanged'); near(c1, (await raw(yr.from, yr.to)).cogs, 'matches snapshots', 0.05);
    await page.evaluate(([id, c]) => { DB.variants.find(v => v.id === id).cost = c; persist(); }, [setup.vid, setup.cost]);
  });
  await check('gross profit and gross margin are accurate', async () => {
    await page.goto(FILE + '#reports'); await tab('Sales');
    const x = await raw(yr.from, yr.to), bridge = await page.$$eval('.summary div', e => Object.fromEntries(e.map(d => [d.children[0]?.innerText.trim(), d.children[1]?.innerText.trim()])));
    near(num(bridge['Net sales']), x.net, 'net', 0.5);
    near(num(bridge['Cost of goods sold']), -x.cogs, 'cogs', 0.5); near(num(bridge['Gross profit']), x.gp, 'gp', 0.5);
    eq(bridge['Gross margin'], (x.gp / x.net * 100).toFixed(1) + '%');
  });
  await check('reversed sales do not inflate reports', async () => {
    const before = await raw(yr.from, yr.to);
    const s = await page.evaluate(() => { const s = DB.sales.find(x => x.status === 'Completed' && x.completedDate >= periodRange().from && !DB.returns.some(r => r.saleId === x.id)); const t = saleTotals(s); transact(() => reverseSale(DB, s, { date: todayISO(), reason: 'test' })); persist(); return { gross: t.totalBase }; });
    await page.goto(FILE + '#reports'); await tab('Sales');
    near((await kpis())[0], Math.round(before.gross - s.gross), 'gross drops by the reversed sale', 0.5);
  });

  console.log('Product reports');
  await page.goto(FILE + '#reports'); await tab('Products');
  await check('units sold, revenue, gross profit and current stock per SKU', async () => {
    const x = await raw(yr.from, yr.to), rows = await csvOf('products'), h = rows[0];
    const ix = n => h.indexOf(n); let checked = 0;
    for (const r of rows.slice(1)) {
      const v = await page.evaluate(sku => { const v = DB.variants.find(x => x.sku === sku); return { id: v.id, qty: v.qty }; }, r[ix('SKU')]), e = x.byV[v.id];
      eq(+r[ix('Units Sold')], e.units, r[2] + ' units'); eq(+r[ix('Returned')], e.returned || 0, r[2] + ' returned');
      near(+r[ix('Net Sales (SGD)')], e.rev, r[2] + ' net sales', 0.05); near(+r[ix('Gross Profit (SGD)')], e.rev - e.cogs, r[2] + ' gp', 0.05);
      eq(+r[ix('Current Stock')], v.qty, 'stock'); checked++;
    }
    eq(checked, Object.keys(x.byV).length, 'every SKU sold');
  });
  await check('best seller ranking works for units, revenue and gross profit', async () => {
    const x = await raw(yr.from, yr.to);
    for (const [by, f] of [['Units', e => e.units - (e.returned || 0)], ['Revenue', e => e.rev], ['Gross Profit', e => e.rev - e.cogs]]) {
      await page.click(`[data-best="${by}"]`);
      const top = Object.entries(x.byV).sort((a, b) => f(b[1]) - f(a[1]))[0][0];
      eq(await page.getAttribute('.card .list .list-item >> nth=0', 'data-go'), 'variant-' + top, by);
    }
  });
  await check('sortable columns and rank-by control', async () => {
    await page.selectOption('#prodRank', 'Gross Margin %');
    const m = await page.$$eval('#app table tbody tr', trs => trs.map(t => parseFloat(t.cells[8].innerText)).filter(x => !isNaN(x)));
    ok(m.every((v, i) => !i || v <= m[i - 1]), 'sorted by margin desc');
    await page.click('[data-rsort="products:sku"]');
    const s = await page.$$eval('#app table tbody tr', trs => trs.map(t => t.cells[2].innerText));
    ok(s.every((v, i) => !i || v.localeCompare(s[i - 1], undefined, { numeric: true }) >= 0), 'sorted by SKU');
  });
  await check('product rows drill into the SKU page with performance and returns', async () => {
    await page.click(`#app tbody tr[data-go="variant-${setup.vid}"]`); await page.waitForTimeout(50);
    ok(page.url().endsWith('#variant-' + setup.vid));
    await page.click('[data-vtab="Performance"]'); const t = await page.textContent('#app'); ok(t.includes('Selected period') && t.includes('All time') && t.includes('Coverage'));
    await page.click('[data-vtab="Returns"]'); ok((await page.textContent('#app')).includes(retNo), 'returns tab');
  });
  let neverId;
  await check('slow-moving status follows days since last sale and the thresholds', async () => {
    await page.goto(FILE + '#reports'); await tab('Inventory'); await page.click('[data-rinv="Slow-Moving"]');
    const exp = await page.evaluate(() => DB.variants.filter(v => v.qty > 0).map(v => { const d = DB.sales.filter(s => s.status === 'Completed' && s.lines.some(l => l.variantId === v.id)).map(s => s.completedDate).sort().pop(); const days = d ? Math.round((Date.parse(todayISO()) - Date.parse(d)) / 864e5) : null; return [v.sku, days == null ? 'Never Sold' : days >= 120 ? 'No Recent Sales' : days >= 60 ? 'Slow Moving' : 'Healthy']; }));
    const rows = await csvOf('slow'); const got = Object.fromEntries(rows.slice(1).map(r => [r[2], r[r.length - 1]]));
    exp.forEach(([sku, st]) => eq(got[sku], st, sku));
    await page.selectOption('#slowDays', '30');
    const after = Object.fromEntries((await csvOf('slow')).slice(1).map(r => [r[2], r[r.length - 1]]));
    ok(Object.values(after).filter(s => s === 'Slow Moving').length > Object.values(got).filter(s => s === 'Slow Moving').length, 'lower threshold flags more SKUs');
    await page.selectOption('#slowDays', '60');
    await page.click('[data-slow="No Recent Sales"]'); eq((await csvOf('slow')).length - 1, exp.filter(e => e[1] === 'No Recent Sales').length, 'filter applies to export');
  });
  await check('never-sold stock is listed with its value', async () => {
    neverId = await page.evaluate(() => { const p = DB.products[0]; DB.variants.push({ id: 'vnever', productId: p.id, sku: 'MSV-TEST-NEVER', gauge: '', colour: 'Black', packaging: 'Reel', qty: 0, cost: 12.5, price: 30, reorder: 2, status: 'Active' }); postMovement(DB, 'vnever', { type: 'opening', change: 8, date: todayISO(), reason: 'Opening stock' }); persist(); return 'vnever'; });
    await page.goto(FILE + '#reports'); await tab('Inventory'); await page.click('[data-rinv="Never Sold"]');
    ok((await page.textContent('#app')).includes('MSV-TEST-NEVER')); eq((await kpis())[0], 100, 'value 8 × 12.50');
    await page.goto(FILE + '#dashboard'); ok((await page.textContent('#app')).includes('1 SKU with stock has never sold'), 'dashboard alert');
  });

  console.log('Customer reports');
  await page.goto(FILE + '#reports'); await tab('Customers');
  await check('orders, net sales and returns per customer', async () => {
    const x = await raw(yr.from, yr.to), rows = await csvOf('customers'), h = rows[0], ix = n => h.indexOf(n);
    const ids = await page.evaluate(() => Object.fromEntries(DB.customers.map(c => [c.name, c.id])));
    eq(rows.length - 1, Object.keys(x.byC).length, 'customers');
    rows.slice(1).forEach(r => { const e = x.byC[ids[r[0]]]; eq(+r[ix('Orders')], e.orders, r[0]); near(+r[ix('Net Sales (SGD)')], e.gross - e.returns, r[0] + ' net', 0.05); near(+r[ix('Returns (SGD)')], e.returns, r[0] + ' returns', 0.05); });
    ok(+rows.find(r => r[0] === 'Kallang Tennis Hub')[ix('Returns (SGD)')] >= 240, 'test return reflected');
  });
  await check('top customer ranking works', async () => {
    const x = await raw(yr.from, yr.to), ids = await page.evaluate(() => Object.fromEntries(DB.customers.map(c => [c.id, c.name])));
    await page.click('[data-crank="Orders"]');
    const top = Object.entries(x.byC).sort((a, b) => b[1].orders - a[1].orders || (b[1].gross - b[1].returns) - (a[1].gross - a[1].returns))[0][0];
    eq(await page.getAttribute('.card .list .list-item >> nth=0', 'data-go'), 'customer-' + top, ids[top]);
  });
  await check('customer drill-down opens the customer with sales and returns', async () => {
    await page.click('#app tbody tr[data-go="customer-c-kth"]'); await page.waitForTimeout(50);
    ok(page.url().endsWith('#customer-c-kth')); const t = await page.textContent('#app'); ok(t.includes(setup.saleNo) && t.includes(retNo));
  });

  console.log('Country reports');
  await page.goto(FILE + '#reports'); await tab('Markets');
  await check('sales group by country with accurate net sales and shares', async () => {
    const x = await raw(yr.from, yr.to), rows = await csvOf('countries'), h = rows[0], ix = n => h.indexOf(n);
    eq(rows.length - 1, Object.keys(x.byK).length);
    rows.slice(1).forEach(r => { const e = x.byK[r[0]]; eq(+r[ix('Orders')], e.orders, r[0]); near(+r[ix('Net Sales (SGD)')], e.gross - e.returns, r[0], 0.05); near(+r[ix('Share of Net Sales %')], (e.gross - e.returns) / x.net * 100, r[0] + ' share', 0.06); });
  });
  await check('chart matches table totals', async () => {
    const bars = await page.$$eval('.hbars .hbar-row', e => e.map(r => [r.querySelector('.label').innerText.trim(), num(r.querySelector('.val').innerText)]));
    const rows = Object.fromEntries((await csvOf('countries')).slice(1).map(r => [r[0], Math.round(+r[5])]));
    ok(bars.length > 0); bars.forEach(([c, v]) => eq(v, rows[c], c));
    await page.click('[data-mmetric="Units Sold"]');
    const u = await page.$$eval('.hbars .hbar-row .val', e => e.reduce((a, x) => a + num(x.innerText), 0));
    eq(u, (await raw(yr.from, yr.to)).units, 'units');
  });
  await check('country drill-down lists that country\'s sales', async () => {
    await page.click('button.list-item[data-country="Malaysia"]');
    const n = await page.evaluate(() => { const p = periodRange(); return DB.sales.filter(s => s.status === 'Completed' && s.country === 'Malaysia' && s.completedDate >= p.from && s.completedDate <= p.to).length; });
    eq(await page.$$eval('#countryDrill tbody tr', t => t.length), n);
    await page.click('[data-action=countryToSales]'); await page.waitForTimeout(50);
    ok(page.url().endsWith('#sales')); eq(await page.$$eval('#salTable tbody tr', t => t.length), n, 'Sales page filtered');
  });

  console.log('Purchase reports');
  await check('received purchases only, with additional costs, at the stored rate', async () => {
    await page.goto(FILE + '#reports'); await tab('Purchases');
    const exp = await page.evaluate(() => { const p = periodRange(); return DB.purchases.filter(x => x.status === 'Received' && x.receivedDate >= p.from && x.receivedDate <= p.to).reduce((a, x) => { const t = purchaseTotals(x); return { n: a.n + 1, spend: a.spend + t.total * x.fxRate, add: a.add + t.add * x.fxRate }; }, { n: 0, spend: 0, add: 0 }); });
    const k = await kpis(); near(k[0], Math.round(exp.spend), 'spend', 0.5); eq(k[1], exp.n, 'count'); near(k[3], Math.round(exp.add), 'additional', 0.5);
    const p3 = await page.evaluate(() => { const p = DB.purchases.find(x => x.no === 'PUR-2026-0003'); transact(() => receivePurchase(DB, p, { date: todayISO() })); persist(); return purchaseTotals(p).total * 1.45; });
    await page.goto(FILE + '#reports'); await tab('Purchases'); near((await kpis())[0], Math.round(exp.spend + p3), 'received purchase added', 0.5);
    await page.evaluate(() => { DB.fxRates.EUR = 2; persist(); });
    await page.goto(FILE + '#reports'); await tab('Purchases'); near((await kpis())[0], Math.round(exp.spend + p3), 'changing today\'s rate does not change history', 0.5);
    ok((await page.textContent('#app')).includes('PUR-2026-0003') && !(await page.textContent('#app tbody')).includes('PUR-2026-0004'), 'draft excluded');
  });
  await check('supplier totals are accurate and drill into the supplier', async () => {
    await tab('Suppliers');
    const rows = await csvOf('suppliers'), h = rows[0], ix = n => h.indexOf(n);
    const exp = await page.evaluate(() => { const p = periodRange(), m = {}; DB.purchases.filter(x => x.status === 'Received' && x.receivedDate >= p.from && x.receivedDate <= p.to).forEach(x => { const n = DB.suppliers.find(s => s.id === x.supplierId).name, t = purchaseTotals(x); m[n] = m[n] || { c: 0, u: 0, s: 0 }; m[n].c++; m[n].u += t.units; m[n].s += t.total * x.fxRate; }); return m; });
    Object.entries(exp).forEach(([n, e]) => { const r = rows.find(x => x[0] === n); eq(+r[ix('Purchases')], e.c, n); eq(+r[ix('Units Received')], e.u, n); near(+r[ix('Total Spend (SGD)')], e.s, n, 0.05); });
    eq(+rows.find(r => r[0] === 'MSV GmbH')[ix('Returned Units')], 6, 'supplier return units');
    await page.click('#app tbody tr[data-go^="supplier-"]'); await page.waitForTimeout(50); ok(page.url().includes('#supplier-'));
  });

  console.log('Returns');
  await check('returns report and summary', async () => {
    await page.goto(FILE + '#reports'); await tab('Returns');
    const x = await raw(yr.from, yr.to), k = await kpis();
    near(k[0], Math.round(x.returns), 'value', 0.5); eq((await page.textContent('.kpi:nth-child(2) .kpi-value')).trim(), (x.ru / x.units * 100).toFixed(1) + '%', 'rate');
    ok((await page.textContent('#app')).includes(retNo)); await page.click('[data-rret="Supplier Returns"]'); ok((await page.textContent('#app')).includes('SRET-2026-0001'));
  });

  console.log('Inventory');
  await check('inventory report value matches the Inventory page', async () => {
    await tab('Inventory'); await page.click('[data-rinv="Inventory Value"]');
    const strip = await page.$$eval('.stat-strip > div b', e => e.map(x => num(x.innerText)));
    await page.goto(FILE + '#inventory'); eq(strip[0], (await kpis())[0]);
    const rows = await csvOf('inventory'); near(rows.slice(1).reduce((a, r) => a + +r[5], 0), await page.evaluate(() => DB.variants.reduce((a, v) => a + v.qty * v.cost, 0)), 'CSV total', 0.05);
  });
  await check('low stock report matches actual stock status', async () => {
    await page.goto(FILE + '#reports'); await tab('Inventory'); await page.click('[data-rinv="Low Stock"]');
    const rows = await csvOf('lowstock'), exp = await page.evaluate(() => attention().map(v => [v.sku, Math.max(v.reorder - v.qty, 0)]));
    eq(rows.length - 1, exp.length); exp.forEach(([sku, s]) => eq(+rows.find(r => r[0] === sku)[5], s, sku));
  });
  await check('movement report reconciles opening to closing stock', async () => {
    await tab('Stock Movements');
    for (const p of ['This Month', 'Last 6 Months', 'This Year']) {
      await setPeriod(p);
      const rows = await csvOf('flow'), u = rows.slice(1).map(r => +r[2]), open = u[0], close = u[u.length - 1];
      eq(open + u.slice(1, -1).reduce((a, x) => a + x, 0), close, p);
      eq(close, await page.evaluate(() => DB.variants.reduce((a, v) => a + v.qty, 0)), 'closing = stock today');
      ok((await page.textContent('#app')).includes('Reconciles'));
    }
    const pid = await page.evaluate(() => DB.variants.find(v => v.sku === 'MSV-FH-118-BLK-R').productId);
    await page.selectOption('[data-mvf=product]', pid);
    const u = (await csvOf('flow')).slice(1).map(r => +r[2]);
    eq(u[u.length - 1], await page.evaluate(p => DB.variants.filter(v => v.productId === p).reduce((a, v) => a + v.qty, 0), pid), 'product filter');
    await page.click('[data-action=resetRepMv]');
  });

  console.log('Export');
  await check('CSV export follows the period and shows on-screen values', async () => {
    await tab('Sales'); await setPeriod('Last Month');
    const r = await range(), rows = await csvOf('sales');
    ok(rows.slice(1).every(x => x[1] >= r.from && x[1] <= r.to), 'period applied');
    const first = await page.$$eval('#app table tbody tr:first-child td', t => t.map(x => x.innerText.trim()));
    eq(first[0], rows[1][0], 'same first sale as screen'); eq(num(first[7]), +rows[1][7], 'same total');
    await page.click('.page-head [data-action=exportReport]'); ok((await page.textContent('#toastRoot')).includes('Export started'));
  });

  console.log('Integrity');
  await check('ledger still explains all stock', async () => eq(await page.evaluate(() => ledgerCheck().length), 0));
  await check('no script errors', async () => eq(errors.length, 0, errors.join(' | ')));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
