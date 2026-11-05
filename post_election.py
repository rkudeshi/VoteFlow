"""Post-election turnout by precinct and vote method, from the state's official results.

Downloads, for each completed election, the Department of Elections' "Election Turnout"
CSV (voters by precinct: early in person, Election Day, mailed absentee, provisional,
post-election), its statistics (provisional reasons, curbside) and the Election Day
polling place list, saving copies in sources/state-results/<election>/. Writes
dist/post-election/<locality>.json with turnout numbers only: no candidate or party data.

Usage: python3 post_election.py [locality-slug ...]   (default: every locality)
"""
import csv, io, json, re, subprocess, sys, urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from source_fetch import fetch_bytes

R = Path(__file__).resolve().parent
SRC = R / 'sources' / 'state-results'
OUT = R / 'dist' / 'post-election'
ENR = 'https://enr.elections.virginia.gov/results/public/api/elections/Virginia/'
CDN = 'https://enr.elections.virginia.gov/cdn/results/'
ELECT = 'https://www.elections.virginia.gov/media/registration-statistics/'

# id, state results id, region.json election key, label, polling place file (None if not posted)
ELECTIONS = [
    ('2026-11', '2026-November-General', '2026', 'November 2026', None),  # unofficial until certified
    ('2026-04', '2026-April-21-Special', '2026-special', 'April 2026 special', 'April-21-2026-Polling-Places.xlsx'),
    ('2025-11', '2025-November-General', '2025', 'November 2025', '2025-November-General-Election-Day-Polling-Locations-20251022.xlsx'),
    ('2024-11', '2024NovemberGeneral', '2024', 'November 2024', '2024-November-General-Election-Day-Polling-Locations-(10-9-24).xlsx'),
    ('2023-11', '2023-Nov-Gen', '2023', 'November 2023', None),
]
METHODS = {'Early Voting': 'ev', 'Election Day': 'ed', 'Mailed Absentee': 'mail',
           'Provisional': 'prov', 'Post-Election': 'pe'}
STATS = {'Early Voting SDR Turnout': 'sdrEarly', 'Election Day SDR Turnout': 'sdrDay',
         'Other Turnout': 'provOther', 'No ID Turnout': 'noId', 'Curbside': 'curbside'}


def stamp(iso):
    return re.sub(r'[^0-9T]', '', iso[:19]) + 'Z'


def settled(meta):
    """Certified, or untouched for six weeks (the state never flags some specials, like April 2026, as official)."""
    if meta.get('isOfficialResults'):
        return True
    last = datetime.fromisoformat(meta['asOf'][:19]).replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last > timedelta(days=42)


def cached(path, url, refresh=False):
    if refresh or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch_bytes(url))
    return path.read_bytes()


def num(v):
    v = ('' if v in (None, 'None') else v).replace(',', '').strip()
    return int(float(v)) if v else 0


def norm_name(n):
    return re.sub(r'\s+', ' ', n.upper().replace('&', 'AND')).strip()


def turnout_rows(text):
    """Precinct rows for every locality, keyed by normalized locality name."""
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        m = re.match(r'^\s*(\d+)\s*-?\s*(.+?)\s*$', r['precinct'])
        if not m and not any(num(r[c]) for c in list(METHODS) + ['TotalVoteTurnout']):
            continue  # empty countywide placeholder row (2024 "PROVISIONALS")
        if not m:
            raise ValueError(f'unexpected precinct label {r["locality"]} {r["precinct"]!r}')
        p = {'code': m.group(1).zfill(3), 'n': m.group(2).title()}
        p.update({k: num(r[col]) for col, k in METHODS.items()})
        p['t'] = num(r['TotalVoteTurnout'])
        p['r'] = num(r['TotalRegisteredVoters'])
        p['ra'] = num(r['ActiveRegisteredVoters'])
        if sum(p[k] for k in METHODS.values()) != p['t']:
            raise ValueError(f'{r["locality"]} {r["precinct"]}: methods do not add to total')
        out.setdefault(norm_name(r['locality']), []).append(p)
    return out


