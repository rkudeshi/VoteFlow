"""Post-election turnout by precinct and vote method, from the state's official results.

Downloads, for each completed election, the Department of Elections' "Election Turnout"
CSV (voters by precinct: early in person, Election Day, mailed absentee, provisional,
post-election), its statistics (provisional reasons, curbside) and the Election Day
polling place list, saving copies in sources/state-results/<election>/. Writes
dist/post-election/<locality>.json with turnout numbers only: no candidate or party data.

Usage: python3 post_election.py [locality-slug ...]   (default: fairfax-county)
"""
import csv, io, json, re, sys, urllib.parse
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
    ('2026-04', '2026-April-21-Special', '2026-special', 'April 2026 special', 'April-21-2026-Polling-Places.xlsx'),
    ('2025-11', '2025-November-General', '2025', 'November 2025', '2025-November-General-Election-Day-Polling-Locations-20251022.xlsx'),
    ('2024-11', '2024NovemberGeneral', '2024', 'November 2024', '2024-November-General-Election-Day-Polling-Locations-(10-9-24).xlsx'),
    ('2023-11', '2023-Nov-Gen', '2023', 'November 2023', None),
]
METHODS = {'Early Voting': 'ev', 'Election Day': 'ed', 'Mailed Absentee': 'mail',
           'Provisional': 'prov', 'Post-Election': 'pe'}
STATS = {'Early Voting SDR Turnout': 'sdrEarly', 'Election Day SDR Turnout': 'sdrDay',
         'Other Turnout': 'provOther', 'No ID Turnout': 'noId', 'Curbside': 'curbside'}


def cached(path, url, refresh=False):
    if refresh or not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch_bytes(url))
    return path.read_bytes()


def num(v):
    v = (v or '').replace(',', '').strip()
    return int(float(v)) if v else 0


def locality_name(slug):
    return slug.replace('-', ' ').upper()


def turnout_rows(text, name):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        if r['locality'] != name:
            continue
        m = re.match(r'^\s*(\d+)\s*-\s*(.+?)\s*$', r['precinct'])
        if not m and not any(num(r[c]) for c in list(METHODS) + ['TotalVoteTurnout']):
            continue  # empty countywide placeholder row (2024 "PROVISIONALS")
        if not m:
            raise ValueError(f'unexpected precinct label {r["precinct"]!r}')
        p = {'code': m.group(1).zfill(3), 'n': m.group(2).title()}
        p.update({k: num(r[col]) for col, k in METHODS.items()})
        p['t'] = num(r['TotalVoteTurnout'])
        p['r'] = num(r['TotalRegisteredVoters'])
        p['ra'] = num(r['ActiveRegisteredVoters'])
        if sum(p[k] for k in METHODS.values()) != p['t']:
            raise ValueError(f'{name} {r["precinct"]}: methods do not add to total')
        rows.append(p)
    return rows


def stats_for(stats, name):
    out = {}
    for d in stats.get('data') or []:
        for g in d['groups']:
            label = g['name'][0]['text']
            key = next((v for k, v in STATS.items() if label.startswith(k)), None)
            if not key:
                continue
            for c in g.get('children') or []:
                if c['name'][0]['text'] == name:
                    out[key] = num(str(c.get('value')))
    return out


def polling_places(xlsx_bytes, name):
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
        if str(r.get('Locality Name') or '').upper() != name:
            continue
        code = re.match(r'^\s*(\d+)', str(r['Voting Precinct Name'])).group(1).zfill(3)
        addr = ' '.join(str(r[k]).strip() for k in ('Address Line 1', 'Address Line 2') if r.get(k))
        city = str(r.get('City') or '').strip()
        out[code] = {'name': str(r['Location']).strip().title(), 'addr': addr.title() if addr.isupper() else addr,
                     'city': city.title() if city.isupper() else city}
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
CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address='


