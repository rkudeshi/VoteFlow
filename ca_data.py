"""California vote-by-mail ballot statistics: parse, validate and build the /ca page data.

The state posts one cumulative workbook (and a matching PDF) per report date. Every saved
workbook lives unchanged in sources/ca/reports/CA-ballot-return-statistics-<as-of date>.xlsx;
same-date revisions are kept beside it with a -retrieved-<UTC stamp> suffix and the newest one wins.

    python3 ca_data.py            rebuild dist/ca/data.json from every saved workbook
    python3 ca_data.py --check    validate only

Standard library only (the Pages workflow has no openpyxl). Daily figures are the change between
consecutive reports, never invented: a missing report date leaves a gap that the next report spans,
and a drop (a county correction) is kept as a negative change.
"""
import datetime as dt
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / 'sources' / 'ca' / 'reports'
OUT = ROOT / 'dist' / 'ca' / 'data.json'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
ELECTION = {'date': '2026-11-03', 'label': 'November 2026 · General'}
# Source header (whitespace and case folded) → field. Returned methods are additive; total returned is
# their sum; accepted is a subset of returned. Issued counts distinct voters sent a ballot.
FIELDS = {'county': 'county', 'county type': 'type', 'total voters issued vbm ballots': 'issued', 'drop box': 'dropbox',
          'drop off location': 'dropoff', 'vote center drop off': 'votecenter', 'mail': 'mail', 'fax': 'fax', 'other': 'other',
          'total returned vbm ballots': 'returned', 'total accepted vbm ballots': 'accepted'}
NUMS = ['issued', 'dropbox', 'dropoff', 'votecenter', 'mail', 'fax', 'other', 'returned', 'accepted']
METHODS = ['dropbox', 'dropoff', 'votecenter', 'mail', 'fax', 'other']
TYPES = {'vca county': 'Vote center', 'polling place': 'Polling place', 'all mail': 'All mail'}
COUNTIES = ['Alameda', 'Alpine', 'Amador', 'Butte', 'Calaveras', 'Colusa', 'Contra Costa', 'Del Norte', 'El Dorado', 'Fresno', 'Glenn',
            'Humboldt', 'Imperial', 'Inyo', 'Kern', 'Kings', 'Lake', 'Lassen', 'Los Angeles', 'Madera', 'Marin', 'Mariposa', 'Mendocino',
            'Merced', 'Modoc', 'Mono', 'Monterey', 'Napa', 'Nevada', 'Orange', 'Placer', 'Plumas', 'Riverside', 'Sacramento', 'San Benito',
            'San Bernardino', 'San Diego', 'San Francisco', 'San Joaquin', 'San Luis Obispo', 'San Mateo', 'Santa Barbara', 'Santa Clara',
            'Santa Cruz', 'Shasta', 'Sierra', 'Siskiyou', 'Solano', 'Sonoma', 'Stanislaus', 'Sutter', 'Tehama', 'Trinity', 'Tulare',
            'Tuolumne', 'Ventura', 'Yolo', 'Yuba']


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') + '-county'


