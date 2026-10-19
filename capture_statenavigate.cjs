// Capture State Navigate's public Virginia early-vote tracker.
//
//   node capture_statenavigate.cjs [--force]
//
// Opens the public page in a headless browser, as a visitor would, and saves
// the precinct data the page loads plus a screenshot under
// sources/precinct-snapshots/<Eastern date>/<HHMM>-* (data gzipped). Nothing is written when the
// data matches the last capture. Prints one JSON line; "data" is the saved
// JSON file to pass to refresh_statenavigate.py.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')));
}

const ROOT = __dirname;
const ARCHIVE = path.join(ROOT, 'sources', 'precinct-snapshots');
const PAGE = 'https://projects.statenavigate.com/interactives/va/early-vote-2026/';
const DATA = 'early-vote/2026/current.json';

const eastern = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}${parts.minute}` };
};

(async () => {
  const force = process.argv.includes('--force');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
    const data = page.waitForResponse((r) => r.url().includes(DATA) && r.ok(), { timeout: 90000 }).then((r) => r.text());
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 90000 });
    const text = await data;
    const json = JSON.parse(text);
    if (!Array.isArray(json.precincts) || !json.current) throw new Error('Unexpected State Navigate data layout');
    // observed_at changes on every rebuild; fingerprint only the counts.
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([json.current.groups, json.precincts])).digest('hex').slice(0, 16);
    const latestFile = path.join(ARCHIVE, 'latest.json');
    let last = null;
    try { last = JSON.parse(fs.readFileSync(latestFile)); } catch (e) {}
    if (!force && last && last.fingerprint === fingerprint) {
      console.log(JSON.stringify({ source: 'State Navigate', changed: false, data: last.data, observedAt: json.current.observed_at }));
      return;
    }
    await page.waitForTimeout(2000);
    const { date, time } = eastern();
    const dir = path.join(ARCHIVE, date);
    fs.mkdirSync(dir, { recursive: true });
    const dataFile = path.join(dir, `${time}-current.json.gz`);
    fs.writeFileSync(dataFile, zlib.gzipSync(text));
    const shot = path.join(dir, `${time}-tracker.png`);
    await page.screenshot({ path: shot });
    const latest = { fingerprint, capturedAt: new Date().toISOString(), observedAt: json.current.observed_at, data: path.relative(ROOT, dataFile), screenshot: path.relative(ROOT, shot) };
    fs.writeFileSync(latestFile, JSON.stringify(latest, null, 2) + '\n');
    console.log(JSON.stringify({ source: 'State Navigate', changed: true, ...latest }));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
