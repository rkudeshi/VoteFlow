// Capture locality early-voting dashboards: raw data plus dated screenshots.
//
//   node capture_dashboards.cjs [arlington] [loudoun] [alexandria] [--force]
//
// Each locality is fingerprinted from its source data. When the fingerprint
// matches the last capture, nothing is written (cheap repeated checks). A new
// fingerprint saves the raw data and screenshots under
// sources/dashboard-archive/<locality>/<Eastern date>/<HHMM>-<name>.<ext>
// so every number imported from a dashboard has an image to check it against.
// Prints one JSON line per locality.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')));
}

const ROOT = __dirname;
const ARCHIVE = path.join(ROOT, 'sources', 'dashboard-archive');
const ARLINGTON = 'https://app.powerbi.com/view?r=eyJrIjoiM2I0MWM2MjgtMzM3MS00NzM5LTk2MDAtMjQ0MGQ4NTZhNWU0IiwidCI6IjgwMzU0ODA0LTFmZGYtNDI4ZS05ZjVmLTUwOTFlOTk0Y2Y1NCIsImMiOjF9';
// Report pages in order; the page tabs are hidden, so step with Next Page.
const ARLINGTON_PAGES = ['Snapshot', 'Early Votes by Day', 'Historical Comparison', 'Votes Cast by Precinct'];
const LOUDOUN_FEED = 'https://services1.arcgis.com/MxjRokvPm7bjslyR/arcgis/rest/services/ELECTION_VRDATA_VIEW/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json';
const LOUDOUN_DASHBOARD = 'https://www.arcgis.com/apps/dashboards/8ac25460e5c14b879e687093fd230b59';
const ALEXANDRIA_WORKBOOK = 'https://public.tableau.com/profile/api/workbook/ElectionDashboardNovember2026';
const ALEXANDRIA_VIEWS = ['Overview', 'EarlyVotingbyLocation'];

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const eastern = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}${parts.minute}` };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw e; await sleep(3000 * i); }
  }
}

function lastFingerprint(locality) {
  try { return JSON.parse(fs.readFileSync(path.join(ARCHIVE, locality, 'latest.json'))).fingerprint; } catch (e) { return null; }
}
function saver(locality) {
  const { date, time } = eastern();
  const dir = path.join(ARCHIVE, locality, date);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  return {
    dir, files, date, time,
    file(name, content) {
      const p = path.join(dir, `${time}-${name}`);
      fs.writeFileSync(p, content);
      files.push(path.relative(ROOT, p));
      return p;
    },
    finish(fingerprint, extra) {
      const latest = { fingerprint, capturedAt: new Date().toISOString(), files, ...extra };
      fs.writeFileSync(path.join(ARCHIVE, locality, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
      return latest;
    },
  };
}

// Power BI public report: issue the report's own query endpoint with our
// queries, reusing the headers and context the page sends.
async function arlington(browser, force) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  let template = null;
  let schema = null;
  page.on('request', (r) => { if (!template && /querydata/.test(r.url())) template = { url: r.url(), headers: r.headers(), body: JSON.parse(r.postData()) }; });
  page.on('response', async (r) => { if (/conceptualschema/.test(r.url())) { try { schema = await r.json(); } catch (e) {} } });
  await retry(() => page.goto(ARLINGTON, { waitUntil: 'networkidle', timeout: 120000 }));
  for (let i = 0; i < 30 && (!template || !schema); i++) await sleep(1000);
  if (!template || !schema) throw new Error('Arlington report did not load');
  const entities = Object.fromEntries(schema.schemas[0].schema.Entities.map((e) => [e.Name, e.Properties.map((p) => p.Name)]));
  const dateColumns = entities['Daily EV'].filter((n) => /^\d+\/\d+\/\d{4}$/.test(n));
  const col = (src, prop) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: prop } });
  const query = (from, select) => ({
    version: '1.0.0',
    queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: { Version: 2, From: from, Select: select }, Binding: { Primary: { Groupings: [{ Projections: select.map((_, i) => i) }] }, DataReduction: { DataVolume: 4, Primary: { Window: { Count: 1000 } } }, Version: 1 }, ExecutionMetricsKind: 1 } }] }, QueryId: '', ApplicationContext: template.body.queries[0].ApplicationContext }],
    cancelQueries: [], modelId: template.body.modelId,
  });
  const queries = {
    daily: query([{ Name: 'd', Entity: 'Daily EV', Type: 0 }], [{ ...col('d', 'Site'), Name: 'Site' }, ...dateColumns.map((c) => ({ Aggregation: { Expression: col('d', c), Function: 0 }, Name: c })), { Aggregation: { Expression: col('d', 'Total'), Function: 0 }, Name: 'Total' }]),
    precincts: query([{ Name: 'c', Entity: 'Cumulative', Type: 0 }], [{ ...col('c', 'Precinct Name'), Name: 'Precinct' }, ...['Early Voting', 'Mail Ballots Cast', 'Votes Cast'].map((m) => ({ Measure: { Expression: { SourceRef: { Source: 'c' } }, Property: m }, Name: m }))]),
    totals: query([{ Name: 'c', Entity: 'Cumulative', Type: 0 }], ['Early Voting', 'Mail Ballots Cast', 'Votes Cast'].map((m) => ({ Measure: { Expression: { SourceRef: { Source: 'c' } }, Property: m }, Name: m }))),
    refreshed: query([{ Name: 'r', Entity: 'RefreshDate', Type: 0 }], [{ ...col('r', 'Date Last Refreshed'), Name: 'Refreshed' }]),
  };
  const headers = { ...template.headers };
  delete headers['content-length'];
  const raw = {};
  for (const [name, body] of Object.entries(queries)) {
    const res = await retry(async () => {
      const r = await ctx.request.post(template.url, { headers, data: JSON.stringify(body) });
      if (!r.ok()) throw new Error(`Arlington ${name} query HTTP ${r.status()}`);
      return r.text();
    });
    JSON.parse(res);
    raw[name] = res;
  }
  // Fingerprint the data only; Power BI timestamps change on every request.
  const strip = (t) => JSON.stringify(JSON.parse(t).results[0].result.data.dsr);
  const fingerprint = sha(Object.keys(raw).map((k) => strip(raw[k])).join('|'));
  if (!force && fingerprint === lastFingerprint('arlington-county')) { await ctx.close(); return { locality: 'arlington-county', changed: false }; }
  const s = saver('arlington-county');
  s.file('powerbi-data.json', JSON.stringify({ source: 'https://vote.arlingtonva.gov/Elections/Results-Data', report: ARLINGTON, retrievedAt: new Date().toISOString(), dateColumns, queries: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v)])) }) + '\n');
  for (const [i, name] of ARLINGTON_PAGES.entries()) {
    if (i) await page.locator('button[aria-label="Next Page"]').click();
    await sleep(i ? 9000 : 3000);
    s.file(`${name.toLowerCase().replace(/\W+/g, '-')}.jpg`, await page.screenshot({ type: 'jpeg', quality: 80 }));
  }
  await ctx.close();
  return { locality: 'arlington-county', changed: true, ...s.finish(fingerprint, { dataFile: s.files[0] }) };
}

async function loudoun(browser, force) {
  const text = await retry(async () => { const r = await fetch(LOUDOUN_FEED); if (!r.ok) throw new Error('Loudoun feed HTTP ' + r.status); return r.text(); });
  const attributes = JSON.parse(text).features[0].attributes;
  const fingerprint = sha(JSON.stringify(attributes));
  if (!force && fingerprint === lastFingerprint('loudoun-county')) return { locality: 'loudoun-county', changed: false };
  const s = saver('loudoun-county');
  s.file('arcgis-feed.json', text);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await retry(() => page.goto(LOUDOUN_DASHBOARD, { waitUntil: 'networkidle', timeout: 120000 }));
  await sleep(8000);
  s.file('dashboard.jpg', await page.screenshot({ type: 'jpeg', quality: 80 }));
  await page.close();
  return { locality: 'loudoun-county', changed: true, ...s.finish(fingerprint, { dataFile: s.files[0] }) };
}

// Tableau Public blocks scripted data access, but serves rendered images.
// The workbook's lastUpdateDate is the fingerprint.
async function alexandria(browser, force) {
  const meta = await retry(async () => { const r = await fetch(ALEXANDRIA_WORKBOOK); if (!r.ok) throw new Error('Alexandria workbook HTTP ' + r.status); return r.json(); });
  const fingerprint = String(meta.lastUpdateDate);
  if (!force && fingerprint === lastFingerprint('alexandria-city')) return { locality: 'alexandria-city', changed: false };
  const s = saver('alexandria-city');
  s.file('tableau-workbook.json', JSON.stringify(meta, null, 2) + '\n');
  for (const view of ALEXANDRIA_VIEWS) {
    const png = await retry(async () => {
      const r = await fetch(`https://public.tableau.com/views/ElectionDashboardNovember2026/${view}.png?:showVizHome=no&:refresh=yes`);
      if (!r.ok || !(r.headers.get('content-type') || '').includes('image/png')) throw new Error(`Alexandria ${view} HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    });
    s.file(`${view}.png`, png);
  }
  return { locality: 'alexandria-city', changed: true, workbookUpdated: new Date(meta.lastUpdateDate).toISOString(), ...s.finish(fingerprint, {}) };
}

(async () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const jobs = { arlington, loudoun, alexandria };
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  let failed = false;
  for (const [name, job] of Object.entries(jobs)) {
    if (wanted.length && !wanted.includes(name)) continue;
    try { console.log(JSON.stringify(await job(browser, force))); } catch (e) {
      failed = true;
      console.log(JSON.stringify({ locality: name, error: String(e.message || e) }));
    }
  }
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})();