def stats_for(stats, name):
    out = {}
    for d in stats.get('data') or []:
        for g in d['groups']:
            label = g['name'][0]['text']
            key = next((v for k, v in STATS.items() if label.startswith(k)), None)
            if not key:
                continue
            for c in g.get('children') or []:
                if norm_name(c['name'][0]['text']) == name:
                    out[key] = num(str(c.get('value')))
    return out


def polling_places(xlsx_bytes):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True).active
    rows = ws.iter_rows(values_only=True)
    # 2026 files prefix every header with "Polling Location"; names may be title case
    head = [re.sub(r'^Polling Location (?!Name|Voting)', '', str(h).strip()) for h in next(rows)]
    head = ['Location' if h == 'Polling Location Name' else 'Voting Precinct Name' if h == 'Precinct Name' else
            'Zip Code' if h == 'Zip' else h for h in head]
    out = {}
    for r in rows:
        r = dict(zip(head, r))
        loc = norm_name(str(r.get('Locality Name') or ''))
        m = re.match(r'^\s*(\d+)', str(r['Voting Precinct Name'] or ''))
        if not loc or not m:
            continue
        code = m.group(1).zfill(3)
        addr = ' '.join(str(r[k]).strip() for k in ('Address Line 1', 'Address Line 2') if r.get(k))
        city = str(r.get('City') or '').strip()
        out.setdefault(loc, {})[code] = {'name': str(r['Location']).strip().title(), 'addr': addr.title() if addr.isupper() else addr,
                     'city': city.title() if city.isupper() else city, 'zip': str(r.get('Zip Code') or '').strip()[:5]}
    return out


def addr_key(a):
    a = a.upper().replace('.', '')
    a = re.sub(r'\b(STREET|ST)\b', 'ST', a)
    a = re.sub(r'\b(ROAD|RD)\b', 'RD', a)
    a = re.sub(r'\b(AVENUE|AVE)\b', 'AVE', a)
    a = re.sub(r'\b(DRIVE|DR)\b', 'DR', a)
    a = re.sub(r'\b(LANE|LN)\b', 'LN', a)
    a = re.sub(r'\b(BOULEVARD|BLVD)\b', 'BLVD', a)
    a = re.sub(r'\b(PARKWAY|PKWY)\b', 'PKWY', a)
    a = re.sub(r'\b(COURT|CT)\b', 'CT', a)
    return re.sub(r'[^A-Z0-9]', '', a)[:14]


GEOCACHE = SRC / 'geocode-cache.json'
CENSUS_BATCH = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'


def geocode_batch(places, cache):
    """Census batch geocoder for polling places; results cached by full address."""
    todo = sorted({k for k in places if k not in cache})
    for i in range(0, len(todo), 2000):
        chunk = todo[i:i + 2000]
        body = io.StringIO()
        w = csv.writer(body)
        for n, key in enumerate(chunk):
            street, city, zip5 = places[key]
            w.writerow([n, street, city, 'VA', zip5])
        tmp = SRC / '.geocode-batch.csv'
        tmp.write_text(body.getvalue())
        res = subprocess.run(['curl', '-sS', '--max-time', '600', '--form', f'addressFile=@{tmp}',
                              '--form', 'benchmark=Public_AR_Current', CENSUS_BATCH], capture_output=True, text=True)
        tmp.unlink()
        if res.returncode:
            print('geocode batch failed', res.stderr[:200])
            continue
        for row in csv.reader(io.StringIO(res.stdout)):
            if len(row) >= 6 and row[2] == 'Match':
                lon, lat = map(float, row[5].split(','))
                cache[chunk[int(row[0])]] = [round(lon, 5), round(lat, 5)]
            elif row and row[0].isdigit():
                cache[chunk[int(row[0])]] = None
        print(f'geocoded {len(chunk)} polling places')


