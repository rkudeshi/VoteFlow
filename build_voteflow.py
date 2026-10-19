"""Build the compact JSON bundles the VoteFlow front end reads.

Run after the data refresh and before publishing (the Pages workflow does this):

    python3 build_voteflow.py

Reads dist/region.json, dist/archived-voting-history.json, dist/regional.geojson,
dist/weather/2026.json, dist/maps/*.json and dist/precinct-data/2026-*.json, and writes

    dist/data/home-<election>.json   one statewide bundle per election
    dist/data/loc/<locality>.json    one bundle per locality (all elections)

The bundles are generated, not edited by hand; dist/data/ is git-ignored.
"""
import datetime as dt
import json
import math
import re
from fairfax_history import drop_partial_files, merged_history
from trends import trend_notes
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'dist'
OUT = ROOT / 'data'
date = dt.date.fromisoformat

D = json.loads((ROOT / 'region.json').read_text())
ARCH = json.loads((ROOT / 'archived-voting-history.json').read_text())['localities']
W26 = json.loads((ROOT / 'weather' / '2026.json').read_text())
MANIFEST = json.loads((ROOT / 'map-manifest.json').read_text())
def nice(name):
    """Small words stay lowercase inside a place name: Isle of Wight County, King and Queen County."""
    return re.sub(r'(?<=\S )(Of|And|The|At|In|On)(?= )', lambda m: m.group(1).lower(), name or '')


for _n in D['names']:
    _n['name'] = nice(_n['name'])
for _e in D['elections'].values():
    for _l in _e['localities']:
        if 'name' in _l:
            _l['name'] = nice(_l['name'])
NAMES = {n['id']: n for n in D['names']}
# Registrar offices: full early-voting hours where the locality publishes them (office-schedules.json),
# otherwise the state's listed address and regular hours (registrar-offices.json, refresh_offices.py).
OFFICE_SCHEDULES = json.loads((ROOT.parent / 'sources' / 'office-schedules.json').read_text())['offices']
OFFICE_LISTINGS = json.loads((ROOT.parent / 'sources' / 'registrar-offices.json').read_text())['offices']
ALL_NAMES = [[n['id'], n['name']] for n in sorted(D['names'], key=lambda n: n['name'])]
# Display-only merge. Never write county values over the saved DAL observations.
for locality in D['elections']['2026']['localities']:
    if locality['id'] == 'fairfax-county':
        locality['history'] = merged_history(locality['history'], D.get('official', {}).get('2026', {}))
# Display only: a one-day partial DAL file (every count drops, then the next file restores the day
# before exactly, as Fairfax on April 26, 2026) isn't an observation. Real corrections don't bounce back.
for _e in D['elections'].values():
    for locality in _e['localities']:
        locality['history'] = drop_partial_files(locality['history'])


FX_MON = {'Sep': 9, 'Oct': 10, 'Nov': 11}
FX_TABLES = [  # (id, title, phrase that starts the section, column labels, columns kept)
    ('mailed', 'Ballots mailed or emailed', 'Ballots Mailed', ['Total', 'Mailed (domestic)', 'Mailed (overseas & military)', 'Emailed (overseas & military)'], [0, 1, 2, 3]),
    ('mail', 'Returned by mail', 'Returned by Mail', ['Returned by mail', 'Undeliverable'], [0, 2]),
    ('dropbox', 'Returned by drop box', 'Returned by Dropbox', ['Total', '24-hour drop boxes', 'Drop boxes at early-voting sites'], [0, 1, 2]),
    ('early', 'Early in-person voting by site', 'Early In Person Voting', ['Total', 'Government Center', 'Mt. Vernon', 'North County', 'Burke', 'Centreville', 'Franconia', 'Great Falls',
     'Herndon Fortnightly', 'Jim Scott', 'Lorton', 'Mason', 'McLean', 'Sully', 'Thomas Jefferson', 'Tysons-Pimmit', 'West Springfield'], list(range(17))),
    ('switched', 'Mail applicants who voted in person instead', 'Who Voted Early In Person Instead', ['Total', 'Mail ballot not surrendered', 'Mail ballot surrendered'], [0, 1, 2]),
]


