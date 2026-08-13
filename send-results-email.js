const https = require('https');
const fs = require('fs');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const TO_EMAIL = process.env.EMAIL || '';
const RUN_NUMBER = process.env.GITHUB_RUN_NUMBER || 'local';
const JOB_STATUS = process.env.JOB_STATUS || 'unknown';
const USE_TODAY = process.env.TODAY_CSV === 'true';
const CSV_PATH = USE_TODAY
  ? path.join(__dirname, 'applications-wellfound-today.csv')
  : path.join(__dirname, 'applications-wellfound.csv');
const CSV_FILENAME = USE_TODAY ? 'applications-today.csv' : 'applications-wellfound.csv';

if (!RESEND_API_KEY) { console.error('RESEND_API_KEY not set'); process.exit(1); }
if (!TO_EMAIL) { console.error('EMAIL not set'); process.exit(1); }

let attachments = [];
if (fs.existsSync(CSV_PATH)) {
  const content = fs.readFileSync(CSV_PATH).toString('base64');
  attachments = [{ filename: CSV_FILENAME, content }];
  console.log('CSV found, attaching:', CSV_PATH);
} else {
  console.log('No CSV file found, sending without attachment.');
}

const body = JSON.stringify({
  from: 'Wellfound Bot <onboarding@resend.dev>',
  to: [TO_EMAIL],
  subject: `Wellfound Applications - Run #${RUN_NUMBER} [${JOB_STATUS}]`,
  text: `Hi Vivek,\n\nYour Wellfound auto-apply run #${RUN_NUMBER} has completed.\nStatus: ${JOB_STATUS}\n\n${attachments.length ? 'Today\'s applications CSV is attached.' : 'No applications were logged today.'}\n\n– Wellfound Bot`,
  attachments,
});

const options = {
  hostname: 'api.resend.com',
  path: '/emails',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('Email sent successfully.');
    } else {
      console.error(`Failed to send email. Status: ${res.statusCode}`, data);
      process.exit(1);
    }
  });
});

req.on('error', err => { console.error('Request error:', err); process.exit(1); });
req.write(body);
req.end();
