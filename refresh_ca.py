"""Check the California Secretary of State for a new vote-by-mail ballot statistics report.

    python3 refresh_ca.py            fetch, validate, archive, rebuild dist/ca/data.json
    python3 refresh_ca.py --dry-run  fetch and validate only; write nothing

Each run reads the general-election landing page fresh and follows the PDF and XLSX links it
actually lists (the dated file names change daily; the undated ones are only a fallback). Both
files must be real (PDF header, XLSX zip with workbook XML), and their report dates must agree
before the workbook can update the site. Files are kept unchanged in sources/ca/reports/ under
their internal as-of date; identical bytes are never stored twice, and changed bytes for a date
already saved are kept beside the original as -retrieved-<UTC stamp>. Every run appends one line
to sources/ca/observations.jsonl, with the response headers, so publication timing is on record.

It also watches the page for an Unprocessed Ballots report link (posted after Election Day) and
archives any such file in sources/ca/unprocessed/ for parsing once its format is known.

Exit codes: 0 new data saved, 3 nothing new, 1 failure (last good data left in place).
"""
import datetime as dt
import email.utils
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import ca_data

ROOT = Path(__file__).resolve().parent
LANDING = 'https://www.sos.ca.gov/elections/upcoming-elections/general-election-november-3-2026'
UNDATED = {'pdf': 'https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics.pdf',
           'xlsx': 'https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics.xlsx'}
REPORTS = ca_data.REPORTS
UNPROCESSED = ROOT / 'sources' / 'ca' / 'unprocessed'
LOG = ROOT / 'sources' / 'ca' / 'observations.jsonl'
UA = 'Mozilla/5.0 (compatible; VoteFlow data refresh; +https://voteflow.us)'
PT = None
try:
    from zoneinfo import ZoneInfo
    PT = ZoneInfo('America/Los_Angeles')
except Exception:  # pragma: no cover
    pass
HEADERS = ['date', 'last-modified', 'etag', 'content-type', 'content-length', 'x-amz-meta-cb-modifiedtime', 'x-amz-version-id', 'x-cache']


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def get(url, tries=3):
    """→ (status, headers dict, bytes, final url). Retries timeouts and 408/429/5xx with backoff."""
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, {h.lower(): v for h, v in r.headers.items()}, r.read(), r.geturl()
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (408, 429) and e.code < 500:
                return e.code, {h.lower(): v for h, v in e.headers.items()}, b'', url
        except Exception as e:  # network trouble
            last = e
        time.sleep(2 * 2 ** k)
    raise RuntimeError(f'{url}: {last}')


def pacific(h):
    try:
        t = email.utils.parsedate_to_datetime(h)
        return t.astimezone(PT).isoformat() if PT else None
    except Exception:
        return None


def links(page):
    """Ballot return statistics PDF/XLSX links and any unprocessed-ballots links on the landing page."""
    found = {'pdf': [], 'xlsx': [], 'unprocessed': []}
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S | re.I):
        url = urllib.parse.urljoin(LANDING, html.unescape(m.group(1)).strip())
        text = re.sub(r'<[^>]+>', ' ', m.group(2)).lower()
        low = url.lower()
        if 'bsr-statistics' in low or 'ballot-return' in low:
            for ext in ('pdf', 'xlsx'):
                if low.split('?')[0].endswith('.' + ext) and url not in found[ext]:
                    found[ext].append(url)
        if 'unprocessed' in low or 'unprocessed' in text:
            found['unprocessed'].append(url)
    return found


MONTHS = r'(January|February|March|April|May|June|July|August|September|October|November|December)'


def as_of(text):
    """The date after 'as of' in a title or page text: 'Monday, October 19, 2026' or '10/12/26'."""
    m = re.search(r'as of:?\s*(?:[A-Za-z]+,\s*)?' + MONTHS + r'\s+(\d{1,2}),\s*(\d{4})', text, re.I)
    if m:
        return dt.datetime.strptime(' '.join(m.groups()), '%B %d %Y').date().isoformat()
    m = re.search(r'as of:?\s*(\d{1,2})/(\d{1,2})/(\d{2,4})', text, re.I)
    if m:
        y = int(m.group(3)); y += 2000 if y < 100 else 0
        return dt.date(y, int(m.group(1)), int(m.group(2))).isoformat()
    return None