def fairfax_report():
    """Display-only parse of the newest saved Fairfax AB daily report text: every daily table plus
    the first-page summary. Returns None when no saved report text exists."""
    snaps = sorted((ROOT.parent / 'sources' / 'fairfax-snapshots').glob('2026-*.txt'))
    if not snaps:
        return None
    text = snaps[-1].read_text()
    through = snaps[-1].name[:10]
    num = lambda x: int(x.replace(',', '')) if re.fullmatch(r'[\d,]+', x) else None
    summary = []
    for label, pat in [('Total ballots cast', r'Total Ballots Cast\s+([\d,]+)'), ('Mail ballots returned', r'Total Returned Absentee Ballots\s+([\d,]+)'),
                       ('Share of mail ballots returned', r'% Total Returned\s+(\d+%)'), ('Returned by mail', r'% Returned by Mail\s+(\d+%)'),
                       ('Returned by drop box', r'% Returned by Drop Box\s+(\d+%)'), ('Mail applicants who voted in person instead', r'voting Early In Person instead\s+([\d,]+)'),
                       ('Early voters who had requested a mail ballot', r'% Early voters who requested an AB\s+(\d+%)'),
                       ('Voting by mail', r'% Voting Absentee by Mail\s+(\d+%)'), ('Voting early in person', r'% Voting Early In Person\s+(\d+%)')]:
        m = re.search(pat, text)
        if m:
            summary.append([label, m.group(1)])
    tables = []
    for tid, title, phrase, cols, keep in FX_TABLES:
        m0 = re.search(r'^\s*' + re.escape(phrase) + r'\s*$', text, re.M)  # the table's own title line
        if not m0:
            continue
        i = m0.start()
        nxt = min([j for j in (text.find('Page ', i),) if j > 0] or [len(text)])
        body = text[i:nxt]
        rows, total = [], None
        for line in body.splitlines():
            m = re.match(r'\s*(\d{1,2})-(Sep|Oct|Nov)\s+(.*)$', line)
            t = re.match(r'\s*Total\s+(.*)$', line)
            vals = None
            if m:
                d = dt.date(2026, FX_MON[m.group(2)], int(m.group(1))).isoformat()
                if d > through:
                    continue
                vals = [num(x) for x in m.group(3).split()]
            elif t and total is None:
                vals = [num(x) for x in t.group(1).split()]
            if not vals or all(v is None for v in vals):
                continue
            vals = [v if v is not None else 0 for v in vals]
            vals = [vals[k] if k < len(vals) else 0 for k in keep]
            if m:
                rows.append([d] + vals)
            else:
                total = vals
        if rows:
            tables.append({'id': tid, 'title': title, 'cols': cols, 'rows': rows, 'total': total})
    return {'through': through, 'summary': summary, 'tables': tables} if tables else None


def monotonic(hist):
    """Display-only: running totals never go down. A missing day or a dip (a bad report, or a
    later downward correction) carries the previous high; the saved data is untouched."""
    out, hi = [], {}
    for h in sorted(hist, key=lambda h: h['date']):
        h = dict(h)
        for key in ('early', 'mail'):
            v = h.get(key)
            hi[key] = max(hi.get(key, 0), v or 0)
            if v is not None or hi[key]:
                h[key] = hi[key]
        if h.get('total') is not None:
            hi['total'] = max(hi.get('total', 0), h['total'], (h.get('early') or 0) + (h.get('mail') or 0))
            h['total'] = hi['total']
        out.append(h)
    return out


def activity_dated(hist):
    """Display-only: the DAL files saved before 2026 stamp each row with the morning it was
    published, so a row dated Tuesday holds Monday's ballots. Move each row back to the day the
    voting happened (keep the latest row per day). 2026 rows already carry activityDate."""
    by = {}
    for h in sorted(hist, key=lambda h: h.get('timestamp') or h['date']):
        h = dict(h)
        ts = h.get('timestamp') or ''
        if 'activityDate' in h:
            h['date'] = h['activityDate']
        elif ts[:10] == h['date'] and ts[11:13] < '12':
            h['date'] = (date(h['date']) - dt.timedelta(days=1)).isoformat()
        by[h['date']] = h
    return [by[k] for k in sorted(by)]


for _eid, _e in D['elections'].items():
    for _l in _e['localities']:
        _history = activity_dated(_l['history'])
        # Current source observations, including county-to-DAL transitions and
        # downward corrections, must reach the page bundles unchanged.
        _l['history'] = _history if _eid == '2026' else monotonic(_history)
for _lid in ARCH:
    for _eid in ARCH[_lid]:
        if isinstance(ARCH[_lid][_eid], dict) and 'history' in ARCH[_lid][_eid]:
            ARCH[_lid][_eid]['history'] = monotonic(ARCH[_lid][_eid]['history'])
EL = D['elections']
LIVE = '2026'
ORDER = ['2026', '2026-special', '2025', '2024', '2023', '2022', '2021', '2020']
ARCH_META = {'2020': ('2020-11-03', 'Presidential'), '2021': ('2021-11-02', 'State / local'), '2022': ('2022-11-08', 'Midterm')}
# Locality dashboards (siteReports): site key -> (site name on the page, short label).
# The registrar's office is the page's placeholder main-office row.
SITE_REPORT_NAMES = {
    'arlington-county': {'courthouse': ("Registrar's office", 'Courthouse'), 'langston_brown': ('Langston-Brown Community Center', 'Langston-Brown'),
                         'walter_reed': ('Walter Reed Community Center', 'Walter Reed')},
    'loudoun-county': {'leesburg': ("Registrar's office", 'Leesburg office'), 'sterling': ('Claude Moore Recreation Center', 'Claude Moore'),
                       'dulles_south': ('Dulles South Recreation Center', 'Dulles South'), 'purcellville': ('Carver Senior Center', 'Carver Center'),
                       'ashburn': ('Ashburn Recreation and Community Center', 'Ashburn')},
    'alexandria-city': {'alexandria_office': ("Registrar's office", 'Main office'), 'beatley': ('Charles E. Beatley Jr Central Library', 'Beatley Library')},
}
SITE_REPORT_SOURCES = {'arlington-county': 'Arlington County’s dashboard', 'loudoun-county': 'Loudoun County’s dashboard', 'alexandria-city': 'the City of Alexandria’s dashboard'}

