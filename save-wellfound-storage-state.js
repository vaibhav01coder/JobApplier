const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, '.wellfound-chrome-profile');
const STORAGE_STATE_PATH = path.join(__dirname, 'playwright/.auth/wellfound.json');

(async () => {
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: {
      width: 1280,
      height: 900,
    },
  });

  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://wellfound.com/jobs', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('If not logged in, login manually now.');
  console.log('After Wellfound jobs page opens logged-in, press Ctrl+C? No.');
  console.log('Wait 20 seconds, then storage state will be saved.');

  await page.waitForTimeout(20000);

  await context.storageState({
    path: STORAGE_STATE_PATH,
  });

  console.log('Saved storage state:', STORAGE_STATE_PATH);

  await context.close();
})();