// Phase 8 checklist (sign-in, users and permissions, settings, imports, exports, notifications,
// stock safety, system health, UX and security), run in a real browser against index.html.
// Usage: node tests/phase8.spec.js   (needs the `playwright` package and Chromium)
const path = require('path');
const { chromium } = require('playwright');
const { ADMIN } = require('./auth');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failures.push(name); console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'expected'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
const parseCSV = csv => csv.replace(/^﻿/, '').trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"')));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(DB)));
  const authText = () => page.textContent('#authRoot').catch(() => '');
  const toastText = () => page.textContent('#toastRoot');
  const save = () => page.click('.modal-foot [data-action=save]');
  const fillAuth = async (o) => { for (const [k, v] of Object.entries(o)) await page.fill(`#authForm [name=${k}]`, v); await page.click('#authForm [type=submit]'); await page.waitForTimeout(80); await page.waitForFunction(() => !document.querySelector('#authForm [type=submit].is-busy'), null, { timeout: 15000 }); await page.waitForTimeout(80); };
  const login = async (email, password) => { await page.waitForSelector('#authForm[data-auth=login]'); await fillAuth({ email, password }); };
  const logout = async () => { await page.evaluate(() => ACTIONS.signOut()); await page.waitForSelector('#authForm[data-auth=login]'); };
  const appText = () => page.textContent('#app');
  let recovery = '', staffTemp = '';

  console.log('Authentication');
  await check('a fresh system asks for the first admin before showing anything', async () => {
    await page.waitForSelector('#authForm[data-auth=setup]');
    eq((await page.textContent('#app')).trim(), '', 'no business data behind the sign-in screen');
    ok((await page.$$('#nav a')).length === 0 || (await page.getAttribute('#shell', 'aria-hidden')) === 'true', 'app hidden');
  });
  await check('setup rejects weak or mismatched passwords', async () => {
    await fillAuth({ name: ADMIN.name, email: ADMIN.email, password: 'short', confirm: 'short' });
    ok((await authText()).includes('at least 8 characters'));
    await fillAuth({ name: ADMIN.name, email: ADMIN.email, password: ADMIN.password, confirm: 'Different99' });
    ok((await authText()).includes('do not match'));
  });
  await check('setup creates the admin, shows a recovery code once, and stores no plaintext password', async () => {
    await fillAuth({ name: ADMIN.name, email: ADMIN.email, password: ADMIN.password, confirm: ADMIN.password });
    await page.waitForSelector('#codeSaved');
    recovery = (await page.textContent('.recovery-code')).trim(); ok(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(recovery), recovery);
    ok(await page.$eval('#codeDone', b => b.disabled), 'must confirm saving the code');
    await page.check('#codeSaved'); await page.click('#codeDone'); await page.waitForSelector('#app .page-head');
    const raw = await page.evaluate(() => localStorage.getItem('msv-inventory-v2'));
    ok(!raw.includes(ADMIN.password) && !raw.includes(recovery.replace(/-/g, '')), 'no plaintext secrets');
    const u = (await db()).users[0]; eq(u.roleId, 'admin'); eq(u.pw.alg, 'PBKDF2-SHA256'); ok(u.pw.hash.length === 64 && u.pw.salt.length === 32);
  });
  await check('logout ends the session and protected pages require sign-in', async () => {
    await logout();
    await page.goto(FILE + '#financials'); await page.waitForTimeout(200);
    ok(await page.$('#authForm[data-auth=login]'), 'login shown'); eq((await page.textContent('#app')).trim(), '', 'nothing rendered');
  });
  await check('wrong passwords are rejected and repeated failures lock the account briefly', async () => {
    for (let i = 0; i < 5; i++) await fillAuth({ email: ADMIN.email, password: 'WrongPass1' });
    ok((await authText()).includes("don't match"));
    await fillAuth({ email: ADMIN.email, password: ADMIN.password });
    ok((await authText()).includes('Too many attempts'), 'locked');
    await page.evaluate(() => { DB.users[0].lockUntil = 0; persist(); });
  });
  await check('the recovery code resets the admin password', async () => {
    await page.click('[data-authgo=forgot]'); await page.click('[data-authgo=recover]');
    await fillAuth({ email: ADMIN.email, code: 'AAAA-BBBB-CCCC-DDDD', password: 'Recovered123', confirm: 'Recovered123' });
    ok((await authText()).includes("doesn't match"), 'wrong code rejected');
    await fillAuth({ email: ADMIN.email, code: recovery.toLowerCase(), password: 'Recovered123', confirm: 'Recovered123' });
    await page.waitForSelector('#codeSaved'); await page.check('#codeSaved'); await page.click('#codeDone'); await page.waitForSelector('#app .page-head');
    await logout(); await login(ADMIN.email, 'Recovered123'); await page.waitForSelector('#app .page-head');
  });
  await check('the session survives a reload and expires after inactivity, keeping an open form', async () => {
    await page.reload(); await page.waitForSelector('#app .page-head');
    await page.evaluate(() => ACTIONS.addCustomer()); await page.fill('#mForm [name=name]', 'Half-typed Customer');
    await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('ets-session')); s.last = Date.now() - 3 * 3600e3; sessionStorage.setItem('ets-session', JSON.stringify(s)); render(); });
    await page.waitForSelector('#authForm[data-auth=login]');
    ok((await authText()).includes('without activity'));
    await page.fill('#authForm [name=password]', 'Recovered123'); await page.click('#authForm [type=submit]'); await page.waitForFunction(() => document.querySelector('#authRoot').hidden, null, { timeout: 15000 });
    eq(await page.inputValue('#mForm [name=name]'), 'Half-typed Customer', 'typed data kept');
    await page.click('.modal-foot [data-action=close]'); await page.click('[data-discard]');
  });

  console.log('Users and permissions');
  await check('an admin can invite a staff user with a temporary password', async () => {
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=users]');
    await page.click('[data-action=inviteUser]');
    await page.fill('#mForm [name=name]', 'Sam Staff'); await page.fill('#mForm [name=email]', ADMIN.email); await save();
    ok((await page.textContent('#mForm')).includes('already uses this email'), 'unique email');
    await page.fill('#mForm [name=email]', 'sam@evolvetennis.test'); await page.selectOption('#mForm [name=roleId]', 'staff'); await save();
    await page.waitForSelector('.recovery-code'); staffTemp = (await page.textContent('.recovery-code')).trim();
    await save();
    const u = (await db()).users.find(x => x.email === 'sam@evolvetennis.test'); eq(u.status, 'Invited'); ok(u.mustChange); ok(!JSON.stringify(u).includes(staffTemp));
    ok((await appText()).includes('Sam Staff'));
  });
  await check('staff choose their own password on first sign-in', async () => {
    await logout(); await login('sam@evolvetennis.test', staffTemp);
    await page.waitForSelector('#authForm[data-auth=change]');
    await fillAuth({ password: staffTemp.replace(/-/g, ''), confirm: staffTemp.replace(/-/g, '') + 'x' }); ok((await authText()).includes('do not match'));
    await fillAuth({ password: 'StaffPass1', confirm: 'StaffPass1' }); await page.waitForSelector('#app .page-head');
    const u = (await db()).users.find(x => x.email === 'sam@evolvetennis.test'); eq(u.status, 'Active'); ok(!u.mustChange);
  });
  await check('staff cannot see financial pages, even by typing the address', async () => {
    const nav = await page.$$eval('#nav a', a => a.map(x => x.getAttribute('href')));
    ok(!nav.includes('#financials') && !nav.includes('#reports') && !nav.includes('#audit'), nav.join());
    for (const h of ['financials', 'reports', 'audit', 'expense-' + (await db()).expenses[0].id]) { await page.goto(FILE + '#' + h); ok((await appText()).includes("You don't have access"), h); }
    await page.goto(FILE + '#dashboard'); const t = await appText();
    ok(!t.includes('Gross Profit') && !t.includes('Net Operating Profit') && !t.includes('Operating Expenses'), 'dashboard hides profit');
    const s = (await db()).sales.find(x => x.status === 'Completed'); await page.goto(FILE + '#sale-' + s.id);
    ok(!(await appText()).includes('Gross Profit') && !(await appText()).includes('Cost of goods'), 'sale hides profit');
  });
  await check('staff can still do their operational work', async () => {
    await page.goto(FILE + '#inventory'); ok((await appText()).includes('SKU'));
    await page.goto(FILE + '#sales'); ok(await page.$('[data-action=sale]'));
    await page.goto(FILE + '#settings'); const tabs = await page.$$eval('.tabs [data-settab]', b => b.map(x => x.dataset.settab)); eq(tabs.join(), 'account', 'only My Account');
  });
  await check('actions are checked too, not just hidden', async () => {
    await page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'recordExpense'; b.id = 'sneaky'; document.body.appendChild(b); });
    await page.click('#sneaky'); ok((await toastText()).includes('Not allowed')); ok(!(await page.$('#mForm')), 'no form opened');
    await page.keyboard.press('Control+k'); const qa = await page.$$eval('#quickPop .pop-item', b => b.map(x => x.textContent.trim()));
    ok(qa.includes('Record Sale') && !qa.includes('Record Expense') && !qa.includes('Add Product'), qa.join());
    await page.keyboard.press('Escape');
  });
  let staffSale;
  await check('records keep who created them', async () => {
    staffSale = await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-SW-125-BLK-R'); let s; transact(() => { s = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Completed', payment: 'Paid', lines: [{ variantId: v.id, qty: 1, unitPrice: 115, discount: 0 }], charges: emptyCharges() }); completeSale(DB, s, { date: todayISO() }); }); persist(); return s.id; });
    const s = (await db()).sales.find(x => x.id === staffSale); eq(s.createdBy, 'Sam Staff');
    ok((await db()).movements.filter(m => m.saleId === staffSale).every(m => m.by === 'Sam Staff'));
    await page.goto(FILE + '#sale-' + staffSale); ok((await appText()).includes('Created by Sam Staff'));
  });
  await check('admin keeps full access and can grant financials to a role', async () => {
    await logout(); await login(ADMIN.email, 'Recovered123'); await page.waitForSelector('#app .page-head');
    for (const h of ['financials', 'reports', 'audit', 'settings']) { await page.goto(FILE + '#' + h); ok(!(await appText()).includes("You don't have access"), h); }
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=roles]');
    ok(await page.$eval('[data-roleperm="admin:viewFinancials"]', c => c.checked && c.disabled), 'admin locked to all');
    await page.check('[data-roleperm="staff:viewFinancials"]'); ok((await db()).roles.find(r => r.id === 'staff').perms.includes('viewFinancials'));
    await page.uncheck('[data-roleperm="staff:viewFinancials"]');
    ok((await db()).audit.some(a => a.action === 'Role permissions changed'));
  });
  await check('deactivated users cannot sign in; their history keeps their name', async () => {
    await page.click('.tabs [data-settab=users]');
    const id = (await db()).users.find(x => x.email === 'sam@evolvetennis.test').id;
    await page.click(`[data-action=toggleUser][data-id="${id}"]`); ok((await page.textContent('#mForm, .modal')).includes("won't be able to sign in")); await save();
    eq((await db()).users.find(x => x.id === id).status, 'Inactive');
    await logout(); await login('sam@evolvetennis.test', 'StaffPass1'); ok((await authText()).includes('deactivated'));
    await login(ADMIN.email, 'Recovered123'); await page.waitForSelector('#app .page-head');
    eq((await db()).sales.find(x => x.id === staffSale).createdBy, 'Sam Staff', 'attribution intact');
    ok((await db()).audit.some(a => a.user === 'Sam Staff'));
  });
  await check('an admin cannot remove the last admin', async () => {
    const id = (await db()).users.find(x => x.roleId === 'admin').id;
    await page.evaluate(i => ACTIONS.toggleUser({ id: i }), id); ok((await toastText()).includes("can't deactivate your own"));
  });

  console.log('Settings');
  await check('business settings persist after signing out and in', async () => {
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=business]');
    await page.fill('[data-setform=business] [name=name]', ''); await page.click('[data-setform=business] [type=submit]'); await page.waitForTimeout(150);
    ok((await appText()).includes('Enter the business name'));
    await page.fill('[data-setform=business] [name=name]', 'Evolve Tennis Pte. Ltd.'); await page.fill('[data-setform=business] [name=email]', 'hello@evolvetennis.test'); await page.click('[data-setform=business] [type=submit]'); await page.waitForTimeout(200);
    await logout(); await login(ADMIN.email, 'Recovered123'); await page.waitForSelector('#app .page-head');
    eq((await db()).settings.business.name, 'Evolve Tennis Pte. Ltd.');
    ok((await db()).audit.some(a => a.action === 'Settings updated' && a.desc.includes('Evolve Tennis Pte. Ltd.')));
  });
  await check('document prefixes change future numbers only', async () => {
    const oldNos = (await db()).sales.map(s => s.no).join();
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=numbering]');
    await page.fill('[data-setform=numbering] [name=SAL]', 'P1'); await page.click('[data-setform=numbering] [type=submit]'); await page.waitForTimeout(150);
    ok((await appText()).includes('2 to 6 letters'));
    await page.fill('[data-setform=numbering] [name=SAL]', 'PUR'); await page.click('[data-setform=numbering] [type=submit]'); await page.waitForTimeout(150);
    ok((await appText()).includes('its own prefix'));
    await page.fill('[data-setform=numbering] [name=SAL]', 'SO'); await page.click('[data-setform=numbering] [type=submit]'); await page.waitForTimeout(200);
    const no = await page.evaluate(() => { let s; transact(() => { s = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Draft', payment: 'Unpaid', lines: [{ variantId: DB.variants[0].id, qty: 1, unitPrice: 10, discount: 0 }], charges: emptyCharges() }); }); persist(); return s.no; });
    ok(/^SO-\d{4}-0001$/.test(no), no); eq((await db()).sales.slice(0, -1).map(s => s.no).join(), oldNos, 'history unchanged');
    await page.fill('[data-setform=numbering] [name=SAL]', 'SAL'); await page.click('[data-setform=numbering] [type=submit]'); await page.waitForTimeout(150);
  });
  await check('date format and rows per page apply and persist', async () => {
    await page.click('.tabs [data-settab=system]'); await page.selectOption('[data-setform=system] [name=dateFormat]', 'DD/MM/YYYY'); await page.click('[data-setform=system] [type=submit]'); await page.waitForTimeout(200);
    eq(await page.evaluate(() => fmtDate('2026-10-09')), '09/10/2026');
    await page.click('.tabs [data-settab=account]'); await page.selectOption('[data-setform=account] [name=rowsPerPage]', '25'); await page.click('[data-setform=account] [type=submit]'); await page.waitForTimeout(200);
    await page.goto(FILE + '#sales'); ok((await page.textContent('#salTable')).includes('Showing 1–25'), 'paged at 25');
    await page.click('[data-pgnext="sal"]'); ok((await page.textContent('#salTable')).includes('Showing 26–50'));
    await page.reload(); await page.waitForSelector('#salTable'); ok((await page.textContent('#salTable')).includes('of 25') === false && (await page.textContent('#salTable')).includes('Showing 1–25'), 'kept after reload');
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=system]'); await page.selectOption('[data-setform=system] [name=dateFormat]', 'D MMM YYYY'); await page.click('[data-setform=system] [type=submit]'); await page.waitForTimeout(150);
  });
  await check('the default reorder level fills new variants', async () => {
    await page.evaluate(() => { DB.settings.inventory.defaultReorder = 7; persist(); });
    await page.goto(FILE + '#products'); await page.click('[data-action=addProduct]');
    eq(await page.inputValue('#vList [data-vbox] [name=reorder]'), '7');
    await page.click('.modal-foot [data-action=close]'); const d = await page.$('[data-discard]'); if (d) await d.click();
  });

  console.log('Imports');
  const csv = ['Product Name,Brand,Category,SKU,Gauge,Colour,Packaging,Cost Price,Selling Price,Opening Stock,Reorder Level,Status',
    'MSV Import Test,MSV,Tennis Strings,MSV-IMP-125-BLK-R,1.25,Black,Reel,80,120,12,4,Active',
    'MSV Import Test,MSV,Tennis Strings,MSV-IMP-125-WHT-R,1.25,White,Reel,80,110,0,4,Active',
    'MSV Import Test,MSV,Tennis Strings,MSV-IMP-125-BLK-R,1.25,Black,Set,8,14,5,4,Active',
    'MSV Focus Hex,MSV,Tennis Strings,MSV-FH-123-BLK-R,1.23,Black,Reel,90,130,0,8,Active',
    ',MSV,Tennis Strings,MSV-IMP-NONAME,,,,1,2,0,0,',
    'Bad Qty,MSV,Tennis Strings,MSV-IMP-BADQ,,,,1,2,2.5,0,',
    'Bad Price,MSV,Tennis Strings,MSV-IMP-BADP,,,,abc,2,0,0,',
    'Unknown Cat,MSV,Racquets,MSV-IMP-CAT,,,,1,2,0,0,'].join('\n');
  await check('product import validates and previews before anything is created', async () => {
    const before = (await db()).variants.length;
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=data]');
    await page.setInputFiles('#impFile', { name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await page.waitForTimeout(300);
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.trim()));
    eq(k.join('|'), '2|0|5|1', 'ready | warnings | errors | skipped');
    const t = await appText();
    for (const m of ['Duplicate SKU in this file', 'Missing product name', 'Invalid opening stock', 'Invalid cost price', 'Unknown category "Racquets"', 'SKU already exists']) ok(t.includes(m), m);
    eq((await db()).variants.length, before, 'nothing created yet');
  });
  await check('updating existing SKUs is an explicit choice; invalid rows are never imported', async () => {
    await page.selectOption('#impMode', 'update'); await page.waitForTimeout(150);
    ok((await appText()).includes('Existing SKU: cost, selling price'), 'update warning');
    await page.click('[data-action=confirmImport]'); ok((await page.textContent('.modal')).includes('will not be imported')); await save(); await page.waitForTimeout(200);
    const d = await db(), v = d.variants.find(x => x.sku === 'MSV-IMP-125-BLK-R');
    ok(v && v.qty === 12, 'created with opening stock'); ok(d.movements.some(m => m.variantId === v.id && m.type === 'opening' && m.change === 12), 'opening movement');
    eq(d.variants.find(x => x.sku === 'MSV-FH-123-BLK-R').price, 130, 'existing SKU updated'); eq(d.variants.filter(x => x.sku === 'MSV-FH-123-BLK-R').length, 1, 'still unique');
    ok(!d.variants.some(x => ['MSV-IMP-NONAME', 'MSV-IMP-BADQ', 'MSV-IMP-BADP', 'MSV-IMP-CAT'].includes(x.sku)), 'invalid rows skipped');
    eq(d.products.filter(p => p.name === 'MSV Import Test').length, 1, 'one product for both variants');
    eq(await page.evaluate(() => ledgerCheck().length), 0); ok(d.audit.some(a => a.action === 'Data imported'));
  });
  await check('customer and supplier imports use the same checks', async () => {
    await page.click('[data-imptype="Customers"]'); await page.selectOption('#impMode', 'skip');
    await page.fill('#impText', 'Customer Name,Customer Type,Country,Email,Default Currency\nNew Club SG,Tennis Academy,Singapore,club@example.com,SGD\nKallang Tennis Hub,Retail Shop,Singapore,,SGD\nBad Email Co,Other,Malaysia,not-an-email,MYR');
    await page.click('[data-action=startImport]'); await page.waitForTimeout(150);
    const k = await page.$$eval('.kpi .kpi-value', e => e.map(x => x.innerText.trim())); eq(k.join('|'), '1|0|1|1');
    await page.click('[data-action=confirmImport]'); await save(); await page.waitForTimeout(150);
    ok((await db()).customers.some(c => c.name === 'New Club SG' && c.type === 'Tennis Academy')); ok(!(await db()).customers.some(c => c.name === 'Bad Email Co'));
    await page.click('[data-imptype="Suppliers"]');
    await page.fill('#impText', 'Supplier Name,Country,Default Currency\nCourt Supplies Co,Taiwan,TWD\nMSV GmbH,Germany,EUR');
    await page.click('[data-action=startImport]'); await page.waitForTimeout(150);
    ok((await appText()).includes('TWD will be added'));
    await page.click('[data-action=confirmImport]'); await save(); await page.waitForTimeout(150);
    ok((await db()).suppliers.some(s => s.name === 'Court Supplies Co')); eq((await db()).suppliers.filter(s => s.name === 'MSV GmbH').length, 1);
  });

  console.log('Exports');
  await check('the full inventory export matches stock and follows the status filter', async () => {
    const all = parseCSV(await page.evaluate(() => doExport('inventory')));
    eq(all[0].slice(0, 3).join(), 'Product,Variant,SKU'); ok(all[0].includes('Last Purchase Date') && all[0].includes('Last Sale Date') && all[0].includes('Inventory Value (SGD)'));
    const d = await db(); eq(all.length - 1, d.variants.length);
    const fh = all.find(r => r[2] === 'MSV-FH-118-BLK-R'), v = d.variants.find(x => x.sku === 'MSV-FH-118-BLK-R'); eq(+fh[7], v.qty); eq(+fh[12], Math.round(v.qty * v.cost * 100) / 100);
    await page.selectOption('[data-expstatus=inventory]', 'Low Stock');
    const low = parseCSV(await page.evaluate(() => doExport('inventory'))); ok(low.slice(1).every(r => r[9] === 'Low Stock') && low.length > 1);
    await page.selectOption('[data-expstatus=inventory]', '');
  });
  await check('transaction exports follow the period, status and search', async () => {
    await page.selectOption('#period', 'This Year');
    await page.selectOption('[data-expstatus=sales]', 'Completed');
    const s = parseCSV(await page.evaluate(() => doExport('sales'))), y = new Date().getFullYear() + '';
    ok(s.slice(1).every(r => r[5] === 'Completed' && r[1].startsWith(y)), 'status and period');
    eq(s.length - 1, (await db()).sales.filter(x => x.status === 'Completed' && x.date.startsWith(y)).length);
    await page.fill('#expCQ', 'Kallang'); await page.waitForTimeout(150);
    ok(parseCSV(await page.evaluate(() => doExport('sales'))).slice(1).every(r => r.join(' ').includes('Kallang')));
    await page.fill('#expCQ', ''); await page.selectOption('[data-expstatus=sales]', '');
  });
  await check('system data export is complete and contains no passwords; it can be restored', async () => {
    const json = await page.evaluate(() => systemExport()), o = JSON.parse(json);
    for (const k of ['products', 'variants', 'customers', 'suppliers', 'purchases', 'sales', 'movements', 'returns', 'expenses', 'incomes']) ok(Array.isArray(o.data[k]), k);
    ok(!json.includes('"pw"') && !json.includes('"recovery"') && !json.includes('Recovered123'), 'no secrets');
    const n = o.data.sales.length;
    await page.evaluate(() => { DB.sales.push({ ...DB.sales[0], id: 'tmp', no: 'TMP-1' }); persist(); });
    await page.setInputFiles('#restoreFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) }); await page.waitForTimeout(300);
    ok((await page.textContent('.modal')).includes('Users and roles here are kept')); await save(); await page.waitForTimeout(200);
    eq((await db()).sales.length, n, 'restored'); ok((await db()).users.length >= 2, 'users kept');
    await page.waitForSelector('#app .page-head'); eq(await page.evaluate(() => ledgerCheck().length), 0);
    const bad = await page.evaluate(() => checkRestore('{"app":"Other"}').error); ok(bad.includes("wasn't made by Export System Data"));
  });

  console.log('Notifications');
  await check('low stock and out of stock notifications fire once on the change, with working links', async () => {
    const v = await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-IMP-125-BLK-R'); return { id: v.id, qty: v.qty, reorder: v.reorder }; });
    const sell = n => page.evaluate(([id, n]) => { postMovement(DB, id, { type: 'lost', change: -n, reason: 'Lost Stock', notes: 'test' }); persist(); }, [v.id, n]);
    await sell(v.qty - v.reorder);
    const low = () => page.evaluate(id => DB.notifications.filter(n => n.key === 'low:' + id).length, v.id);
    eq(await low(), 1, 'low created'); await sell(1); eq(await low(), 1, 'no duplicate while still low');
    await page.reload(); await page.waitForSelector('#app .page-head'); eq(await low(), 1, 'no duplicate on reload');
    await sell(v.reorder - 1); eq(await page.evaluate(id => DB.notifications.filter(n => n.key === 'out:' + id).length, v.id), 1, 'out of stock');
    await page.click('#notifBtn'); const item = await page.$(`[data-noteopen]`); ok(item, 'listed');
    ok((await page.textContent('#notifPop')).includes('Out of stock: MSV Import Test'));
    await page.click('#notifPop .note-item:has-text("Out of stock: MSV Import Test")'); await page.waitForTimeout(100);
    ok(page.url().endsWith('#variant-' + v.id), 'opens the SKU');
  });
  await check('discrepancies notify and link to the stock count', async () => {
    await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-SW-130-BLK-R').qty += 3; persist(); lastCheck = 0; render(); });
    const n = await page.evaluate(() => DB.notifications.find(n => n.type === 'discrepancy' && !n.resolved)); ok(n && n.link === 'stockcount');
    await page.evaluate(() => { DB.variants.find(v => v.sku === 'MSV-SW-130-BLK-R').qty -= 3; persist(); lastCheck = 0; render(); });
    ok(await page.evaluate(() => DB.notifications.filter(n => n.type === 'discrepancy').every(n => n.resolved)), 'resolved when fixed');
  });
  await check('read, dismiss, restore and mark all as read', async () => {
    await page.goto(FILE + '#notifications'); await page.click('[data-notefilter=All]');
    const first = await page.getAttribute("#app [data-notedismiss]", "data-notedismiss"); await page.click(`#app [data-notedismiss="${first}"]`);
    await page.click('[data-notefilter=Dismissed]'); ok(await page.$(`#app [data-noterestore="${first}"]`)); await page.click(`#app [data-noterestore="${first}"]`);
    await page.click('[data-notefilter=Unread]'); if (await page.$('[data-action=markAllRead]')) await page.click('[data-action=markAllRead]');
    ok((await appText()).includes('No unread notifications')); ok(await page.evaluate(id => DB.notifications.some(n => n.id === id), first), 'dismissed notices stay on record');
  });

  console.log('Inventory safety');
  await check('two tabs cannot oversell the same stock', async () => {
    const vid = await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-IMP-125-WHT-R'); postMovement(DB, v.id, { type: 'adjustment', change: 10, reason: 'Data Correction', notes: 'test' }); persist(); return v.id; });
    const page2 = await ctx.newPage(); page2.on('pageerror', e => errors.push('tab2: ' + e.message));
    await page2.goto(FILE + '#inventory'); await page2.waitForSelector('#authForm'); await page2.fill('#authForm [name=email]', ADMIN.email); await page2.fill('#authForm [name=password]', 'Recovered123'); await page2.click('#authForm [type=submit]'); await page2.waitForSelector('#app .page-head');
    const sell = (p, q) => p.evaluate(([id, q]) => { try { let s; transact(() => { s = createSaleRecord(DB, { customerId: 'c-kth', date: todayISO(), country: 'Singapore', currency: 'SGD', fxRate: 1, status: 'Draft', payment: 'Unpaid', lines: [{ variantId: id, qty: q, unitPrice: 100, discount: 0 }], charges: emptyCharges() }); completeSale(DB, s, { date: todayISO() }); }); persist(); return 'ok'; } catch (e) { return e.message; } }, [vid, q]);
    await page2.evaluate(() => { ACTIONS.addCustomer(); F($('#mForm'), 'name').value = 'Typing in tab 2'; modal.dirty = true; }); // tab 2 has a form open, so it keeps its copy
    eq(await sell(page, 8), 'ok', 'tab 1 sells 8');
    await page2.waitForTimeout(500);
    const r = await sell(page2, 5); ok(/changed in another tab/.test(r), 'stale tab is stopped: ' + r);
    ok((await page2.textContent('#toastRoot')).includes('Stock changed while this page was open'), 'explained');
    eq(await page2.evaluate(id => DB.variants.find(v => v.id === id).qty, vid), 2, 'tab 2 now shows the latest stock');
    const r2 = await sell(page2, 5); ok(/Only 2/.test(r2), 'then the stock check refuses: ' + r2);
    const q = await page.evaluate(id => { DB = freezeLedger(migrate(Store.load())); return DB.variants.find(v => v.id === id).qty; }, vid); eq(q, 2, 'never negative');
    eq(await page2.evaluate(() => ledgerCheck().length), 0); await page2.close();
  });
  await check('receiving, completing and returning cannot run twice', async () => {
    const r = await page.evaluate(() => { const out = []; const tryIt = f => { try { transact(f); return 'ran'; } catch (e) { return e.message; } };
      const p = DB.purchases.find(x => x.status === 'Received'); out.push(tryIt(() => receivePurchase(DB, p, { date: todayISO() })));
      const s = DB.sales.find(x => x.status === 'Completed'); out.push(tryIt(() => completeSale(DB, s, { date: todayISO() })));
      const ret = DB.returns.find(x => x.status === 'Completed'); out.push(tryIt(() => completeCustomerReturn(DB, ret, { date: todayISO() })));
      const sr = DB.supplierReturns.find(x => x.status === 'Completed'); out.push(tryIt(() => completeSupplierReturn(DB, sr, { date: todayISO() })));
      const v = DB.variants[0]; out.push(tryIt(() => { postMovement(DB, v.id, { type: 'adjustment', change: 1, reason: 'x', notes: 'x', opId: 'op-test' }); postMovement(DB, v.id, { type: 'adjustment', change: 1, reason: 'x', notes: 'x', opId: 'op-test' }); }));
      return out; });
    ok(r[0].includes("can't be received again"), r[0]); ok(r[1].includes("can't be completed again"), r[1]); ok(r[2].includes('already been completed'), r[2]); ok(/already|completed/i.test(r[3]), r[3]); ok(r[4].includes('already saved'), r[4]);
  });
  await check('double-clicking save records an adjustment once, and large changes ask first', async () => {
    const v = await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-FH-118-BLK-R'); return { id: v.id, qty: v.qty }; });
    const moves = () => page.evaluate(id => DB.movements.filter(m => m.variantId === id).length, v.id), m0 = await moves();
    await page.goto(FILE + '#variant-' + v.id); await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.fill('#mForm [name=qty]', '1'); await page.selectOption('#mForm [name=reason]', 'Lost Stock'); await page.fill('#mForm [name=notes]', 'double click test');
    await page.dblclick('.modal-foot [data-action=save]'); await page.waitForTimeout(200);
    eq(await moves(), m0 + 1, 'one movement');
    await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`); await page.click('[data-adjtype=set]');
    await page.fill('#mForm [name=qty]', '5'); await page.selectOption('#mForm [name=reason]', 'Physical Count Correction'); await page.fill('#mForm [name=notes]', 'big');
    await save(); ok((await page.textContent('#mForm')).includes('Large inventory adjustment detected')); eq(await moves(), m0 + 1, 'not saved yet');
    await save(); eq(await moves(), m0 + 2, 'saved on confirmation');
    ok(await page.evaluate(() => DB.notifications.some(n => n.type === 'largeAdj')), 'large adjustment notified');
  });

  console.log('System health');
  await check('integrity checks find discrepancies, duplicates and negative stock without changing data', async () => {
    await page.goto(FILE + '#settings'); await page.click('.tabs [data-settab=health]');
    ok(!(await appText()).includes('Action Needed'), 'healthy to start');
    await page.evaluate(() => { const v = DB.variants.find(x => x.sku === 'MSV-CF-123-RED-R'); v.qty += 2; DB.sales.push({ ...JSON.parse(JSON.stringify(DB.sales[0])), id: 'dup-sale', status: 'Draft' }); persist(); });
    await page.click('[data-action=runHealth]'); const t = await appText();
    ok(t.includes('Action Needed') && t.includes('MSV-CF-123-RED-R: stored') && t.includes(`${(await db()).sales[0].no} × 2`), 'found');
    const q = await page.evaluate(() => DB.variants.find(x => x.sku === 'MSV-CF-123-RED-R').qty); ok(q > 0, 'not auto-corrected');
    await page.evaluate(() => { DB.variants.find(x => x.sku === 'MSV-CF-123-RED-R').qty -= 2; DB.sales = DB.sales.filter(s => s.id !== 'dup-sale'); persist(); });
    const neg = await page.evaluate(() => { const v = DB.variants[1]; const was = v.qty; v.qty = -1; const r = healthChecks().find(c => c.name === 'Negative stock').level; v.qty = was; return r; }); eq(neg, 'Action Needed');
  });

  console.log('Activity log, search and UX');
  await check('activity log filters by user, module, date and reference', async () => {
    await page.goto(FILE + '#audit'); await page.selectOption('[data-audf=user]', 'Sam Staff');
    const users = await page.$$eval('#app tbody tr td:nth-child(2) b', b => [...new Set(b.map(x => x.textContent))]); eq(users.join(), 'Sam Staff');
    await page.click('[data-action=resetAud]'); await page.fill('[data-audf=from]', '2026-12-31'); await page.fill('[data-audf=to]', '2026-01-01');
    ok((await appText()).includes('From date is after the To date'), 'date range explained');
    await page.click('[data-action=resetAud]');
  });
  await check('global search groups results and opens them', async () => {
    const no = (await db()).sales[0].no;
    await page.fill('#globalSearchInput', no); await page.waitForTimeout(100);
    ok((await page.textContent('#searchPop')).includes('Sales'));
    await page.keyboard.press('Enter'); await page.waitForTimeout(100); ok(page.url().includes('#sale-'), 'opened the sale');
    await page.fill('#globalSearchInput', 'kallang'); await page.waitForTimeout(100); ok((await page.textContent('#searchPop')).includes('Customers'));
    await page.fill('#globalSearchInput', 'MOV-2026-000001'); await page.waitForTimeout(100); ok((await page.textContent('#searchPop')).includes('Stock movements'));
    await page.fill('#globalSearchInput', '');
  });
  await check('unsaved changes are protected; filters are not', async () => {
    await page.goto(FILE + '#purchases'); await page.click('.page-head [data-action=purchase]');
    await page.fill('#mForm [name=notes]', 'Fifteen items to enter'); await page.keyboard.press('Escape');
    ok((await page.textContent('.modal-foot')).includes('You have unsaved changes. Leave without saving?'));
    await page.click('[data-keepedit]'); eq(await page.inputValue('#mForm [name=notes]'), 'Fifteen items to enter');
    await page.evaluate(() => { location.hash = 'dashboard'; }); await page.waitForTimeout(150);
    ok(page.url().endsWith('#purchases') && await page.$('#mForm'), 'navigation held back'); await page.click('[data-discard]'); await page.waitForTimeout(150);
    ok(page.url().endsWith('#dashboard') && !(await page.$('#mForm')), 'left after confirming');
    await page.goto(FILE + '#sales'); await page.fill('#salQ', 'Kallang'); await page.goto(FILE + '#dashboard'); ok(!(await page.$('[data-discard]')), 'no prompt for filters');
  });
  await check('errors explain what to fix', async () => {
    const v = await page.evaluate(() => DB.variants.find(x => x.qty > 0 && x.qty < 10));
    await page.goto(FILE + '#variant-' + v.id); await page.click(`.page-head [data-action=adjust][data-id="${v.id}"]`);
    await page.fill('#mForm [name=qty]', String(v.qty + 5)); await page.selectOption('#mForm [name=reason]', 'Lost Stock'); await page.fill('#mForm [name=notes]', 'x'); await save();
    ok((await page.textContent('#mForm')).includes(`Only ${v.qty} in stock`)); ok(!(await page.textContent('#mForm')).includes('Something went wrong'));
    await page.click('.modal-foot [data-action=close]'); const d = await page.$('[data-discard]'); if (d) await d.click();
  });
  await check('phone layout: no sideways scrolling and quick tasks', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const h of ['dashboard', 'sales', 'inventory', 'settings']) { await page.goto(FILE + '#' + h); await page.waitForTimeout(100); eq(await page.evaluate(() => document.documentElement.scrollWidth), 390, h); }
    await page.goto(FILE + '#dashboard'); ok(await page.isVisible('.mobile-tasks'), 'quick tasks shown');
    await page.click('[data-mtask="__sale"]'); ok(await page.$('#mForm')); const b = await page.$eval('.modal', m => m.getBoundingClientRect().right); ok(b <= 390, 'form fits');
    await page.click('.modal-foot [data-action=close]'); const d = await page.$('[data-discard]'); if (d) await d.click();
    await page.setViewportSize({ width: 1400, height: 1000 });
  });

  console.log('Security');
  await check('no database keys or secrets are shipped in the page', async () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    for (const k of ['service_role', 'SUPABASE_KEY', 'apikey', 'secret_key', 'BEGIN PRIVATE KEY']) ok(!src.includes(k), k);
  });
  await check('the stock ledger still balances and nothing crashed', async () => {
    eq(await page.evaluate(() => ledgerCheck().length), 0);
    eq(errors.length, 0, errors.join(' | '));
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