# Map positions for sites the geocoded site list does not cover yet (approximate; flagged in the UI).
APPROX_SITES = {'richmond-city': {"Registrar's office": (37.5935, -77.4741), 'Richmond City Hall': (37.5407, -77.4336),
                                  'Hickory Hill Community Center': (37.4987, -77.4573)}}


def fx_series(hist, edate):
    """Fairfax's own daily report as running totals by series index (0 = E-46 ... 52 = E+6):
    in person (e), returned by mail (p), returned by drop box (b), ballots sent (s). Days the
    report skips carry the previous total; days before the first row stay null."""
    E = date(edate)
    by = {}
    for h in hist:
        c = h.get('cumulative') or {}
        if all(c.get(k) is not None for k in ('early', 'postal', 'dropbox')):
            by[46 - (E - date(h['date'])).days] = c
    if not by:
        return None
    first, last = min(by), max(by)
    out = {k: [] for k in 'epbs'}
    cur = None
    for i in range(53):
        cur = by.get(i, cur)
        ok = cur is not None and first <= i <= last
        for k, src in (('e', 'early'), ('p', 'postal'), ('b', 'dropbox'), ('s', 'sent')):
            out[k].append(cur.get(src) if ok else None)
    return out


def fx_site_days(hist, edate):
    """Fairfax's in-person ballots per site per day, by series index (None when the site was
    closed or not reported). Only sites that took ballots that election are kept."""
    E = date(edate)
    out = {}
    for h in hist:
        i = 46 - (E - date(h['date'])).days
        if not 0 <= i < 53:
            continue
        for key, v in (h.get('sites') or {}).items():
            if v is not None:
                out.setdefault(key, [None] * 53)[i] = v
    return {k: v for k, v in out.items() if any(v)}


def fx_extras(x):
    x = x or {}
    return {'switched': x.get('switchedTotal'), 'undeliverable': x.get('undeliverable')}


def tot(h):
    return h.get('total') or ((h.get('early') or 0) + (h.get('mail') or 0))


def election_meta(eid):
    e = EL.get(eid, {})
    if eid in ARCH_META:
        return {'date': ARCH_META[eid][0], 'label': 'November ' + eid, 'type': ARCH_META[eid][1]}
    return {'date': e['electionDate'], 'label': e['label'], 'type': e['type']}


def loc_hist(eid, lid):
    e = EL.get(eid)
    if e:
        for l in e['localities']:
            if l['id'] == lid:
                return l
    if eid in ARCH_META and lid in ARCH and eid in ARCH[lid]:
        return ARCH[lid][eid]
    return None


def points(hist, E):
    pts = {}
    for h in hist:
        k = (E - date(h['date'])).days
        if -6 <= k <= 46:
            pts[k] = (h.get('early') or 0, h.get('mail') or 0, h.get('outstanding'))
    return pts


def series(hist, edate, registered):
    """Cumulative early/mail by index 0..52 (index 0 = E-46, 46 = Election Day, 52 = E+6)."""
    pts = points(hist, date(edate))
    if not pts:
        return None
    first, last = max(pts), min(pts)
    e_, m_ = [], []
    ce = cm = 0
    for k in range(46, -7, -1):
        if k in pts:
            ce = pts[k][0]; cm = pts[k][1]
        if k > first or k < last:
            e_.append(None); m_.append(None)
        else:
            e_.append(ce); m_.append(cm)
    return {'e': e_, 'm': m_, 'r': registered}


def statewide(eid):
    """Statewide series plus daily rows (each locality forward-filled, then summed)."""
    meta = election_meta(eid)
    E = date(meta['date'])
    allpts, reg, active = [], 0, 0
    daily_by_points = []
    for lid in NAMES:
        l = loc_hist(eid, lid)
        if not l:
            continue
        reg += l['registered']; active += l.get('active') or 0
        p = points(l['history'], E)
        if p:
            allpts.append(p)
            daily_by_points.append({(E - date(h['date'])).days: h.get('daily', {}) for h in l['history']})
    glast = min(min(p) for p in allpts)
    agg = {}
    for p, source_daily in zip(allpts, daily_by_points):
        ce = cm = 0; co = None
        for k in range(46, -7, -1):
            prior_e, prior_m = ce, cm
            if k in p:
                ce = p[k][0]; cm = p[k][1]; co = p[k][2] if p[k][2] is not None else co
            if k < glast or k > max(p):
                continue
            a = agg.setdefault(k, [0, 0, 0, 0, 0])
            a[0] += ce; a[1] += cm; a[2] += co or 0
            daily = source_daily.get(k, {})
            a[3] += daily.get('early') if daily.get('early') is not None else ce - prior_e
            a[4] += daily.get('mail') if daily.get('mail') is not None else cm - prior_m
    e_ = [agg[k][0] if k in agg else None for k in range(46, -7, -1)]
    m_ = [agg[k][1] if k in agg else None for k in range(46, -7, -1)]
    rows, prev = [], None
    for k in range(46, -7, -1):
        if k not in agg:
            continue
        a = agg[k]
        d = (E - dt.timedelta(days=k)).isoformat()
        rows.append({'d': d, 'e': a[0], 'm': a[1], 'de': a[3] if eid == LIVE else max(0, a[3]), 'dm': a[4] if eid == LIVE else max(0, a[4]), 'o': a[2] or None})
        prev = a
    return {'e': e_, 'm': m_, 'r': reg}, rows, reg, active


