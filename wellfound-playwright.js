const { chromium } = require('playwright');
const path = require('path');

const {
  wellfoundLoginUrl,
  wellfoundAfterLoginUrl,
} = require('./config');

const LOGIN_MODE = process.argv.includes('login');

const PROFILE_DIR = path.join(__dirname, '.wellfound-chrome-profile');

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: {
      width: 1280,
      height: 900,
    },
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--window-size=1280,900',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  if (LOGIN_MODE) {
    console.log('Opening Wellfound login page...');
    console.log('URL:', wellfoundLoginUrl);

    await page.goto(wellfoundLoginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log('\nLogin manually in the opened Chrome browser.');
    console.log('Use Google login if needed.');
    console.log('After login is complete, close the browser window.');
    console.log('Session will be saved automatically in:');
    console.log(PROFILE_DIR);

    await new Promise(resolve => {
      context.on('close', resolve);
    });

    console.log('\nBrowser closed. Session saved.');
    return;
  }

  console.log('Opening Wellfound with saved session...');
  console.log('URL:', wellfoundAfterLoginUrl);

  await page.goto(wellfoundAfterLoginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  console.log('Current URL:', currentUrl);

  if (currentUrl.includes('/login')) {
    throw new Error(
      'You are not logged in. First run: node wellfound-playwright.js login'
    );
  }

  console.log('Logged in successfully using saved browser profile.');

  // Your normal automation can continue here.
  // Example:
  await page.waitForSelector('body', {
    timeout: 30000,
  });

  console.log('Page loaded.');

  await context.close();
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});