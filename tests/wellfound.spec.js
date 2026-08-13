const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const { CV } = require('../config');

test.setTimeout(30 * 60 * 1000); // 30 minutes

const ROOT_DIR = path.join(__dirname, '..');
const PROFILE_DIR = path.join(ROOT_DIR, '.wellfound-chrome-profile');

/**
 * Tiny .env reader for extra automation settings.
 * Your config.js already reads CV details, but process.env does not automatically get .env values.
 */
function loadLocalEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  const out = {};

  if (!fs.existsSync(envPath)) {
    return out;
  }

  const content = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    let value = match[2];

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[match[1]] = value;
  }

  return out;
}

const ENV = loadLocalEnv();

function env(key, defaultValue = '') {
  if (process.env[key] != null && process.env[key] !== '') {
    return process.env[key];
  }

  if (ENV[key] != null && ENV[key] !== '') {
    return ENV[key];
  }

  return defaultValue;
}

/**
 * .env examples:
 *
 * WELLFOUND_JOBS_URL=https://wellfound.com/jobs
 * TARGET_LOCATIONS=India||Hyderabad||Bengaluru||Bangalore||Pune||Mumbai||Delhi NCR||Remote India
 * MIN_SKILL_MATCHES=3
 * MAX_APPLICATIONS=50
 * MAX_SCAN_JOBS=150
 * APPLY_LIVE=false
 * INCLUDE_OFF_PLATFORM=false
 */

const WELLFOUND_JOBS_URL = env('WELLFOUND_JOBS_URL', 'https://wellfound.com/jobs');

const JOB_CARD_SELECTOR = env('JOB_CARD_SELECTOR', '.styles_component__uTjje');

const TARGET_LOCATIONS = env(
  'TARGET_LOCATIONS',
  'India||Hyderabad||Bengaluru||Bangalore||Pune||Mumbai||Delhi NCR||Remote India'
)
  .split('||')
  .map(x => x.trim())
  .filter(Boolean);

const MIN_SKILL_MATCHES = Number(env('MIN_SKILL_MATCHES', '3'));
const MAX_APPLICATIONS = Number(env('MAX_APPLICATIONS', '50'));
const MAX_SCAN_JOBS = Number(env('MAX_SCAN_JOBS', '150'));

const APPLY_LIVE = String(env('APPLY_LIVE', 'false')).toLowerCase() === 'true';
const INCLUDE_OFF_PLATFORM = String(env('INCLUDE_OFF_PLATFORM', 'false')).toLowerCase() === 'true';
const APPLICATIONS_CSV_PATH = path.isAbsolute(env('APPLICATIONS_CSV', 'applications-wellfound.csv'))
  ? env('APPLICATIONS_CSV', 'applications-wellfound.csv')
  : path.join(ROOT_DIR, env('APPLICATIONS_CSV', 'applications-wellfound.csv'));

const LOG_DRY_RUN_TO_CSV = String(env('LOG_DRY_RUN_TO_CSV', 'false')).toLowerCase() === 'true';

