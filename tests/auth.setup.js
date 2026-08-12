const { test: setup, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { CREDS, naukriProfileUrl } = require('../config');

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

setup('login and save session', async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  if (!CREDS.email || !CREDS.password) {
    throw new Error('Missing email/password. Check GOOGLE_EMAIL and GOOGLE_PASSWORD in .env');
  }

  console.log('Opening login/profile URL:', naukriProfileUrl);

  await page.goto(naukriProfileUrl, {
    waitUntil: 'domcontentloaded',
  });

  /**
   * If already logged in, save session directly.
   */
  if (page.url().includes('/mnjuser/profile')) {
    console.log('Already logged in. Saving session...');
    await page.context().storageState({ path: authFile });
    console.log('Session saved:', authFile);
    return;
  }

  /**
   * Click Login button if visible.
   * Adjust if your site has a different login button.
   */
  const loginButton = page.locator('#login_Layer, text=Login').first();

  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click();
  }

  /**
   * Fill email/username.
   * These selectors are written to support common login forms.
   */
  const emailInput = page
    .locator(
      'input[type="email"], input[name="email"], input[name="username"], input[placeholder*="Email"], input[placeholder*="Username"], input[placeholder*="email"], input[placeholder*="username"]'
    )
    .first();

  await expect(emailInput).toBeVisible({ timeout: 30000 });
  await emailInput.fill(CREDS.email);

  /**
   * Fill password.
   */
  const passwordInput = page
    .locator('input[type="password"], input[name="password"], input[placeholder*="password"], input[placeholder*="Password"]')
    .first();

  await expect(passwordInput).toBeVisible({ timeout: 30000 });
  await passwordInput.fill(CREDS.password);

  /**
   * Click final login/sign-in button.
   */
  await page
    .getByRole('button', { name: /login|sign in|continue/i })
    .first()
    .click();

  /**
   * Wait for successful login.
   * Change this if your successful URL is different.
   */
  await page.waitForURL(/mnjuser\/profile|dashboard|home/, {
    timeout: 90000,
  });

  await expect(page.locator('body')).toBeVisible();

  /**
   * Save session cookies/localStorage.
   */
  await page.context().storageState({
    path: authFile,
  });

  console.log('Session saved successfully:', authFile);
});