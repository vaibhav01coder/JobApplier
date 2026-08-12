const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const {
  wellfoundLoginUrl = 'https://wellfound.com/login',
  wellfoundAfterLoginUrl = 'https://wellfound.com/jobs',
} = require('./config');

const MODE = process.argv[2];

const PROFILE_DIR = path.join(__dirname, '.wellfound-chrome-profile');
const AUTH_FILE = path.join(__dirname, 'playwright/.auth/wellfound.json');

function findChrome() {
  const candidates = [];

  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium'
    );
  }

  for (const chromePath of candidates) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  throw new Error('Google Chrome not found. Install Chrome or set CHROME_PATH env variable.');
}

function resetProfile() {
  console.log('Removing old Wellfound profile/session data...');

  fs.rmSync(PROFILE_DIR, {
    recursive: true,
    force: true,
  });

  fs.rmSync(AUTH_FILE, {
    force: true,
  });

  console.log('Deleted:');
  console.log(PROFILE_DIR);
  console.log(AUTH_FILE);
}

function openNormalChromeForLogin() {
  fs.mkdirSync(PROFILE_DIR, {
    recursive: true,
  });

  const chromePath = findChrome();

  console.log('Opening normal Chrome, not Playwright browser.');
  console.log('Chrome path:', chromePath);
  console.log('Profile dir:', PROFILE_DIR);
  console.log('Login URL:', wellfoundLoginUrl);

  const args = [
    `--user-data-dir=${PROFILE_DIR}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    wellfoundLoginUrl,
  ];

  const child = spawn(chromePath, args, {
    stdio: 'inherit',
  });

  console.log('\nLogin manually with Google in the opened Chrome browser.');
  console.log('After login is completed, close Chrome.');
  console.log('The session will be saved automatically in:');
  console.log(PROFILE_DIR);

  child.on('exit', () => {
    console.log('\nChrome closed. Login session should now be saved.');
    console.log('Now run:');
    console.log('node wellfound-session.js run');
  });
}

async function runWithSavedSession() {
  console.log('Opening Wellfound using saved Chrome profile...');
  console.log('Profile dir:', PROFILE_DIR);

  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error('Profile does not exist. First run: node wellfound-session.js login');
  }

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

  await page.goto(wellfoundAfterLoginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  console.log('Current URL:', page.url());

  if (page.url().includes('/login')) {
    await context.close();
    throw new Error('Not logged in. Run: node wellfound-session.js login');
  }

  console.log('Logged in successfully using saved profile.');

  // Continue your automation here
  await page.waitForSelector('body', {
    timeout: 30000,
  });

  await page.waitForTimeout(5000);

  await context.close();
}

(async () => {
  if (MODE === 'reset') {
    resetProfile();
    return;
  }

  if (MODE === 'login') {
    openNormalChromeForLogin();
    return;
  }

  if (MODE === 'run') {
    await runWithSavedSession();
    return;
  }

  console.log('Usage:');
  console.log('node wellfound-session.js reset');
  console.log('node wellfound-session.js login');
  console.log('node wellfound-session.js run');
})();