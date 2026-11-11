// Shared sign-in for the browser tests. On a fresh browser it creates the first admin
// through the real setup screen; afterwards it signs in through the login screen.
const ADMIN = { name: 'Test Admin', email: 'admin@evolvetennis.test', password: 'Tennis2026' };

async function signIn(page, who = ADMIN) {
  await page.waitForSelector('#authForm, #app .page-head, #codeSaved', { timeout: 15000 });
  if (await page.$('#app .page-head') && !(await page.$('#authRoot:not([hidden]) #authForm'))) return;
  if (await page.$('#authForm[data-auth=setup]')) {
    await page.fill('#authForm [name=name]', who.name);
    await page.fill('#authForm [name=email]', who.email);
    await page.fill('#authForm [name=password]', who.password);
    await page.fill('#authForm [name=confirm]', who.password);
    await page.click('#authForm [type=submit]');
    await page.waitForSelector('#codeSaved', { timeout: 15000 });
  } else if (await page.$('#authForm[data-auth=login]')) {
    await page.fill('#authForm [name=email]', who.email);
    await page.fill('#authForm [name=password]', who.password);
    await page.click('#authForm [type=submit]');
  }
  if (await page.$('#codeSaved').catch(() => null)) {
    await page.check('#codeSaved');
    await page.click('#codeDone');
  }
  await page.waitForSelector('#app .page-head', { timeout: 15000 });
}
// Closes the open form. If it asks about unsaved changes, confirm leaving without saving.
async function closeM(page) {
  await page.click('.modal-foot [data-action=close]');
  const d = await page.$('[data-discard]');
  if (d) await d.click();
}
// Saves the open form. Large stock adjustments ask for a second confirmation; give it.
async function saveM(page) {
  await page.click('.modal-foot [data-action=save]');
  if (await page.$('#mAlert:has-text("Large inventory adjustment detected")')) await page.click('.modal-foot [data-action=save]');
}
// Deactivating asks for confirmation; confirm it.
async function confirmM(page) {
  await page.waitForTimeout(50);
  if (await page.$('.modal-foot [data-action=save]')) await page.click('.modal-foot [data-action=save]');
}
module.exports = { signIn, closeM, saveM, confirmM, ADMIN };
