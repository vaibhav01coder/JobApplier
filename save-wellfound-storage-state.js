const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ─── load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const out = {};
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const ENV = loadEnv();
const g = (k, d = '') => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : (ENV[k] || d));

const WELLFOUND_EMAIL    = g('WELLFOUND_EMAIL')    || g('GOOGLE_EMAIL');
const WELLFOUND_PASSWORD = g('WELLFOUND_PASSWORD') || g('GOOGLE_PASSWORD');
const LOGIN_URL          = g('WELLFOUND_LOGIN_URL', 'https://wellfound.com/login');
const JOBS_URL           = g('WELLFOUND_AFTER_LOGIN_URL', 'https://wellfound.com/jobs');
const STORAGE_STATE_PATH = path.join(__dirname, 'playwright/.auth/wellfound.json');
const PROFILE_DIR        = path.join(__dirname, '.wellfound-chrome-profile');

const isCI = String(process.env.CI || '').toLowerCase() === 'true';

// ─── helpers ──────────────────────────────────────────────────────────────────
async function tryVisible(locator, timeout = 3000) {
  try { await locator.waitFor({ state: 'visible', timeout }); return true; }
  catch { return false; }
}

// ─── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!WELLFOUND_EMAIL || !WELLFOUND_PASSWORD) {
    console.error('ERROR: WELLFOUND_EMAIL and WELLFOUND_PASSWORD must be set in .env or as environment variables.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  let browser = null;
  let context;

  if (isCI) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,900',
      ],
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  } else {
    // Locally: use persistent Chrome profile (likely already logged in)
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--no-first-run', '--no-default-browser-check'],
    });
  }

  const page = isCI ? await context.newPage() : (context.pages()[0] || await context.newPage());

  console.log('Opening Wellfound login page...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const alreadyLoggedIn = !page.url().includes('/login');

  if (alreadyLoggedIn) {
    console.log('Already logged in — skipping login flow.');
  } else {
    console.log(`Logging in as ${WELLFOUND_EMAIL}...`);

    // ── Step 1: fill email ──────────────────────────────────────────────────
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();

    if (await tryVisible(emailInput, 5000)) {
      await emailInput.fill(WELLFOUND_EMAIL);
      await page.waitForTimeout(500);

      // Some forms show password immediately; others need a "Continue" click
      const passwordVisible = await tryVisible(page.locator('input[type="password"]').first(), 1000);

      if (!passwordVisible) {
        const continueBtn = page.getByRole('button', { name: /continue|next|sign in/i }).first();
        if (await tryVisible(continueBtn, 3000)) {
          await continueBtn.click({ force: true });
          await page.waitForTimeout(2000);
        } else {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }

      // ── Step 2: fill password ─────────────────────────────────────────────
      const passInput = page.locator('input[type="password"]').first();
      if (await tryVisible(passInput, 5000)) {
        await passInput.fill(WELLFOUND_PASSWORD);
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
      } else {
        console.warn('Password field not found after entering email.');
      }

    } else {
      // ── Fallback: Google OAuth ──────────────────────────────────────────
      console.log('Email field not found — trying Google OAuth...');
      const googleBtn = page
        .getByRole('link', { name: /google/i })
        .or(page.getByRole('button', { name: /google/i }))
        .first();

      if (await tryVisible(googleBtn, 5000)) {
        await googleBtn.click({ force: true });
        await page.waitForTimeout(3000);

        // Google account chooser / email step
        const gEmail = page.locator('input[type="email"]').first();
        if (await tryVisible(gEmail, 8000)) {
          await gEmail.fill(WELLFOUND_EMAIL);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);

          const gPass = page.locator('input[type="password"]').first();
          if (await tryVisible(gPass, 8000)) {
            await gPass.fill(WELLFOUND_PASSWORD);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(5000);
          }
        }
      } else {
        console.error('Could not find an email field or Google button on the login page.');
        if (isCI) { await browser.close(); process.exit(1); }
      }
    }

    // Wait for redirect away from login page
    await page.waitForURL(u => !u.includes('/login'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log('URL after login:', url);

    if (url.includes('/login')) {
      console.error('Login failed — still on login page. Check credentials.');
      if (isCI) { await browser.close(); process.exit(1); }
    }
  }

  // Navigate to jobs page to bake a richer session state
  await page.goto(JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log('Session saved to:', STORAGE_STATE_PATH);

  if (isCI) {
    await browser.close();
  } else {
    await context.close();
  }
})();