def pdf_date(data):
    """As-of date from the PDF itself: its metadata title, else the first page's text (poppler)."""
    if not data.startswith(b'%PDF') or b'%%EOF' not in data[-2048:]:
        raise ValueError('not a complete PDF')
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
        f.write(data); f.flush()
        for cmd in (['pdfinfo', f.name], ['pdftotext', '-l', '1', f.name, '-']):
            try:
                out = subprocess.run(cmd, capture_output=True, timeout=60).stdout.decode('utf-8', 'replace')
            except (OSError, subprocess.SubprocessError):
                continue
            d = as_of(re.sub(r'\s+', ' ', out))
            if d:
                return d
    return as_of(data.decode('latin-1'))


def xlsx_report(data):
    if not data.startswith(b'PK'):
        raise ValueError('not an XLSX (zip) file')
    z = zipfile.ZipFile(io.BytesIO(data))
    bad = z.testzip()
    if bad:
        raise ValueError('corrupt zip member ' + bad)
    return ca_data.parse_report(io.BytesIO(data))


def known_hashes():
    seen = {}
    for p in REPORTS.glob('CA-ballot-return-statistics-*'):
        if p.suffix in ('.pdf', '.xlsx'):
            seen[hashlib.sha256(p.read_bytes()).hexdigest()] = p.name
    return seen


def save(day, ext, data, stamp, dry):
    """Store bytes under their report date; a different file for a date already saved becomes a revision."""
    base = REPORTS / f'CA-ballot-return-statistics-{day}.{ext}'
    target = base if not base.exists() else REPORTS / f'CA-ballot-return-statistics-{day}-retrieved-{stamp}.{ext}'
    if not dry:
        tmp = target.with_suffix(target.suffix + '.tmp')
        tmp.write_bytes(data)
        tmp.replace(target)
    return target.name, target != base