function csvCell(value) {
  return `"${String(value || '')
    .replace(/"/g, '""')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(',') + '\n';
}

function ensureApplicationsCsv() {
  if (fs.existsSync(APPLICATIONS_CSV_PATH)) {
    return;
  }

  // BOM helps Excel read UTF-8 correctly
  const header =
    '﻿' +
    csvRow([
      'Date',
      'Site',
      'Status',
      'Mode',
      'Title',
      'Company',
      'Job Link',
      'Matched Skills',
      'Skill Count',
      'Location Match',
      'Target Locations',
      'Note',
    ]);

  fs.writeFileSync(APPLICATIONS_CSV_PATH, header, 'utf8');
}

function isAlreadyLogged(jobLink) {
  if (!jobLink || !fs.existsSync(APPLICATIONS_CSV_PATH)) {
    return false;
  }

  const csv = fs.readFileSync(APPLICATIONS_CSV_PATH, 'utf8');

  return csv.includes(jobLink);
}

function saveApplicationToCsv({
  job,
  matchedSkills,
  matchedLocation,
  status,
  note,
}) {
  ensureApplicationsCsv();

  if (isAlreadyLogged(job.link)) {
    console.log('Spreadsheet skip: job already logged:', job.link);
    return;
  }

  fs.appendFileSync(
    APPLICATIONS_CSV_PATH,
    csvRow([
      new Date().toLocaleString(),
      'Wellfound',
      status,
      APPLY_LIVE ? 'LIVE' : 'DRY_RUN',
      job.title,
      job.company,
      job.link,
      matchedSkills.join('; '),
      matchedSkills.length,
      matchedLocation,
      TARGET_LOCATIONS.join('; '),
      note,
    ]),
    'utf8'
  );

  console.log('Saved to spreadsheet:', APPLICATIONS_CSV_PATH);
}

function getMatchedLocation(text) {
  const lowerText = normalizeText(text);

  const matched = TARGET_LOCATIONS.find(location => {
    return lowerText.includes(normalizeText(location));
  });

  return matched || '';
}
function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function absoluteUrl(href) {
  if (!href) return '';

  if (href.startsWith('http')) {
    return href;
  }

  return new URL(href, 'https://wellfound.com').toString();
}

function getSkillsFromCV() {
  return String(CV.skills || '')
    .split(',')
    .map(skill => skill.trim())
    .filter(Boolean)
    // plain "C" creates too many false matches
    .filter(skill => skill.toLowerCase() !== 'c');
}

function getSkillAliases(skill) {
  const s = skill.toLowerCase();

  const aliases = {
    'react.js': ['react.js', 'reactjs', 'react'],
    'node.js': ['node.js', 'nodejs', 'node'],
    'express.js': ['express.js', 'expressjs', 'express'],
    javascript: ['javascript', 'js'],
    typescript: ['typescript', 'ts'],
    mongodb: ['mongodb', 'mongo db'],
    mysql: ['mysql', 'my sql'],
    'api testing': ['api testing', 'rest api testing'],
    'rest assured': ['rest assured'],
    selenium: ['selenium'],
    python: ['python'],
    java: ['java'],
    'c++': ['c++', 'cpp'],
    'c#': ['c#', 'c sharp'],
    '.net': ['.net', 'dotnet', 'asp.net'],
    html: ['html'],
    css: ['css'],
    sql: ['sql'],
    'azure sql': ['azure sql'],
    testng: ['testng'],
    junit: ['junit'],
    git: ['git'],
    'github copilot': ['github copilot', 'copilot'],
    'claude ai': ['claude ai', 'claude'],
    'ai agents': ['ai agents', 'ai agent'],
    'dial ai': ['dial ai'],
  };

  return aliases[s] || [skill];
}

function textHasSkill(text, skill) {
  const lowerText = normalizeText(text);
  const aliases = getSkillAliases(skill);

  return aliases.some(alias => {
    const a = normalizeText(alias);

    if (!a) return false;

    // Normal words: java, react, python, selenium, etc.
    if (/^[a-z0-9 ]+$/.test(a)) {
      const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}([^a-z0-9]|$)`, 'i');
      return regex.test(lowerText);
    }

    // Special tokens: C++, C#, .NET, Node.js
    return lowerText.includes(a);
  });
}

function getMatchedSkills(text) {
  const skills = getSkillsFromCV();

  return skills.filter(skill => textHasSkill(text, skill));
}

function locationMatches(text) {
  const lowerText = normalizeText(text);

  const hasTargetLocation = TARGET_LOCATIONS.some(location => {
    return lowerText.includes(normalizeText(location));
  });

  if (!hasTargetLocation) {
    return false;
  }

  const blockedLocations = [
    'united states',
    'usa',
    'canada',
    'europe',
    'united kingdom',
    'uk',
    'germany',
    'france',
    'australia',
    'singapore',
  ];

  const hasBlockedLocation = blockedLocations.some(location => lowerText.includes(location));

  if (hasBlockedLocation && !lowerText.includes('india')) {
    return false;
  }

  return true;
}

function buildCoverLetter(job, matchedSkills) {
  return `Hi,

I am interested in the ${job.title || 'role'} opportunity at ${job.company || 'your company'}.

I have experience with ${matchedSkills.slice(0, 8).join(', ')} and have worked on full-stack development, APIs, automation, testing, and AI-assisted engineering projects.

I would be happy to discuss how my background can contribute to this role.

Regards,
${CV.name}`;
}

