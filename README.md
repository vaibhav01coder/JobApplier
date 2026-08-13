# Wellfound Auto-Applier

Automatically applies to internship jobs on [Wellfound](https://wellfound.com) every day using a GitHub Actions pipeline. It logs into your account, filters for internships, matches jobs by location and skills, fills out application forms, and emails you a CSV report of what was applied to.

---

## How It Works

1. Every day at 8:00 AM IST the pipeline runs automatically (or you can trigger it manually)
2. It logs into Wellfound using your email and password
3. Applies the **Internship** job type filter
4. Scrolls through job listings and checks each one for your target locations and skills
5. Fills and submits the application form automatically
6. Emails today's applied jobs CSV to your inbox
7. Saves a cumulative all-time CSV as a downloadable artifact in GitHub Actions

---

## Setup Guide

### Step 1 — Fork this repository

Click **Fork** on the top right of this page to copy the repo to your GitHub account.

### Step 2 — Install GitHub CLI

Download from: https://cli.github.com  
After installing, open PowerShell and run:

```powershell
gh auth login
```

Follow the prompts and authenticate with your GitHub account.

### Step 3 — Get a free Resend API key (for email reports)

1. Sign up at https://resend.com (free, no credit card needed)
2. Go to **API Keys** → **Create API Key**
3. Copy the key — it starts with `re_`

### Step 4 — Add all your details as GitHub Secrets

Copy the block below, replace every value with **your own details**, then paste the whole thing into PowerShell:

```powershell
$repo = "YOUR_GITHUB_USERNAME/JobApplier"   # <-- change this to your username

gh secret set WELLFOUND_EMAIL    --body "your-wellfound-email@gmail.com"    --repo $repo
gh secret set WELLFOUND_PASSWORD --body "YourWellfoundPassword"             --repo $repo

gh secret set NAME               --body "Your Full Name"                    --repo $repo
gh secret set EMAIL              --body "your-personal-email@gmail.com"     --repo $repo
gh secret set PHONE              --body "9876543210"                        --repo $repo
gh secret set LOCATION           --body "Hyderabad, India"                  --repo $repo

gh secret set CURRENT_ROLE       --body "Software Engineer at Company (City, India)" --repo $repo
gh secret set COMPANY            --body "Company Name"                      --repo $repo
gh secret set EDUCATION          --body "B.Tech, University Name (2021-2025)"        --repo $repo
gh secret set YEARS_EXPERIENCE   --body "1"                                 --repo $repo

gh secret set SKILLS             --body "JavaScript, Python, React.js, Node.js, Git" --repo $repo
gh secret set HIGHLIGHTS         --body "Built REST APIs handling 1000+ requests||Led frontend migration to React.js" --repo $repo

gh secret set NOTICE_PERIOD      --body "30 days"                           --repo $repo
gh secret set CURRENT_CTC        --body "8"                                 --repo $repo
gh secret set EXPECTED_CTC       --body "12"                                --repo $repo
gh secret set DOB                --body "DD/MM/YYYY"                        --repo $repo
gh secret set GENDER             --body "Male"                              --repo $repo

gh secret set GITHUB_URL         --body "https://github.com/yourusername"   --repo $repo
gh secret set LINKEDIN_URL       --body "https://linkedin.com/in/yourprofile/" --repo $repo
gh secret set PORTFOLIO_URL      --body ""                                  --repo $repo

gh secret set RESEND_API_KEY     --body "re_your_resend_key_here"           --repo $repo
gh secret set NOTIFY_EMAIL       --body "email-to-receive-report@gmail.com" --repo $repo
```

> **HIGHLIGHTS** — separate multiple bullet points with `||`
> 
> **SKILLS** — comma-separated list of your technical skills
> 
> **NOTIFY_EMAIL** — the email address where the daily report CSV is sent (can be any email)
> 
> **WELLFOUND_EMAIL / WELLFOUND_PASSWORD** — your Wellfound login credentials

---

## What You Can Customise

All bot behaviour is controlled in `.github/workflows/wellfound-daily.yml`. Open that file and edit these values:

| Setting | Default | What it does |
|---------|---------|--------------|
| `TARGET_ROLES` | `internship` | Job types to apply for. Change to e.g. `full-time` or `internship\|\|contract` |
| `TARGET_LOCATIONS` | `India\|\|Hyderabad\|\|...` | Only apply to jobs in these locations |
| `MIN_SKILL_MATCHES` | `1` | Minimum number of your skills that must appear in the job description |
| `MIN_APPLY_TARGET` | `10` | Stop after this many successful submissions per run |
| `MAX_APPLICATIONS` | `50` | Hard cap on applications per run |
| `MAX_SCAN_JOBS` | `150` | How many job cards to scroll through |
| `APPLY_LIVE` | `true` | Set to `false` for a dry run (fills forms but does not submit) |

---

## Running Manually

Go to your repo on GitHub → **Actions** tab → **Wellfound Daily Apply** → **Run workflow** → click the green **Run workflow** button.

---

## Output After Each Run

| Output | Contents | Where |
|--------|----------|-------|
| Email to `NOTIFY_EMAIL` | Today's applied jobs CSV | Your inbox |
| GitHub Artifact | All-time cumulative CSV | Actions run → scroll to **Artifacts** → download |

The CSV contains: Date, Status, Job Title, Company, Job Link, Matched Skills, Location, Notes.

---

## Automatic Schedule

The pipeline runs every day at **8:00 AM IST** automatically.  
To change the time, edit the `cron` line in `.github/workflows/wellfound-daily.yml`:

```yaml
- cron: '30 2 * * *'   # 2:30 AM UTC = 8:00 AM IST
```

Use https://crontab.guru to build a different schedule.

---

## Local Run (Optional)

To run the bot on your own machine:

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Set up your config
cp .env.example .env
# Open .env and fill in your details

# 3. Log into Wellfound and save session
node save-wellfound-storage-state.js

# 4. Run the bot
npx playwright test tests/wellfound.spec.js
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No jobs collected` | Wellfound changed their CSS — the bot auto-detects, just re-run |
| `Login failed — still on login page` | Double-check `WELLFOUND_EMAIL` and `WELLFOUND_PASSWORD` secrets |
| `Email not received` | Check spam folder; verify `RESEND_API_KEY` and `NOTIFY_EMAIL` are set correctly |
| Pipeline times out | Reduce `MAX_SCAN_JOBS` or `MIN_APPLY_TARGET` in the workflow file |
| Applied to wrong job types | Update `TARGET_ROLES` in the workflow file |