def at_days_before(hist, E, k):
    """Cumulative total on the last report at least k days before Election Day."""
    found = None
    for h in sorted(hist, key=lambda h: h['date']):
        if (E - date(h['date'])).days >= k:
            found = tot(h)
    return found


# ---------------- schedules ----------------
MONTHS = {'Sept': 9, 'Sep': 9, 'Oct': 10, 'Nov': 11}


def parse_time(s):
    s = s.strip().lower().replace('noon', '12 p.m.')
    m = re.match(r'(\d{1,2})(?::(\d\d))?\s*([ap])\.m\.', s)
    if not m:
        return None
    h = int(m.group(1)) % 12 + (12 if m.group(3) == 'p' else 0)
    return h + int(m.group(2) or 0) / 60


def fmt_t(x):
    h = int(x); m = round((x - h) * 60)
    ap = 'AM' if h < 12 else 'PM'
    h12 = h % 12 or 12
    return f'{h12}:{m:02d} {ap}' if m else f'{h12} {ap}'


def fmt_span(t):
    return fmt_t(t[0]) + ' – ' + fmt_t(t[1]) if t else ''


WEEKDAYS = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6}


def weekdays_in(head):
    """'Monday-Thursday', 'Tuesday/Thursday', 'Monday, Wednesday, Friday', 'Sunday' -> weekday numbers."""
    out = set()
    for part in re.split(r',|/|\band\b', head.lower()):
        names = re.findall(r'(monday|tuesday|wednesday|thursday|friday|saturday|sunday)', part)
        if '-' in part and len(names) == 2:
            out.update(range(WEEKDAYS[names[0]], WEEKDAYS[names[1]] + 1))
        else:
            out.update(WEEKDAYS[n] for n in names)
    return out


def parse_rules(rules):
    """Weekly hours by weekday, hours on listed dates, and closed dates for one site."""
    wk = {}; explicit = {}; closed = set()
    for r in rules:
        span = None
        mt = re.search(r':\s*(.+?)\s+to\s+(.+?)(?:\s*\(|$)', r)
        if mt:
            a, b = parse_time(mt.group(1)), parse_time(mt.group(2))
            if a is not None and b is not None:
                span = (a, b)
        for cm in re.finditer(r'(?:CLOSED|Excluding)\s+(Sept|Sep|Oct|Nov)\.?\s*(\d+)', r, re.I):
            closed.add(dt.date(2026, MONTHS[cm.group(1)], int(cm.group(2))))
        # "Monday-Friday (CLOSED Oct. 12)" and "Saturday (Excluding Oct. 17)" are weekly rules.
        head = re.sub(r'\((?:CLOSED|Excluding)[^)]*\)', '', r.split(':')[0], flags=re.I)
        dates = list(re.finditer(r'(Sept|Sep|Oct|Nov)\.?\s*(\d+)(?:\s*-\s*(\d+))?', head))
        if not dates:
            for wd in weekdays_in(head):
                wk[wd] = span
            continue
        if span is None:  # e.g. "Oct. 1 and Oct. 15: open until 6:30 p.m." keeps the weekly hours
            continue
        for dm in dates:
            mo = MONTHS[dm.group(1)]; a = int(dm.group(2)); b = int(dm.group(3) or a)
            for dd in range(a, b + 1):
                explicit[dt.date(2026, mo, dd)] = span
    return wk, explicit, closed


DOW3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
MON3 = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def dlabel(d):
    return f'{DOW3[d.weekday()]} {MON3[d.month]} {d.day}'