def geocode(addr, cache):
    """Census geocoder for polling places the county GIS layer does not list; results cached."""
    if addr not in cache:
        try:
            m = json.loads(fetch_bytes(CENSUS + urllib.parse.quote(addr + ', VA'), timeout=30))['result']['addressMatches']
            cache[addr] = [round(m[0]['coordinates']['x'], 5), round(m[0]['coordinates']['y'], 5)] if m else None
        except Exception as error:
            print('geocode failed', addr, error)
            return None
    return cache[addr]


def county_history(region, key, slug, election_date):
    """Cumulative early-in-person and mail returns by day from the absentee list."""
    loc = next(l for l in region['elections'][key]['localities'] if l['id'] == slug)
    return [[h['date'], h['early'], h['mail']] for h in loc['history'] if h['date'] < election_date]


def build(slug, refresh=False):
    name = locality_name(slug)
    region = json.loads((R / 'dist' / 'region.json').read_text())
    coords = {}
    gis = R / 'sources' / 'election-results' / slug / 'polling-places.geojson'
    if gis.exists():
        for f in json.loads(gis.read_text())['features']:
            q = f['properties']
            coords[addr_key(f"{q['STREET_NUMBER']} {q['STREET_NAME']}")] = f['geometry']['coordinates']
    cache = json.loads(GEOCACHE.read_text()) if GEOCACHE.exists() else {}
    elections = []
    for eid, sid, key, label, pp_file in ELECTIONS:
        folder = SRC / sid
        meta = json.loads(cached(folder / 'election.json', ENR + sid, refresh))
        blobs = {r['reportName']: r['blobName'] for c in meta['publicReportCategories'] for r in c['reports']}
        text = cached(folder / 'turnout.csv', CDN + meta['jurisdictionId'] + '/' +
                      urllib.parse.quote(blobs['Election Turnout']), refresh).decode('utf-8-sig')
        stats = json.loads(cached(folder / 'stats.json', ENR + sid + '/stats', refresh))
        rows = turnout_rows(text, name)
        if not rows:
            raise ValueError(f'no {name} rows in {sid}')
        places = polling_places(cached(folder / 'polling-places.xlsx', ELECT + urllib.parse.quote(pp_file), refresh), name) if pp_file else {}
        for p in rows:
            pl = places.get(p['code'])
            if pl:
                p['pp'] = pl['name']
                p['ppAddr'] = f"{pl['addr']}, {pl['city']}"
                xy = coords.get(addr_key(pl['addr'])) or geocode(p['ppAddr'], cache)
                if xy:
                    p['ppXY'] = [round(xy[0], 5), round(xy[1], 5)]
        county = {k: sum(p[k] for p in rows) for k in list(METHODS.values()) + ['t', 'r', 'ra']}
        st = stats_for(stats, name)
        if st.get('sdrEarly') is not None and 'provOther' in st:
            reasons = st['sdrEarly'] + st['sdrDay'] + st['provOther'] + st.get('noId', 0)
            if reasons != county['prov']:
                print(f'note: {sid} provisional reasons {reasons} vs precinct total {county["prov"]}')
        el = region['elections'][key]
        elections.append({'id': eid, 'date': meta['electionDate'], 'label': label,
                          'official': bool(meta.get('isOfficialResults')), 'asOf': meta.get('asOf', '')[:10],
                          'county': county, 'stats': st, 'precincts': rows,
                          'early': county_history(region, key, slug, el['electionDate'])})
        print(f'{eid}: {len(rows)} precincts, {county["t"]:,} voters, {sum(1 for p in rows if "pp" in p)} polling places, '
              f'{sum(1 for p in rows if "ppXY" in p)} placed')
    GEOCACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f'{slug}.json'
    out.write_text(json.dumps({'locality': slug, 'name': name.title(), 'elections': elections}, separators=(',', ':')))
    print('wrote', out.relative_to(R))


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for slug in args or ['fairfax-county']:
        build(slug, refresh='--refresh' in sys.argv)