def fold(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().lower()


def read_sheet(data):
    """First worksheet of an .xlsx as rows of cell values (numbers as float, text as str),
    plus whether the workbook uses the 1904 date system."""
    z = zipfile.ZipFile(data)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    pr = wb.find('m:workbookPr', NS)
    d1904 = pr is not None and pr.get('date1904') in ('1', 'true')
    first = wb.find('m:sheets/m:sheet', NS).get('{%s}id' % NS['r'])
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = next(r.get('Target') for r in rels if r.get('Id') == first)
    path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
    rows = []
    for row in ET.fromstring(z.read(path)).iter('{%s}row' % NS['m']):
        out = {}
        for c in row.findall('m:c', NS):
            ref = re.match(r'([A-Z]+)', c.get('r')).group(1)
            col = 0
            for ch in ref:
                col = col * 26 + ord(ch) - 64
            t, v = c.get('t'), c.find('m:v', NS)
            if t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
            elif v is None:
                continue
            elif t == 's':
                val = shared[int(v.text)]
            elif t in ('str', 'e'):
                val = v.text
            elif t == 'b':
                val = v.text == '1'
            else:
                val = float(v.text)
            out[col - 1] = val
        if out:
            rows.append([out.get(i) for i in range(max(out) + 1)])
    return rows, d1904


def serial_date(x, d1904):
    base = dt.datetime(1904, 1, 1) if d1904 else dt.datetime(1899, 12, 30)
    return base + dt.timedelta(days=float(x))


def parse_report(path):
    """→ {'asOf': 'YYYY-MM-DD', 'counties': {name: {...}}, 'total': {...}}; raises ValueError on anything off."""
    rows, d1904 = read_sheet(path)
    path = Path(getattr(path, 'name', None) or 'workbook.xlsx')  # error messages only
    as_of = None
    for r in rows[:4]:
        for c in r:
            if isinstance(c, float) and 40000 < c < 80000:
                as_of = serial_date(c, d1904)
                break
            if isinstance(c, str):
                m = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})', c)
                if m:
                    as_of = dt.datetime.strptime(m.group(0), '%B %d, %Y')
                    break
        if as_of:
            break
    if not as_of:
        raise ValueError(f'{path.name}: no report date in the first rows')
    hi = next((i for i, r in enumerate(rows) if r and fold(r[0]) == 'county'), None)
    if hi is None:
        raise ValueError(f'{path.name}: no COUNTY header row')
    cols = {}
    for i, h in enumerate(rows[hi]):
        if fold(h) in FIELDS:
            cols[FIELDS[fold(h)]] = i
    missing = [f for f in ['county', 'type'] + NUMS if f not in cols]
    if missing:
        raise ValueError(f'{path.name}: missing columns {missing}')
    counties, total = {}, None
    for r in rows[hi + 1:]:
        name = str(r[0]).strip() if r and r[0] is not None else ''
        if not name or len(r) <= cols['issued'] or not isinstance(r[cols['issued']], float):
            continue
        rec = {}
        for f in NUMS:
            v = r[cols[f]] if cols[f] < len(r) else None
            rec[f] = None if v is None or v == '' else int(round(float(v)))
        if name.lower() == 'total':
            total = rec
            continue
        if name not in COUNTIES:
            raise ValueError(f'{path.name}: unknown county {name!r}')
        if name in counties:
            raise ValueError(f'{path.name}: duplicate row for {name}')
        rec['type'] = TYPES.get(fold(r[cols['type']]), str(r[cols['type']] or '').strip())
        counties[name] = rec
    if sorted(counties) != sorted(COUNTIES):
        raise ValueError(f'{path.name}: expected 58 counties, missing {sorted(set(COUNTIES) - set(counties))}')
    if total is None:
        raise ValueError(f'{path.name}: no Total row')
    for f in NUMS:
        s = sum(c[f] or 0 for c in counties.values())
        if total[f] is not None and s != total[f]:
            raise ValueError(f'{path.name}: county {f} adds to {s:,}, Total row says {total[f]:,}')
    notes = []
    for name, c in counties.items():
        parts = [c[m] for m in METHODS]
        if None not in parts and c['returned'] is not None and sum(parts) != c['returned']:
            raise ValueError(f'{path.name}: {name} return methods add to {sum(parts):,}, not {c["returned"]:,}')
        # Seen in the state's own files (Mendocino, Oct 11): kept as published, listed as a note.
        if None not in (c['accepted'], c['returned']) and c['accepted'] > c['returned']:
            notes.append(f'{name}: accepted ({c["accepted"]:,}) exceeds returned ({c["returned"]:,})')
    return {'asOf': as_of.date().isoformat(), 'counties': counties, 'total': total, 'notes': notes}


def saved_reports():
    """Newest saved workbook for each report date (a later -retrieved- revision replaces the original)."""
    best = {}
    for p in sorted(REPORTS.glob('CA-ballot-return-statistics-*.xlsx')):
        m = re.match(r'CA-ballot-return-statistics-(\d{4}-\d{2}-\d{2})(?:-retrieved-(\w+))?\.xlsx$', p.name)
        if m and (m.group(1) not in best or (m.group(2) or '') >= best[m.group(1)][0]):
            best[m.group(1)] = (m.group(2) or '', p)
    return {d: p for d, (_, p) in sorted(best.items())}