def site_schedule(lid, start, end):
    sat = D.get('satellites', {}).get(LIVE, {}).get(lid)
    days, sites = {}, []
    listed = list(sat['sites']) if sat else []
    if lid in OFFICE_SCHEDULES and not any(not s['satellite'] for s in listed):
        listed.insert(0, dict(OFFICE_SCHEDULES[lid], satellite=False))
    if not listed:
        return days, sites
    # Weekly hours stop with in-person early voting on the Saturday before Election Day.
    last_day = date(election_meta(LIVE)['date']) - dt.timedelta(days=3)
    for s in listed:
        wk, ex, closed = parse_rules(s['rules'])
        first = date(s['firstOpen'])
        pretty = []
        weekly = {}
        for wd, span in sorted(wk.items()):
            if span:
                weekly.setdefault(span, []).append(wd)
        for span, wds in weekly.items():
            names = 'Weekdays (Mon–Fri)' if wds == [0, 1, 2, 3, 4] else ', '.join(DOW3[x] for x in wds)
            pretty.append(f'{names} from {dlabel(first)}: {fmt_span(span)}')
        for d0 in sorted(ex):
            if ex[d0]:
                pretty.append(f'{dlabel(d0)}: {fmt_span(ex[d0])}')
        for d0 in sorted(closed):
            pretty.append(f'Closed {dlabel(d0)}')
        sites.append({'name': s['name'], 'address': s['address'], 'firstOpen': s['firstOpen'], 'satellite': s['satellite'], 'rules': pretty or s['rules'],
                      **({'url': s['source']} if s.get('source') else {})})
        d0 = start
        while d0 <= end:
            span = None
            if d0 >= first and d0 not in closed:
                if d0 in ex:
                    span = ex[d0]
                elif d0 <= last_day:
                    span = wk.get(d0.weekday())
            if span:
                x = days.setdefault(d0.isoformat(), {'n': 0, 'h': 0, 'open': []})
                x['n'] += 1; x['h'] += round(span[1] - span[0], 2); x['open'].append([s['name'], fmt_span(span), round(span[1] - span[0], 2)])
            d0 += dt.timedelta(days=1)
    return days, sites


def sat_summary(lid, today):
    sat = D.get('satellites', {}).get(LIVE, {}).get(lid)
    if not sat:
        return 0, None
    sats = [s for s in sat['sites'] if s['satellite']]
    upcoming = sorted(s['firstOpen'] for s in sats if date(s['firstOpen']) > today)
    return len(sats), (upcoming[0] if upcoming else ('open' if sats else None))


# ---------------- geometry ----------------
def rings(g):
    if g['type'] == 'Polygon':
        return [g['coordinates'][0]]
    return [p[0] for p in g['coordinates']]


def projector(features, W=1000):
    lons, lats = [], []
    for f in features:
        for r in rings(f['geometry']):
            for x, y in r:
                lons.append(x); lats.append(y)
    k = math.cos(math.radians((min(lats) + max(lats)) / 2))
    x0, x1, y0, y1 = min(lons), max(lons), min(lats), max(lats)
    s = W / ((x1 - x0) * k)
    return (lambda x, y: ((x - x0) * k * s, (y1 - y) * s)), round((y1 - y0) * s)


def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