def county_history(region, key, slug, election_date):
    """Cumulative early-in-person and mail returns by day from the absentee list."""
    loc = next((l for l in region['elections'][key]['localities'] if l['id'] == slug), None)
    if not loc:
        return []
    return [[h['date'], h['early'], h['mail']] for h in loc['history'] if h['date'] < election_date]


def changes_by_locality(folder):
    """Precinct counts that moved between saved versions of an uncertified election's turnout file."""
    snaps = sorted((folder / 'snapshots').glob('*-turnout.csv'))
    out = {}
    for older, newer in zip(snaps, snaps[1:]):
        a, b = turnout_rows(older.read_text()), turnout_rows(newer.read_text())
        when = newer.name.split('-')[0]
        for loc, rows in b.items():
            before = {p['code']: p for p in a.get(loc, [])}
            for p in rows:
                q = before.get(p['code'], {})
                for k in METHODS.values():
                    if p[k] != q.get(k, 0):
                        out.setdefault(loc, []).append({'at': when, 'code': p['code'], 'n': p['n'], 'k': k, 'd': p[k] - q.get(k, 0), 'v': p[k]})
    return out


def top_race_rows(short, sid, folder):
    """Precinct counts by vote method from the race with the most votes (U.S. Senate, Governor, President).

    Used while an uncertified election's turnout file is incomplete: the top race is counted on nearly
    every ballot, so its method split per precinct is the best early picture. Candidate totals are summed
    away here; nothing about who got the votes is kept.
    """
    base = ENR.replace('Virginia/', f'{short}/') + sid + '/data'
    data = json.loads(fetch_bytes(base))
    top = max(data['ballotItems'], key=lambda b: b.get('voteTotal') or 0)
    item = json.loads(fetch_bytes(base + '/ballot-item/' + top['id']))['ballotItemWithBreakdown']
    reg = {v['id']: v for v in data['voterTurnout']}
    rows = []
    for r in item['breakdownResults']:
        m = re.match(r'^\s*(\d+)\s*-?\s*(.+?)\s*(\(\d+\))?\s*$', r['precinct']['name'][0]['text'])
        if not m:
            continue
        p = {'code': m.group(1).zfill(3), 'n': m.group(2).title(), **{k: 0 for k in METHODS.values()}}
        for o in r['ballotOptions']:
            for g in o['groupResults']:
                k = METHODS.get(g['groupName'][0]['text'])
                if k:
                    p[k] += g['voteCount']
        p['t'] = sum(p[k] for k in METHODS.values())
        v = reg.get(r['precinct']['id'], {})
        p['b'] = int(v.get('ballotsCast') or 0)
        p['r'] = int(v.get('voterRegistration') or 0)
        p['ra'] = 0
        rows.append(p)
    return rows, top['name'][0]['text']


def gis_polling_places():
    """Current polling places from county GIS layers we hold, for elections the state hasn't listed yet."""
    out = {}
    for gis in (R / 'sources' / 'election-results').glob('*/polling-places.geojson'):
        for f in json.loads(gis.read_text())['features']:
            q = f['properties']
            if q.get('TYPE') not in (None, 'POLL') or q.get('PREC_IDENT') is None:
                continue
            addr = f"{q['STREET_NUMBER']} {q['STREET_NAME']}".title()
            out.setdefault(gis.parent.name, {})[str(q['PREC_IDENT']).zfill(3)] = {
                'name': q['DESCRIPTION'].title(), 'addr': addr, 'city': (q.get('CITY') or '').title(), 'zip': ''}
    return out


def gis_coords():
    """Polling place points from county GIS layers we already hold (Fairfax)."""
    coords = {}
    for gis in (R / 'sources' / 'election-results').glob('*/polling-places.geojson'):
        for f in json.loads(gis.read_text())['features']:
            q = f['properties']
            coords[(gis.parent.name, addr_key(f"{q['STREET_NUMBER']} {q['STREET_NAME']}"))] = f['geometry']['coordinates']
    return coords