def main():
    dry = '--dry-run' in sys.argv
    start = now()
    stamp = start.strftime('%Y%m%dT%H%M%SZ')
    obs = {'checked': start.isoformat(), 'checkedPacific': start.astimezone(PT).isoformat() if PT else None, 'landing': LANDING, 'files': [], 'result': None}
    try:
        status, _, page, _ = get(LANDING)
        if status != 200:
            raise RuntimeError(f'landing page HTTP {status}')
        found = links(page.decode('utf-8', 'replace'))
        obs['links'] = found
        seen = known_hashes()
        got = {}
        for ext in ('xlsx', 'pdf'):
            for url in found[ext] + [UNDATED[ext]]:
                t0 = now()
                code, hdr, data, final = get(url)
                rec = {'format': ext, 'url': url, 'resolved': final, 'status': code, 'start': t0.isoformat(), 'end': now().isoformat(),
                       'headers': {h: hdr[h] for h in HEADERS if h in hdr}, 'lastModifiedPacific': pacific(hdr.get('last-modified', '')),
                       'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest() if data else None}
                obs['files'].append(rec)
                if code != 200 or not data:
                    rec['validation'] = f'HTTP {code}'
                    continue
                try:
                    if ext == 'xlsx':
                        r = xlsx_report(data)
                        rec['asOf'] = r['asOf']
                    else:
                        rec['asOf'] = pdf_date(data)
                        if not rec['asOf']:
                            raise ValueError('no report date in PDF metadata')
                    rec['validation'] = 'ok'
                    got[ext] = (rec, data)
                    break
                except Exception as e:
                    rec['validation'] = 'invalid: ' + str(e)
        if 'xlsx' not in got:
            raise RuntimeError('no valid workbook: ' + '; '.join(f'{f["url"]} → {f.get("validation")}' for f in obs['files'] if f['format'] == 'xlsx'))
        xrec, xdata = got['xlsx']
        day = xrec['asOf']
        prec = got.get('pdf', (None, None))[0]
        obs['asOf'] = day
        obs['pairMatches'] = bool(prec and prec['asOf'] == day)
        new = []
        for ext, (rec, data) in got.items():
            if rec['sha256'] in seen:
                rec['saved'] = seen[rec['sha256']] + ' (unchanged)'
                continue
            name, revision = save(rec['asOf'], ext, data, stamp, dry)
            rec['saved'] = name
            new.append((ext, rec['asOf'], revision))
        # Metadata beside each newly saved report (never overwrite an older record).
        if new and not dry:
            for asof in {a for _, a, _ in new}:
                meta = REPORTS / f'CA-ballot-return-statistics-{asof}-metadata.json'
                if meta.exists():
                    meta = REPORTS / f'CA-ballot-return-statistics-{asof}-retrieved-{stamp}-metadata.json'
                files = [dict(r, filename=r.get('saved'), timestamps_pacific={'last-modified': r.get('lastModifiedPacific')}) for r in obs['files'] if r.get('asOf') == asof and r.get('validation') == 'ok']
                meta.write_text(json.dumps({'source_page': LANDING, 'report_as_of': asof, 'report_dates_match': obs['pairMatches'], 'files': files}, indent=2))
        # County registration: pick up the 15-day Report of Registration once the state posts it.
        ror = ca_data.REGISTRATION / '15day-gen-2026-county.xlsx'
        if not ror.exists():
            code, hdr, data, final = get('https://elections.cdn.sos.ca.gov/ror/15day-gen-2026/county.xlsx', tries=1)
            if code == 200 and data.startswith(b'PK'):
                if not dry:
                    ror.write_bytes(data)
                    try:
                        ca_data.registration()
                    except Exception as e:  # keep the file for review, fall back to the 60-day report
                        ror.rename(ror.with_suffix('.xlsx.invalid'))
                        obs['registrationError'] = str(e)
                new.append(('registration', '15-day', False))
        # Unprocessed ballots report: archive whatever the state links, unparsed for now.
        for url in found['unprocessed']:
            if not re.search(r'\.(pdf|xlsx?|csv)(\?|$)', url, re.I):
                obs.setdefault('unprocessedPages', []).append(url)
                continue
            code, hdr, data, final = get(url)
            if code == 200 and data and hashlib.sha256(data).hexdigest() not in known_unprocessed():
                name = re.sub(r'[^A-Za-z0-9.-]+', '-', urllib.parse.urlparse(final).path.split('/')[-1])
                if not dry:
                    UNPROCESSED.mkdir(parents=True, exist_ok=True)
                    (UNPROCESSED / f'{stamp}-{name}').write_bytes(data)
                new.append(('unprocessed', name, False))
        obs['saved'] = [f'{e} {a}' + (' (same-date revision)' if r else '') for e, a, r in new]
        if not new:
            obs['result'] = 'unchanged'
            return finish(obs, dry, 3)
        if not dry:
            ca_data.main()
        obs['result'] = 'saved'
        return finish(obs, dry, 0)
    except Exception as e:
        obs['result'] = 'error'
        obs['error'] = str(e)
        return finish(obs, dry, 1)


def known_unprocessed():
    return {hashlib.sha256(p.read_bytes()).hexdigest() for p in UNPROCESSED.glob('*')} if UNPROCESSED.exists() else set()


def finish(obs, dry, code):
    obs['finished'] = now().isoformat()
    line = json.dumps(obs, separators=(',', ':'))
    if not dry:
        with LOG.open('a') as f:
            f.write(line + '\n')
    summary = {0: 'New California data: ' + ', '.join(obs.get('saved', [])), 3: 'No new California report (latest ' + str(obs.get('asOf')) + ')',
               1: 'California refresh failed: ' + str(obs.get('error'))}[code]
    print(summary)
    if code == 0 and not obs.get('pairMatches'):
        print('Note: PDF and workbook dates differ or the PDF was missing; both kept under their own dates.')
    return code


if __name__ == '__main__':
    sys.exit(main())