def published_at(day):
    """Server Last-Modified (Pacific) of the workbook for a report date, from its metadata, if recorded."""
    meta = REPORTS / f'CA-ballot-return-statistics-{day}-metadata.json'
    if not meta.exists():
        return None
    m = json.loads(meta.read_text())
    files = m if isinstance(m, list) else m.get('files', [])
    for f in files:
        name = f.get('filename') or f.get('file') or f.get('path') or ''
        if name.endswith('.xlsx') or f.get('format') == 'xlsx':
            tp = f.get('timestamps_pacific') or {}
            if tp.get('last-modified'):
                return tp['last-modified']
            lm = (f.get('headers') or {}).get('last-modified') or (f.get('headers') or {}).get('Last-Modified')
            if lm:
                try:
                    t = dt.datetime.strptime(lm, '%a, %d %b %Y %H:%M:%S GMT').replace(tzinfo=dt.timezone.utc)
                    return t.astimezone(dt.timezone(dt.timedelta(hours=-7))).isoformat()
                except ValueError:
                    return None
    return None


REGISTRATION = ROOT / 'sources' / 'ca' / 'registration'
# The state's Report of Registration: 60 days out, then 15 days out (preferred once it exists).
ROR = [('15day-gen-2026', '15-day report of registration (as of Oct 19, 2026)'), ('60day-gen-2026', '60-day report of registration (as of Sep 4, 2026)')]


def registration():
    """→ ({county name: registered voters}, statewide total, label) from the newest saved county report."""
    for key, label in ROR:
        p = REGISTRATION / f'{key}-county.xlsx'
        if not p.exists():
            continue
        rows, _ = read_sheet(p)
        hi = next(i for i, r in enumerate(rows) if r and fold(r[0]) == 'county')
        col = next(i for i, h in enumerate(rows[hi]) if fold(h) == 'total registered')
        reg, total = {}, None
        for r in rows[hi + 1:]:
            name = str(r[0] or '').strip()
            if name in COUNTIES:
                reg[name] = int(r[col])
            elif name.lower() == 'state total':
                total = int(r[col])
        if sorted(reg) != sorted(COUNTIES) or total != sum(reg.values()):
            raise ValueError(f'{p.name}: registration rows incomplete or not adding up')
        return reg, total, label
    return {}, None, None


def build():
    reports = saved_reports()
    if not reports:
        raise SystemExit('No saved California workbooks in ' + str(REPORTS))
    parsed = []
    for day, p in reports.items():
        r = parse_report(p)
        if r['asOf'] != day:
            raise ValueError(f'{p.name}: workbook says {r["asOf"]}, file name says {day}')
        parsed.append(r)
    cols = NUMS
    REG, reg_total, reg_label = registration()
    counties = []
    for name in COUNTIES:
        counties.append({'reg': REG.get(name), 'id': slug(name), 'name': name + ' County' if name != 'San Francisco' else 'San Francisco',
                         'short': name, 'type': parsed[-1]['counties'][name]['type'],
                         'rows': [[r['asOf']] + [r['counties'][name][f] for f in cols] for r in parsed]})
    flags = [{'d': r['asOf'], 'note': n} for r in parsed for n in r['notes']]
    for c in counties:
        for a, b in zip(c['rows'], c['rows'][1:]):
            for k, f in enumerate(cols):
                if f != 'issued' and a[k + 1] is not None and b[k + 1] is not None and b[k + 1] < a[k + 1]:
                    flags.append({'county': c['id'], 'd': b[0], 'field': f, 'change': b[k + 1] - a[k + 1]})
    data = {
        'state': 'ca', 'election': ELECTION, 'asOf': parsed[-1]['asOf'], 'first': parsed[0]['asOf'],
        'cols': cols, 'methods': METHODS,
        'reports': [{'d': d, 'published': published_at(d)} for d in reports],
        'total': [[r['asOf']] + [r['total'][f] for f in cols] for r in parsed],
        'counties': counties, 'corrections': flags, 'reg': reg_total, 'regLabel': reg_label,
        'built': dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
    }
    return data


def main():
    data = build()
    if '--check' in sys.argv:
        print(f'OK: {len(data["reports"])} reports, {data["first"]} through {data["asOf"]}, {len(data["corrections"])} negative changes')
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(OUT.read_text()) if OUT.exists() else None
    if old and {k: v for k, v in old.items() if k != 'built'} == {k: v for k, v in data.items() if k != 'built'}:
        print('California data unchanged through', data['asOf'])
        return
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, separators=(',', ':')))
    tmp.replace(OUT)
    print(f'Wrote {OUT.relative_to(ROOT)}: {len(data["reports"])} reports through {data["asOf"]}')


if __name__ == '__main__':
    main()
