const { test } = require('@playwright/test');

test('test', async ({ page }) => {
  await page.goto('file:///C:/Users/RManojKhanna/Vsc/Stride-Website1/index.html');
  await page.getByRole('link', { name: 'Collection' }).click();
  await page.getByRole('searchbox', { name: '· Search and select a location' }).click();
  await page.getByRole('searchbox', { name: '· Search and select a location' }).fill('alaska');
  await page.getByRole('option', { name: 'Alaska Chiapas · Mexico' }).click();
  await page.getByLabel('· How are you commuting?').selectOption('Cycle');
  await page.getByRole('button', { name: 'Explore this pair   ↗' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
});