async function closeWellfoundFilterPanel(page) {
  const applyButton = page
    .getByRole('button', {
      name: /apply|show results|see jobs|done|save/i,
    })
    .last();

  if (await applyButton.isVisible().catch(() => false)) {
    await applyButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const closeButton = page
    .getByRole('button', {
      name: /close|dismiss/i,
    })
    .last();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(700);

  await page.mouse.click(20, 20).catch(() => {});
  await page.waitForTimeout(700);
}

async function applyWellfoundInternshipFilter(page) {
  await page.goto(WELLFOUND_JOBS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const filtersButton = page.getByRole('button', { name: /filter|filters/i });

  if (await filtersButton.isVisible().catch(() => false)) {
    await filtersButton.click();
    await page.waitForTimeout(1000);
  }

  const jobTypeText = page.getByText(/job type|employment type|work type/i).first();

  if (await jobTypeText.isVisible().catch(() => false)) {
    await jobTypeText.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const fullTimeCheckbox = page.getByRole('checkbox', {
    name: /full.?time/i,
  });

  if (await fullTimeCheckbox.isVisible().catch(() => false)) {
    if (await fullTimeCheckbox.isChecked().catch(() => false)) {
      await fullTimeCheckbox.uncheck({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } else {
    const fullTimeOption = page.getByText(/full.?time/i).first();

    if (await fullTimeOption.isVisible().catch(() => false)) {
      await fullTimeOption.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  const internshipCheckbox = page.getByRole('checkbox', {
    name: /internship|intern/i,
  });

  if (await internshipCheckbox.isVisible().catch(() => false)) {
    if (!(await internshipCheckbox.isChecked().catch(() => false))) {
      await internshipCheckbox.check({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } else {
    const internshipOption = page.getByText(/internship|intern/i).first();

    if (await internshipOption.isVisible().catch(() => false)) {
      await internshipOption.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  await closeWellfoundFilterPanel(page);

  await page.waitForTimeout(3000);

  console.log('Internship filter applied and filter panel closed.');
}

async function setOffPlatformJobs(page) {
  const offPlatformCheckbox = page.locator('#showOffPlatformJobs');

  if (!(await offPlatformCheckbox.isVisible().catch(() => false))) {
    return;
  }

  const checked = await offPlatformCheckbox.isChecked().catch(() => false);

  if (checked !== INCLUDE_OFF_PLATFORM) {
    await page.locator('label[for="showOffPlatformJobs"]').click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  console.log(`Off-platform jobs included: ${INCLUDE_OFF_PLATFORM}`);
}

async function collectJobsByScrolling(page, selector, maxJobs = 150) {
  const jobs = [];
  const seen = new Set();

  const cards = page.locator(selector);

  let sameCountTries = 0;
  const maxSameCountTries = 6;

  while (jobs.length < maxJobs && sameCountTries < maxSameCountTries) {
    const countBefore = await cards.count();

    console.log(`Loaded cards in DOM: ${countBefore}, collected unique jobs: ${jobs.length}`);

    for (let i = 0; i < countBefore && jobs.length < maxJobs; i++) {
      const card = cards.nth(i);

      if (!(await card.isVisible().catch(() => false))) {
        continue;
      }

      const cardText = await card.innerText().catch(() => '');

      let href = await card
        .locator('a[href*="/jobs/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);

      if (!href) {
        href = await card
          .locator('a')
          .first()
          .getAttribute('href')
          .catch(() => null);
      }

      const link = absoluteUrl(href);

      if (!link || seen.has(link)) {
        continue;
      }

      seen.add(link);

      let title = await card
        .locator('h2, h3, a')
        .first()
        .innerText()
        .catch(() => '');

      const lines = cardText
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean);

      if (!title && lines.length) {
        title = lines[0];
      }

      let company = '';

      if (lines.length > 1) {
        company = lines[1];
      }

      jobs.push({
        title,
        company,
        link,
        cardText,
      });
    }

    if (jobs.length >= maxJobs) {
      break;
    }

    if (countBefore > 0) {
      await cards.nth(countBefore - 1).scrollIntoViewIfNeeded().catch(() => {});
    }

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1200);

    const countAfter = await cards.count();

    if (countAfter <= countBefore) {
      sameCountTries++;
      console.log(`No new cards loaded. Try ${sameCountTries}/${maxSameCountTries}`);
    } else {
      sameCountTries = 0;
    }
  }

  console.log(`Collected total unique jobs: ${jobs.length}`);

  return jobs;
}

async function detectJobCardSelector(page, configured) {
  if ((await page.locator(configured).count()) > 0) {
    return configured;
  }

  console.log(`[selector] '${configured}' matched 0 elements — auto-detecting...`);

  // Walk up from each job link to find the card container class:
  // the first ancestor whose class appears as many times as there are distinct job links.
  const autoClass = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/jobs/"]')].slice(0, 20);
    if (!links.length) return null;

    // Starting from the first link, walk up and find an ancestor whose class
    // count in the document roughly equals the number of job links found.
    const jobLinkCount = links.length;

    let el = links[0].parentElement;
    for (let d = 0; el && el !== document.body && d < 12; d++, el = el.parentElement) {
      if (typeof el.className !== 'string') continue;
      const classes = el.className.trim().split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        try {
          const allOfClass = document.querySelectorAll(`.${CSS.escape(cls)}`);
          // Check how many of these elements contain a job link
          let withJobLink = 0;
          for (const node of allOfClass) {
            if (node.querySelector('a[href*="/jobs/"]')) withJobLink++;
          }
          // Accept if ≥70% of matching elements are job cards and count is reasonable
          if (withJobLink >= 2 && withJobLink / allOfClass.length >= 0.7 && allOfClass.length <= 300) {
            return cls;
          }
        } catch (_) {}
      }
    }
    return null;
  });

  if (autoClass) {
    const sel = `.${autoClass}`;
    const n = await page.locator(`${sel}:has(a[href*="/jobs/"])`).count();
    if (n > 0) {
      const finalSel = `${sel}:has(a[href*="/jobs/"])`;
      console.log(`[selector] DOM-detected '${finalSel}' (${n} elements)`);
      return finalSel;
    }
  }

  // Last fallback: any element with a job link (broad but safe)
  const fallback = '[class*="styles_"]:has(a[href*="/jobs/"])';
  const fn = await page.locator(fallback).count();
  if (fn > 0) {
    console.log(`[selector] fallback '${fallback}' (${fn} elements)`);
    return fallback;
  }

  console.warn(`[selector] auto-detection failed, sticking with '${configured}'`);
  return configured;
}

async function extractJobDetailText(page) {
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('body').innerText().catch(() => '');

  const title = await page
    .locator('h1')
    .first()
    .innerText()
    .catch(() => '');

  return {
    title,
    bodyText,
  };
}

async function fillCommonApplicationFields(page, job, matchedSkills) {
  const coverLetter = buildCoverLetter(job, matchedSkills);

  /**
   * Cover letter / message fields
   */
  const textareas = page.locator('textarea');
  const textareaCount = await textareas.count();

  for (let i = 0; i < textareaCount; i++) {
    const textarea = textareas.nth(i);

    if (await textarea.isVisible().catch(() => false)) {
      const value = await textarea.inputValue().catch(() => '');

      if (!value.trim()) {
        await textarea.fill(coverLetter).catch(() => {});
      }
    }
  }

  /**
   * Rich text editor fields
   */
  const contentEditableFields = page.locator('[contenteditable="true"]');
  const editableCount = await contentEditableFields.count();

  for (let i = 0; i < editableCount; i++) {
    const editable = contentEditableFields.nth(i);

    if (await editable.isVisible().catch(() => false)) {
      const value = await editable.innerText().catch(() => '');

      if (!value.trim()) {
        await editable.click().catch(() => {});
        await page.keyboard.insertText(coverLetter).catch(() => {});
      }
    }
  }

  /**
   * Name
   */
  const nameInput = page
    .locator('input[name*="name" i], input[placeholder*="name" i]')
    .first();

  if (await nameInput.isVisible().catch(() => false)) {
    const current = await nameInput.inputValue().catch(() => '');

    if (!current.trim() && CV.name) {
      await nameInput.fill(CV.name).catch(() => {});
    }
  }

  /**
   * Email
   */
  const emailInput = page
    .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
    .first();

  if (await emailInput.isVisible().catch(() => false)) {
    const current = await emailInput.inputValue().catch(() => '');

    if (!current.trim() && CV.email) {
      await emailInput.fill(CV.email).catch(() => {});
    }
  }

  /**
   * Phone
   */
  const phoneInput = page
    .locator('input[type="tel"], input[name*="phone" i], input[placeholder*="phone" i]')
    .first();

  if (await phoneInput.isVisible().catch(() => false)) {
    const current = await phoneInput.inputValue().catch(() => '');

    if (!current.trim() && CV.phone) {
      await phoneInput.fill(CV.phone).catch(() => {});
    }
  }

  /**
   * Location
   */
  const locationInput = page
    .locator('input[name*="location" i], input[placeholder*="location" i]')
    .first();

  if (await locationInput.isVisible().catch(() => false)) {
    const current = await locationInput.inputValue().catch(() => '');

    if (!current.trim() && CV.location) {
      await locationInput.fill(CV.location).catch(() => {});
    }
  }

  /**
   * Extra dynamic questions:
   * relocation, preferred option, work mode, salary, notice period, etc.
   */
  await answerExtraApplicationQuestions(page);

  await page.waitForTimeout(700);
}

async function closeModalIfOpen(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const closeButton = page
    .getByRole('button', {
      name: /close|cancel|dismiss/i,
    })
    .last();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(() => {});
  }

  await page.waitForTimeout(700);
}

async function applyToWellfoundJob(page, job, matchedSkills) {
  console.log(`Trying to apply: ${job.title}`);
  console.log(`Link: ${job.link}`);

  const applyButton = page
    .getByRole('button', {
      name: /^apply$|apply now|quick apply/i,
    })
    .first();

  if (!(await applyButton.isVisible().catch(() => false))) {
    console.log('SKIP: Apply button not found');

    return {
      applied: false,
      status: 'SKIPPED_NO_APPLY_BUTTON',
      note: 'Apply button not found',
    };
  }

  await applyButton.click({ force: true });
  await page.waitForTimeout(2500);

  await fillCommonApplicationFields(page, job, matchedSkills);

  if (!APPLY_LIVE) {
    console.log('DRY RUN: Form opened/filled, but application NOT sent.');

    await closeModalIfOpen(page);

    return {
      applied: true,
      status: 'DRY_RUN_MATCHED',
      note: 'Matched job. Form opened/filled. Not submitted because APPLY_LIVE=false',
    };
  }

  console.log('LIVE MODE: Trying to send application...');

  // Some forms may have Continue/Next before final submit
  for (let step = 0; step < 5; step++) {
    const nextButton = page
      .getByRole('button', {
        name: /continue|next/i,
      })
      .first();

    if (await nextButton.isVisible().catch(() => false)) {
      console.log('Clicking Continue/Next...');

      await nextButton.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500);

      await fillCommonApplicationFields(page, job, matchedSkills);
      continue;
    }

    break;
  }

  const sendButton = page
    .getByRole('button', {
      name: /send application|submit application|submit|send/i,
    })
    .last();

  if (!(await sendButton.isVisible().catch(() => false))) {
    console.log('SKIP: Send/Submit application button not found.');

    await closeModalIfOpen(page);

    return {
      applied: false,
      status: 'SKIPPED_NO_SUBMIT_BUTTON',
      note: 'Submit button not found after opening application form',
    };
  }

  console.log('Clicking final Send/Submit application button...');

  await sendButton.click({ force: true });
  await page.waitForTimeout(4000);

  const successText = page
    .getByText(/application sent|applied|success|submitted|your application has been sent/i)
    .first();

  if (await successText.isVisible().catch(() => false)) {
    console.log('APPLICATION SUBMITTED SUCCESSFULLY');

    return {
      applied: true,
      status: 'SUBMITTED',
      note: 'Success message detected',
    };
  }

  const pageText = await page.locator('body').innerText().catch(() => '');

  if (/application sent|applied|submitted/i.test(pageText)) {
    console.log('APPLICATION SUBMITTED SUCCESSFULLY');

    return {
      applied: true,
      status: 'SUBMITTED',
      note: 'Success text found in page body',
    };
  }

  console.log('Submit clicked, but success confirmation was not detected.');

  return {
    applied: true,
    status: 'SUBMITTED_UNCONFIRMED',
    note: 'Submit clicked, but success confirmation was not detected',
  };
}
async function isVisible(locator, timeout = 800) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function getQuestionContainer(page, questionRegex) {
  const questionText = page.getByText(questionRegex).first();

  if (!(await isVisible(questionText, 1000))) {
    return null;
  }

  // Get nearest useful parent container
  return questionText.locator(
    'xpath=ancestor::*[self::fieldset or self::section or self::div][1]'
  );
}

async function chooseOptionNearQuestion(
  page,
  questionRegex,
  optionRegex,
  debugName = '',
  options = {}
) {
  const { fallbackToFirst = false } = options;

  const container = await getQuestionContainer(page, questionRegex);

  if (!container) {
    return false;
  }

  console.log(`Handling question: ${debugName || questionRegex}`);

  /**
   * 1. Native select dropdown
   */
  const select = container.locator('select').first();

  if (await isVisible(select, 500)) {
    const selectOptions = await select.locator('option').evaluateAll(opts =>
      opts.map((o, index) => ({
        index,
        value: o.value,
        label: (o.textContent || '').trim(),
        disabled: o.disabled,
      }))
    ).catch(() => []);

    const matched = selectOptions.find(o => {
      if (o.disabled) return false;
      if (!o.label) return false;
      return optionRegex.test(o.label);
    });

    if (matched) {
      await select.selectOption({ label: matched.label }).catch(async () => {
        await select.selectOption(matched.value).catch(() => {});
      });

      console.log(`Selected dropdown option: ${matched.label}`);
      await page.waitForTimeout(500);
      return true;
    }

    if (fallbackToFirst) {
      const firstValid = selectOptions.find(o => {
        if (o.disabled) return false;
        if (!o.label) return false;

        const label = normalizeText(o.label);

        // Avoid placeholders
        if (
          label.includes('select') ||
          label.includes('choose') ||
          label.includes('preferred') ||
          label === '-'
        ) {
          return false;
        }

        return true;
      });

      if (firstValid) {
        await select.selectOption({ label: firstValid.label }).catch(async () => {
          await select.selectOption(firstValid.value).catch(() => {});
        });

        console.log(`No preferred match found. Selected first dropdown option: ${firstValid.label}`);
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  /**
   * 2. Radio button
   */
  const radio = container.getByRole('radio', { name: optionRegex }).first();

  if (await isVisible(radio, 500)) {
    await radio.check({ force: true }).catch(async () => {
      await radio.click({ force: true }).catch(() => {});
    });

    console.log(`Selected radio option: ${optionRegex}`);
    await page.waitForTimeout(500);
    return true;
  }

  if (fallbackToFirst) {
    const radios = container.getByRole('radio');
    const radioCount = await radios.count().catch(() => 0);

    for (let i = 0; i < radioCount; i++) {
      const firstRadio = radios.nth(i);

      if (await firstRadio.isVisible().catch(() => false)) {
        await firstRadio.check({ force: true }).catch(async () => {
          await firstRadio.click({ force: true }).catch(() => {});
        });

        console.log('No preferred match found. Selected first radio option.');
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  /**
   * 3. Checkbox
   */
  const checkbox = container.getByRole('checkbox', { name: optionRegex }).first();

  if (await isVisible(checkbox, 500)) {
    const checked = await checkbox.isChecked().catch(() => false);

    if (!checked) {
      await checkbox.check({ force: true }).catch(async () => {
        await checkbox.click({ force: true }).catch(() => {});
      });
    }

    console.log(`Selected checkbox option: ${optionRegex}`);
    await page.waitForTimeout(500);
    return true;
  }

  if (fallbackToFirst) {
    const checkboxes = container.getByRole('checkbox');
    const checkboxCount = await checkboxes.count().catch(() => 0);

    for (let i = 0; i < checkboxCount; i++) {
      const firstCheckbox = checkboxes.nth(i);

      if (await firstCheckbox.isVisible().catch(() => false)) {
        const checked = await firstCheckbox.isChecked().catch(() => false);

        if (!checked) {
          await firstCheckbox.check({ force: true }).catch(async () => {
            await firstCheckbox.click({ force: true }).catch(() => {});
          });
        }

        console.log('No preferred match found. Selected first checkbox option.');
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  /**
   * 4. Custom dropdown / combobox
   */
  const combobox = container.getByRole('combobox').first();

  if (await isVisible(combobox, 500)) {
    await combobox.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);

    const matchedOption = page.getByRole('option', { name: optionRegex }).first();

    if (await isVisible(matchedOption, 1000)) {
      await matchedOption.click({ force: true }).catch(() => {});
      console.log(`Selected combobox option: ${optionRegex}`);
      await page.waitForTimeout(500);
      return true;
    }

    const matchedTextOption = page.getByText(optionRegex).first();

    if (await isVisible(matchedTextOption, 1000)) {
      await matchedTextOption.click({ force: true }).catch(() => {});
      console.log(`Selected dropdown text option: ${optionRegex}`);
      await page.waitForTimeout(500);
      return true;
    }

    if (fallbackToFirst) {
      const allOptions = page.getByRole('option');
      const optionCount = await allOptions.count().catch(() => 0);

      for (let i = 0; i < optionCount; i++) {
        const firstOption = allOptions.nth(i);

        if (await firstOption.isVisible().catch(() => false)) {
          const optionText = await firstOption.innerText().catch(() => '');

          await firstOption.click({ force: true }).catch(() => {});
          console.log(`No preferred match found. Selected first combobox option: ${optionText}`);
          await page.waitForTimeout(500);
          return true;
        }
      }

      // fallback for non-role dropdown options
      const listItems = page.locator('[role="listbox"] *').filter({
        hasText: /\S/,
      });

      const listItemCount = await listItems.count().catch(() => 0);

      for (let i = 0; i < listItemCount; i++) {
        const firstItem = listItems.nth(i);

        if (await firstItem.isVisible().catch(() => false)) {
          const itemText = await firstItem.innerText().catch(() => '');

          await firstItem.click({ force: true }).catch(() => {});
          console.log(`No preferred match found. Selected first dropdown item: ${itemText}`);
          await page.waitForTimeout(500);
          return true;
        }
      }
    }
  }

  /**
   * 5. Button option
   */
  const button = container.getByRole('button', { name: optionRegex }).first();

  if (await isVisible(button, 500)) {
    await button.click({ force: true }).catch(() => {});
    console.log(`Clicked button option: ${optionRegex}`);
    await page.waitForTimeout(500);
    return true;
  }

  if (fallbackToFirst) {
    const buttons = container.getByRole('button');
    const buttonCount = await buttons.count().catch(() => 0);

    for (let i = 0; i < buttonCount; i++) {
      const firstButton = buttons.nth(i);

      if (await firstButton.isVisible().catch(() => false)) {
        const buttonText = await firstButton.innerText().catch(() => '');

        if (/close|cancel|dismiss|back/i.test(buttonText)) {
          continue;
        }

        await firstButton.click({ force: true }).catch(() => {});
        console.log(`No preferred match found. Selected first button option: ${buttonText}`);
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  /**
   * 6. Text/label fallback
   */
  const textOption = container.getByText(optionRegex).last();

  if (await isVisible(textOption, 500)) {
    await textOption.click({ force: true }).catch(() => {});
    console.log(`Clicked text option: ${optionRegex}`);
    await page.waitForTimeout(500);
    return true;
  }

  console.log(`Could not answer question: ${debugName || questionRegex}`);
  return false;
}
const STORAGE_STATE_PATH = path.join(ROOT_DIR, 'playwright/.auth/user.json');

async function createBrowserSession() {
  const isCI = String(process.env.CI || '').toLowerCase() === 'true';

  if (isCI) {
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      throw new Error(
        `Missing storage state file: ${STORAGE_STATE_PATH}. Add WELLFOUND_STORAGE_STATE_B64 GitHub secret.`
      );
    }

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--window-size=1280,900',
      ],
    });

    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      viewport: {
        width: 1280,
        height: 900,
      },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();

    return {
      browser,
      context,
      page,
      close: async () => {
        await browser.close();
      },
    };
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

  return {
    browser: null,
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}

async function fillTextNearQuestion(page, questionRegex, value, debugName = '') {
  if (!value) return false;

  const container = await getQuestionContainer(page, questionRegex);

  if (!container) {
    return false;
  }

  console.log(`Filling question: ${debugName || questionRegex}`);

  const input = container
    .locator(
      'textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])'
    )
    .first();

  if (await isVisible(input, 500)) {
    const currentValue = await input.inputValue().catch(() => '');

    if (!currentValue.trim()) {
      await input.fill(String(value)).catch(() => {});
      await page.waitForTimeout(400);
      return true;
    }
  }

  const editable = container.locator('[contenteditable="true"]').first();

  if (await isVisible(editable, 500)) {
    const currentText = await editable.innerText().catch(() => '');

    if (!currentText.trim()) {
      await editable.click().catch(() => {});
      await page.keyboard.insertText(String(value)).catch(() => {});
      await page.waitForTimeout(400);
      return true;
    }
  }

  return false;
}

async function answerExtraApplicationQuestions(page) {
  const location = CV.location || 'Hyderabad, India';
  const city = location.split(',')[0].trim();

  const preferredLocationRegex = new RegExp(
    `${escapeRegex(city)}|Hyderabad|India|Remote India|Bengaluru|Bangalore|Pune|Mumbai|Delhi`,
    'i'
  );

  /**
   * Relocation questions
   */
  await chooseOptionNearQuestion(
    page,
    /willing.*relocat|open.*relocat|relocat/i,
    /yes|open|willing/i,
    'Willing to relocate'
  );

const preferredRelocationHandled = await chooseOptionNearQuestion(
  page,
  /preferred.*relocat|relocation.*preference|relocation.*option/i,
  preferredLocationRegex,
  'Preferred relocation option',
  {
    fallbackToFirst: true,
  }
);

if (!preferredRelocationHandled) {
  await fillTextNearQuestion(
    page,
    /preferred.*relocat|relocation.*preference|relocation.*option/i,
    location,
    'Preferred relocation text'
  );
}

  /**
   * Preferred location questions
   */
 const preferredLocationHandled = await chooseOptionNearQuestion(
  page,
  /preferred.*location|location.*preference|where.*prefer|preferred.*city|choose.*location/i,
  preferredLocationRegex,
  'Preferred location',
  {
    fallbackToFirst: true,
  }
);

if (!preferredLocationHandled) {
  await fillTextNearQuestion(
    page,
    /preferred.*location|location.*preference|where.*prefer|preferred.*city|choose.*location/i,
    location,
    'Preferred location text'
  );
}

  /**
   * Work mode questions
   */
  await chooseOptionNearQuestion(
    page,
    /work.*mode|remote|hybrid|onsite|office/i,
    /remote|hybrid|onsite|yes/i,
    'Work mode preference'
  );

  /**
   * Job type / employment type
   */
  await chooseOptionNearQuestion(
    page,
    /job.*type|employment.*type|type.*employment/i,
    /internship|intern/i,
    'Employment type'
  );

  /**
   * Work authorization
   */
  await chooseOptionNearQuestion(
    page,
    /authorized.*work|work.*authorization|eligible.*work|legally.*work/i,
    /yes/i,
    'Work authorization'
  );

  /**
   * Visa sponsorship
   */
  await chooseOptionNearQuestion(
    page,
    /visa|sponsor|sponsorship/i,
    /no/i,
    'Visa sponsorship'
  );

  /**
   * Notice period
   */
  await fillTextNearQuestion(
    page,
    /notice.*period|when.*start|available.*start|start.*date/i,
    CV.noticePeriod || '30 days',
    'Notice period'
  );

  /**
   * Current salary / CTC
   */
  await fillTextNearQuestion(
    page,
    /current.*salary|current.*ctc|current.*compensation/i,
    CV.currentCTC || CV.currentSalary,
    'Current CTC'
  );

  /**
   * Expected salary / CTC
   */
  await fillTextNearQuestion(
    page,
    /expected.*salary|expected.*ctc|expected.*compensation|salary.*expectation/i,
    CV.expectedCTC || CV.expectedSalary,
    'Expected CTC'
  );
}

async function processJobsAndApply(page, jobs) {
  let appliedCount = 0;
  let checkedCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    if (appliedCount >= MAX_APPLICATIONS) {
      console.log(`Reached max applications: ${MAX_APPLICATIONS}`);
      break;
    }

    checkedCount++;

    console.log('\n----------------------------------------');
    console.log(`Checking job ${checkedCount}/${jobs.length}`);
    console.log(`Title: ${job.title}`);
    console.log(`Company: ${job.company}`);
    console.log(`Link: ${job.link}`);

    await page.goto(job.link, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const details = await extractJobDetailText(page);

    const fullText = [
      job.title,
      job.company,
      job.cardText,
      details.title,
      details.bodyText,
    ].join('\n');

    const matchedSkills = getMatchedSkills(fullText);
    const isLocationOk = locationMatches(fullText);
    const matchedLocation = getMatchedLocation(fullText);

    console.log(`Location match: ${isLocationOk}`);
    console.log(`Matched location: ${matchedLocation || 'NONE'}`);
    console.log(`Matched skills (${matchedSkills.length}): ${matchedSkills.join(', ')}`);

    if (!isLocationOk) {
      skippedCount++;
      console.log('SKIP: location is not India/selected location');
      continue;
    }

    if (matchedSkills.length < MIN_SKILL_MATCHES) {
      skippedCount++;
      console.log(`SKIP: skills matched less than ${MIN_SKILL_MATCHES}`);
      continue;
    }

    const result = await applyToWellfoundJob(page, job, matchedSkills);

    if (result.applied) {
      appliedCount++;

      if (APPLY_LIVE || LOG_DRY_RUN_TO_CSV) {
        saveApplicationToCsv({
          job,
          matchedSkills,
          matchedLocation,
          status: result.status,
          note: result.note,
        });
      }

      if (APPLY_LIVE) {
        console.log(`Submitted count: ${appliedCount}/${MAX_APPLICATIONS}`);
      } else {
        console.log(`Dry-run matched count: ${appliedCount}/${MAX_APPLICATIONS}`);
      }
    } else {
      skippedCount++;
      console.log(`SKIP: ${result.status} - ${result.note}`);
    }

    await page.waitForTimeout(1500);
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`Checked jobs: ${checkedCount}`);
  console.log(`${APPLY_LIVE ? 'Submitted' : 'Dry-run matched'} jobs: ${appliedCount}`);
  console.log(`Skipped jobs: ${skippedCount}`);
  console.log(`Spreadsheet path: ${APPLICATIONS_CSV_PATH}`);
}

test('open Wellfound internship jobs and apply by criteria', async () => {
  console.log('========================================');
  console.log('Wellfound automation started');
  console.log(`Mode: ${APPLY_LIVE ? 'LIVE APPLY' : 'DRY RUN'}`);
  console.log(`Target locations: ${TARGET_LOCATIONS.join(', ')}`);
  console.log(`Minimum skill matches: ${MIN_SKILL_MATCHES}`);
  console.log(`Max applications: ${MAX_APPLICATIONS}`);
  console.log(`Max jobs to scan: ${MAX_SCAN_JOBS}`);
  console.log(`Include off-platform jobs: ${INCLUDE_OFF_PLATFORM}`);
  console.log('========================================');

const session = await createBrowserSession();
const { page } = session;

try {
  await applyWellfoundInternshipFilter(page);

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).toBeVisible();

  await setOffPlatformJobs(page);

  const resolvedSelector = await detectJobCardSelector(page, JOB_CARD_SELECTOR);
  const jobs = await collectJobsByScrolling(page, resolvedSelector, MAX_SCAN_JOBS);

  if (!jobs.length) {
    throw new Error(`No jobs collected. Check JOB_CARD_SELECTOR: ${resolvedSelector}`);
  }

  await processJobsAndApply(page, jobs);
} finally {
  await session.close();
}
});