def build(slugs=None, refresh=False):
    region = json.loads((R / 'dist' / 'region.json').read_text())
    names = {}
    for el in region['elections'].values():
        for l in el['localities']:
            names[l['id']] = l['name']
    by_name = {norm_name(n): slug for slug, n in names.items()}
    coords, cache, gis_places = gis_coords(), (json.loads(GEOCACHE.read_text()) if GEOCACHE.exists() else {}), gis_polling_places()
    sources = []
    jur = json.loads(fetch_bytes(ENR.replace('elections/', 'jurisdictions/').rstrip('/')))
    loc_names = {l['id'].lower(): norm_name(l['name'][0]['text']) for l in jur['childLocalities']}
    for eid, sid, key, label, pp_file in ELECTIONS:
        folder = SRC / sid
        # an election that isn't certified yet keeps changing: fetch it fresh every run
        saved = folder / 'election.json'
        live = not saved.exists() or not settled(json.loads(saved.read_text()))
        meta = json.loads(cached(saved, ENR + sid, refresh or live))
        meta['isOfficialResults'] = settled(meta)
        live = not meta['isOfficialResults']
        blobs = {r['reportName']: r['blobName'] for c in meta['publicReportCategories'] for r in c['reports']}
        text = cached(folder / 'turnout.csv', CDN + meta['jurisdictionId'] + '/' +
                      urllib.parse.quote(blobs['Election Turnout']), refresh or live).decode('utf-8-sig')
        stats = json.loads(cached(folder / 'stats.json', ENR + sid + '/stats', refresh or live))
        status = {}
        if live:
            # keep a dated copy of every version until the state certifies, so corrections stay visible
            snap = folder / 'snapshots' / f"{stamp(meta['asOf'])}-turnout.csv"
            prev = sorted((folder / 'snapshots').glob('*-turnout.csv'))
            if not prev or prev[-1].read_text() != text:
                snap.parent.mkdir(parents=True, exist_ok=True)
                snap.write_text(text)
            for l in json.loads(cached(folder / 'localities.json', ENR + sid + '/localities', True)):
                nm = loc_names.get(l['jurisdictionId'].lower())
                if nm:
                    status[nm] = {'counted': num(str(l.get('ballotsCast'))), 'asOf': l.get('asOf', '')[:19],
                                  'groups': {g['groupName'][0]['text']: g['reportingStatusClientTextKey'].replace('reporting-status-', '')
                                             for g in l.get('groupReportingStatus') or []}}
        places = polling_places(cached(folder / 'polling-places.xlsx', ELECT + urllib.parse.quote(pp_file), refresh)) if pp_file else {}
        rows = turnout_rows(text)
        unknown = sorted(set(rows) - set(by_name))
        if unknown:
            raise ValueError(f'{sid}: localities not on the site: {unknown}')
        changes = changes_by_locality(folder) if live or (folder / 'snapshots').exists() else {}
        sources.append((eid, key, label, meta, stats, places, rows, status, changes))
    # geocode every polling place we can't place from county GIS, in one batch
    want = {}
    for *_, places, rows, status, changes in sources:
        for loc, pls in places.items():
            for pl in pls.values():
                want[f"{pl['addr']}, {pl['city']}"] = (pl['addr'], pl['city'], pl['zip'])
    geocode_batch(want, cache)
    GEOCACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    sid_of = {e[0]: e[1] for e in ELECTIONS}
    for name, slug in sorted(by_name.items(), key=lambda x: x[1]):
        if slugs and slug not in slugs:
            continue
        elections = []
        for eid, key, label, meta, stats, places, rows, status, changes in sources:
            ps = [dict(p) for p in rows.get(name, [])]
            basis = None
            if status.get(name):
                # during the canvass the turnout file can lag or misalign; fall back to the top race when
                # its total is more than 2% off the ballots the state reports counted
                counted = status[name]['counted']
                if not ps or abs(sum(p['t'] for p in ps) - counted) > 0.02 * counted or not sum(p['ev'] + p['ed'] for p in ps):
                    try:
                        ps, basis = top_race_rows(slug, sid_of[eid], SRC / sid_of[eid])
                    except Exception as err:
                        print(f'{slug} {eid}: turnout file incomplete and no top-race fallback ({err}); skipped')
                        ps = []
            if not ps:
                continue
            pls = places.get(name) or gis_places.get(slug, {})
            for p in ps:
                pl = pls.get(p['code'])
                if pl:
                    p['pp'] = pl['name']
                    p['ppAddr'] = f"{pl['addr']}, {pl['city']}"
                    xy = coords.get((slug, addr_key(pl['addr']))) or cache.get(p['ppAddr'])
                    if xy:
                        p['ppXY'] = [round(xy[0], 5), round(xy[1], 5)]
            county = {k: sum(p[k] for p in ps) for k in list(METHODS.values()) + ['t', 'r', 'ra']}
            el = region['elections'].get(key, {})
            extra = {}
            if name in status:
                extra['status'] = status[name]
            if basis:
                extra['basis'] = basis
                # dated copies of the top-race counts, so the page can list what moved between updates
                snaps = SRC / sid_of[eid] / 'snapshots'
                now = {p['code']: [p[k] for k in METHODS.values()] for p in ps}
                prev = sorted(snaps.glob(f'*-{slug}.json'))
                if not prev or json.loads(prev[-1].read_text()) != now:
                    snaps.mkdir(parents=True, exist_ok=True)
                    (snaps / f"{stamp(meta['asOf'])}-{slug}.json").write_text(json.dumps(now, separators=(',', ':')))
                    prev = sorted(snaps.glob(f'*-{slug}.json'))
                names_by_code = {p['code']: p['n'] for p in ps}
                moved = []
                for older, newer in zip(prev, prev[1:]):
                    a, b = json.loads(older.read_text()), json.loads(newer.read_text())
                    for code, vals in b.items():
                        for k, v, w in zip(METHODS.values(), vals, a.get(code, [0] * len(METHODS))):
                            if v != w:
                                moved.append({'at': newer.name.split('-')[0], 'code': code, 'n': names_by_code.get(code, ''), 'k': k, 'd': v - w, 'v': v})
                changes = {name: moved}
            if changes.get(name):
                extra['changes'] = changes[name][-60:]
            if not meta.get('isOfficialResults') and el:
                loc = next((l for l in el['localities'] if l['id'] == slug), None)
                if loc and loc['history']:
                    extra['outstanding'] = loc['history'][-1].get('outstanding')
            elections.append({'id': eid, 'date': meta['electionDate'], 'label': label, **extra,
                              'official': bool(meta.get('isOfficialResults')), 'asOf': meta.get('asOf', '')[:19],
                              'county': county, 'stats': stats_for(stats, name), 'precincts': ps,
                              'early': county_history(region, key, slug, el.get('electionDate', meta['electionDate'])) if el else []})
        if not elections:
            continue
        (OUT / f'{slug}.json').write_text(json.dumps({'locality': slug, 'name': names[slug], 'elections': elections},
                                                     separators=(',', ':')))
        index[slug] = [e['id'] for e in elections]
    if not slugs:
        (OUT / 'index.json').write_text(json.dumps(index, separators=(',', ':')))
    placed = sum(1 for *_, places, _, _, _ in sources for pls in places.values() for pl in pls.values()
                 if cache.get(f"{pl['addr']}, {pl['city']}"))
    total = sum(len(pls) for *_, places, _, _, _ in sources for pls in places.values())
    print(f'wrote {len(index)} localities; polling places placed {placed:,} of {total:,}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    build(set(args) or None, refresh='--refresh' in sys.argv)