def path_of(f, P, tol, drop_small=False):
    rs = [[P(*c) for c in r] for r in rings(f['geometry'])]
    big = max(area(r) for r in rs) if rs else 0
    parts = []
    for pts in rs:
        if drop_small and area(pts) < big * 0.02 and area(pts) < 4:
            continue
        kept = [pts[0]]
        for p in pts[1:]:
            if math.dist(p, kept[-1]) >= tol:
                kept.append(p)
        if len(kept) < 3:
            kept = pts[::max(1, len(pts) // 4)]
        parts.append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in kept) + 'Z')
    return ''.join(parts)


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / 'loc').mkdir(exist_ok=True)
    e26 = EL[LIVE]
    as_of = max(h['date'] for l in e26['localities'] for h in l['history'])
    today = date(as_of)
    # "Today" as days before the live Election Day (series index = 46 - days before)
    tdb = max(-6, min(46, (date(election_meta(LIVE)['date']) - today).days))

    regional = json.loads((ROOT / 'regional.geojson').read_text())
    VP, vh = projector(regional['features'])
    va_paths = {f['properties']['id']: path_of(f, VP, 1.6, drop_small=True) for f in regional['features']}
    # Shared state outline for the locality pages' "where is it" map.
    (OUT / 'va-map.json').write_text(json.dumps({'h': vh, 'p': va_paths}, separators=(',', ':')))

    hist, rows_by, regs = {}, {}, {}
    for eid in ORDER:
        meta = election_meta(eid)
        sr, rows, reg, active = statewide(eid)
        hist[eid] = {'label': meta['label'], 'type': meta['type'], **sr}
        rows_by[eid] = rows; regs[eid] = (reg, active)

    sat_open = {}
    for lid, s in D.get('satellites', {}).get(LIVE, {}).items():
        for site in s['sites']:
            if site['satellite']:
                x = sat_open.setdefault(site['firstOpen'], {'n': 0, 'locs': {}})
                x['n'] += 1; x['locs'][NAMES[lid]['name']] = x['locs'].get(NAMES[lid]['name'], 0) + 1

    # ---- statewide bundles, one per election
    for eid in ORDER:
        meta = election_meta(eid)
        E = date(meta['date'])
        live = eid == LIVE
        locs = []
        for lid, nm in NAMES.items():
            l = loc_hist(eid, lid)
            if not l:
                continue
            h = l['history'][-1]
            c = None
            if live:
                k_last = (E - date(h['date'])).days
                prev = loc_hist('2025', lid)
                if prev:
                    pv = at_days_before(prev['history'], date(election_meta('2025')['date']), k_last)
                    c = round(tot(h) / pv * 100) if pv else None
            n, nxt = sat_summary(lid, today) if live else (0, None)
            v = tot(h)
            locs.append({'id': lid, 'n': nm['name'], 'rg': nm['region'], 'r': l['registered'], 'ac': l.get('active'),
                         'v': v, 'e': h.get('early') or 0, 'm': h.get('mail') or 0, 'o': h.get('outstanding'),
                         'p': round(v / l['registered'] * 100, 2), 'c': c, 'sat': n, 'next': nxt, 'd': va_paths.get(lid, '')})
        rows = rows_by[eid]
        reg, active = regs[eid]
        bundle = {'eid': eid, 'label': meta['label'], 'type': meta['type'], 'date': meta['date'], 'live': live,
                  'asOf': rows[-1]['d'] if rows else meta['date'], 'reg': reg, 'active': active or None,
                  'locs': locs, 'rows': rows, 'satOpen': sat_open if live else {}, 'hist': hist, 'mapH': vh,
                  'elections': [{'id': x, 'label': election_meta(x)['label'], 'type': election_meta(x)['type']} for x in ORDER]}
        (OUT / f'home-{eid}.json').write_text(json.dumps(bundle, separators=(',', ':')))

    # ---- locality bundles
    start, end = dt.date(2026, 9, 18), dt.date(2026, 11, 2)
    by_total = sorted(e26['localities'], key=lambda x: -tot(x['history'][-1]))
    by_pct = sorted(e26['localities'], key=lambda x: -tot(x['history'][-1]) / x['registered'])
    by_reg = sorted(e26['localities'], key=lambda x: -x['registered'])
    official = {x['date']: x for x in D.get('official', {}).get(LIVE, {}).get('history', [])}
    # Turnout rank now and a week earlier, for the trend notes.
    s26 = {l['id']: series(l['history'], election_meta(LIVE)['date'], l['registered']) for l in e26['localities']}
    li26 = max(i for x in s26.values() if x for i, v in enumerate(x['e']) if v is not None)
    def rank_at(i):
        vals = sorted(((((x['e'][i] or 0) + (x['m'][i] or 0)) / x['r'] if x and x['e'][i] is not None else 0, lid) for lid, x in s26.items()), reverse=True)
        return {lid: n + 1 for n, (_, lid) in enumerate(vals)}
    rank_now, rank_wk = rank_at(li26), rank_at(li26 - 7)
    # Turnout and size rank for every election, so the locality page's rank chips follow the
    # election being viewed.
    ranks = {}
    for eid in ORDER:
        rows_e = [(lid, loc_hist(eid, lid)) for lid in NAMES]
        rows_e = [(lid, h) for lid, h in rows_e if h and h.get('history') and h.get('registered')]
        by_p = sorted(rows_e, key=lambda x: -tot(x[1]['history'][-1]) / x[1]['registered'])
        by_r = sorted(rows_e, key=lambda x: -x[1]['registered'])
        ranks[eid] = {lid: {'rankP': n + 1} for n, (lid, _) in enumerate(by_p)}
        for n, (lid, _) in enumerate(by_r):
            ranks[eid][lid]['rankR'] = n + 1
    geocoded = {x['name'].lower(): (x['lat'], x['lon']) for x in D.get('sites', [])}
    for l in e26['localities']:
        lid = l['id']
        # Same-night dashboard totals (provisional.py) extend this page past DAL's last day.
        # DAL wins: only dates after its last row are added, and fields the dashboard
        # doesn't report carry forward from DAL.
        l_dal = l
        prov = {d: x for d, x in D.get('provisional', {}).get(lid, {}).items() if d > l['history'][-1]['date']}
        if prov:
            l = dict(l, history=list(l['history']))
            for d, x in sorted(prov.items()):
                last = l['history'][-1]
                h = {k: last.get(k) for k in ('early', 'mail', 'outstanding', 'provisional', 'fwab')}
                h.update({k: x[k] for k in ('early', 'mail') if k in x})
                h.update({'date': d, 'activityDate': d, 'total': h['early'] + h['mail'], 'source': x['source'], 'carried': [k for k in ('mail',) if k not in x]})
                l['history'].append(h)
        days_sched, sites = site_schedule(lid, start, end)
        # Every registrar's office offers early voting from day one. When the schedule source
        # doesn't list it, show it without address or hours (those come from the registrar).
        if lid == 'fairfax-county':  # the county's main early-voting site goes by its building name
            for s0 in sites:
                if not s0['satellite'] and s0['name'].lower().startswith('registrar'):
                    old_name, s0['name'] = s0['name'], 'Fairfax County Government Center'
                    for day in days_sched.values():
                        for o in day['open']:
                            if o[0] == old_name:
                                o[0] = s0['name']
        office_known = any(not s['satellite'] for s in sites)
        if not office_known:
            # Address and regular hours from the state's registrar listing; its extended and weekend
            # early-voting hours aren't listed, so the office stays out of the day-by-day schedule.
            ol = OFFICE_LISTINGS.get(lid, {})
            hrs = ['%s: %s' % (d0, fmt_span([int(a[:2]) + int(a[3:]) / 60, int(b[:2]) + int(b[3:]) / 60])) for d0, (a, b) in ol.get('hours', {}).items()]
            if hrs and len(set(x.split(': ')[1] for x in hrs)) == 1 and list(ol['hours']) == ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']:
                hrs = ['Weekdays (Mon–Fri): ' + hrs[0].split(': ')[1]]
            sites.insert(0, {'name': "Registrar's office", 'address': ol.get('address', ''), 'firstOpen': start.isoformat(), 'satellite': False,
                             'rules': [x + ' (regular office hours)' for x in hrs] + (['Extended and weekend early-voting hours: check with the registrar'] if hrs else []),
                             'placeholder': True, 'url': NAMES[lid].get('officeSource')})
        sites.sort(key=lambda s0: s0['satellite'])  # the office leads
        rows, prev = [], None
        for h in l['history']:
            if h['date'] < '2026-09-18':
                prev = h; continue
            w = W26.get(f'{lid}-2026-general', {}).get(h['date'])
            r = {'d': h['date'], 'e': h['early'], 'm': h['mail'], 'de': h['early'] - (prev['early'] if prev else 0),
                 'dm': h['mail'] - (prev['mail'] if prev else 0), 'o': h.get('outstanding'), 'pv': h.get('provisional') or 0,
                 'w': {'l': w['label'], 'hi': round(w['tempMax']), 'lo': round(w['tempMin']), 'p': round(w.get('precip') or 0, 2), 'wet': bool(w.get('wet'))} if w else None}
            if lid == 'fairfax-county':
                de, dm = h.get('daily', {}).get('early'), h.get('daily', {}).get('mail')
                if de is not None: r['de'] = de
                if dm is not None: r['dm'] = dm
            if lid == 'fairfax-county' and h['date'] in official:
                x = official[h['date']]
                r['site'] = {k: v for k, v in x['sites'].items() if v}
                r['post'] = x.get('postal'); r['box'] = x.get('dropbox')
            # Backup totals from the same Daily Absentee List records need no same-night footnote.
            if h.get('source') and h['source'] != 'Daily Absentee List':
                r['prov'] = h['source']
                if 'mail' in h.get('carried', []):
                    r['dm'] = None
            rows.append(r); prev = h
        site_meta = {}
        report = D.get('siteReports', {}).get(lid, {}).get(LIVE) if lid in SITE_REPORT_NAMES else None
        if report and report.get('history'):
            by_day = {x['date']: x['sites'] for x in report['history']}
            for r in rows:
                if r['d'] in by_day:
                    r['site'] = {k: v for k, v in by_day[r['d']].items() if v}
            office = sites[0]['name'] if not sites[0]['satellite'] else "Registrar's office"
            names = {k: (office if v[0] == "Registrar's office" else v[0], v[1]) for k, v in SITE_REPORT_NAMES[lid].items()}
            okey = next(k for k, v in SITE_REPORT_NAMES[lid].items() if v[0] == "Registrar's office")
            # Before the first satellite opened, the office was the only site: its count is the day's in-person total.
            first_sat = min((s0['firstOpen'] for s0 in sites if s0['satellite']), default='9999-12-31')
            office_only = None
            for r in rows:
                if 'site' not in r and r['d'] < first_sat and r['de'] > 0:
                    r['site'] = {okey: r['de']}; office_only = r['d']
            # Loudoun's feed shows only the latest day, so days nobody captured have no counts, unless
            # the office-only days fill every gap.
            partial = report.get('coverage') == 'partial' and any('site' not in r for r in rows if r['de'] > 0)
            # A partial (latest-day-only) feed can be a day ahead of DAL; show that day's site counts anyway.
            through = max([max(by_day)] * (report.get('coverage') == 'partial') + [r['d'] for r in rows if 'site' in r], default=None)
            site_meta = {'siteKeys': {v[0]: k for k, v in names.items()}, 'siteLabels': {k: v[1] for k, v in names.items()},
                         'sitePartial': partial, 'siteSource': SITE_REPORT_SOURCES[lid], 'siteThrough': through, 'siteOfficeOnly': office_only,
                         'siteLatest': {k: v for k, v in by_day[through].items() if v} if partial else None}
        pm = json.loads((ROOT / MANIFEST[lid]['file']).read_text())
        P, ph = projector(pm['features'])
        tol = 2.2 if len(pm['features']) > 150 else 1.6
        pp = {f['properties']['code']: path_of(f, P, tol) for f in pm['features']}
        precincts, pdates = [], []
        pfile = ROOT / 'precinct-data' / f'2026-{lid}.json'
        if pfile.exists():
            pd = json.loads(pfile.read_text())
            pdates = [x for x in pd['dates'] if x >= '2026-09-18'] or pd['dates'][-1:]
            for code, p in pd['precincts'].items():
                if code in pp:
                    precincts.append({'c': code, 'n': nice(p['name'].title()), 'd': pp[code],
                                      'h': [p['history'].get(x, [0, 0, 0])[:2] for x in pdates], 'r': p['history'].get(pdates[-1], [0, 0, 0])[2]})
        if not precincts:
            precincts = [{'c': c, 'n': c, 'd': d, 'h': [[0, 0]], 'r': 0} for c, d in pp.items()]
            pdates = pdates or [as_of]
        approx = APPROX_SITES.get(lid, {})
        for st in sites:
            ll, flag = None, False
            low = st['name'].lower()
            if lid == 'fairfax-county':
                word = 'government center' if low.startswith('registrar') else low.split()[0].replace('center', 'centre')
                for kname, v in geocoded.items():
                    if kname.startswith(word) or (word == 'government center' and 'fairfax county government center' in kname):
                        ll = v; break
            elif st['name'] in approx:
                ll, flag = approx[st['name']], True
            if ll:
                x, y = P(ll[1], ll[0]); st['xy'] = [round(x, 1), round(y, 1)]; st['approx'] = flag
        elections = []
        for eid in ORDER:
            lh = l if eid == LIVE else loc_hist(eid, lid)
            if not lh:
                continue
            meta = election_meta(eid)
            last = lh['history'][-1]
            elections.append({'id': eid, 'label': meta['label'], 'type': meta['type'], 'date': meta['date'],
                              'reg': lh['registered'], 'early': last.get('early') or 0, 'mail': last.get('mail') or 0,
                              'total': tot(last), 'out': last.get('outstanding'), 'through': last['date'],
                              'atT': at_days_before(lh['history'], date(meta['date']), tdb),
                              'final': eid != LIVE, 'series': series(lh['history'], meta['date'], lh['registered']), **ranks.get(eid, {}).get(lid, {})})
        fx_mail = None
        if lid == 'fairfax-county':
            fx_mail = {}
            for y in ['2020', '2021', '2022', '2023', '2024', '2025', '2026-special', '2026']:
                hh = D.get('official', {}).get(y, {}).get('history')
                if hh:
                    c = hh[-1].get('cumulative') or {}
                    fx_mail[y] = {'through': hh[-1]['date'], 'sent': c.get('sent'), 'post': c.get('postal'), 'box': c.get('dropbox'), 'early': c.get('early'),
                                  'ser': fx_series(hh, election_meta(y)['date']), 'extras': fx_extras(D['official'][y].get('extras')),
                                  'sites': fx_site_days(hh, election_meta(y)['date'])}
        n, nxt = sat_summary(lid, today)
        sat_dates = [date(x['firstOpen']) for x in D.get('satellites', {}).get(LIVE, {}).get(lid, {}).get('sites', []) if x['satellite']]
        ref25 = next((x['series'] for x in elections if x['id'] == '2025'), None)
        # Trend notes compare against statewide DAL, so they use DAL days only.
        cur26 = series(l_dal['history'], election_meta(LIVE)['date'], l_dal['registered'])
        notes = trend_notes(l['name'], date(election_meta(LIVE)['date']), cur26, ref25, hist[LIVE], hist['2025'], date(l_dal['history'][-1]['date']),
                            sat_dates, rank_now.get(lid), rank_wk.get(lid)) if cur26 else ''
        b = {'id': lid, 'name': l['name'], 'asOf': l['history'][-1]['date'], 'tIdx': 46 - tdb, 'region': NAMES[lid]['region'], 'reg': l['registered'], 'active': l.get('active'),
             'inactive': l.get('inactive'), 'rankV': by_total.index(l_dal) + 1, 'rankP': by_pct.index(l_dal) + 1, 'rankR': by_reg.index(l_dal) + 1,
             'state26': {'e': hist[LIVE]['e'], 'm': hist[LIVE]['m'], 'r': hist[LIVE]['r']},
             'rows': rows, 'sched': days_sched, 'officeKnown': office_known, 'sites': sites, 'sat': n, 'next': nxt, 'elections': elections, 'fxMail': fx_mail,
             'trend': notes, 'fxReport': fairfax_report() if lid == 'fairfax-county' else None, 'names': ALL_NAMES, 'mapH': ph, 'pdates': pdates, 'precincts': precincts, 'boundary': MANIFEST[lid].get('vintage'), **site_meta}
        (OUT / 'loc' / f'{lid}.json').write_text(json.dumps(b, separators=(',', ':')))
    # URL map for the router: /va/<locality>/<election>, /va/statewide/<election>.
    # Year-month (2026-11) in URLs; the full date only when two elections share a month.
    months = [election_meta(x)['date'][:7] for x in ORDER]
    slug = lambda d: d if months.count(d[:7]) > 1 else d[:7]
    site = {'live': LIVE, 'elections': [{'id': x, 'slug': slug(election_meta(x)['date']), 'label': election_meta(x)['label']} for x in ORDER],
            'localities': sorted(NAMES)}
    (OUT / 'site.js').write_text('VF.site=' + json.dumps(site, separators=(',', ':')) + ';\n')
    print(f'Built {len(ORDER)} statewide bundles and {len(e26["localities"])} locality bundles in {OUT}')


if __name__ == '__main__':
    main()
