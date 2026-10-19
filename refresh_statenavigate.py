"""Fill current precinct early/mail counts from a State Navigate tracker capture.

Run: python refresh_statenavigate.py [--file sources/precinct-snapshots/<date>/<HHMM>-current.json.gz]
(default: the file named in sources/precinct-snapshots/latest.json, written by
capture_statenavigate.cjs).

The state's precinct metric files stopped updating after September 23. The
tracker is compiled from the same Daily Absentee List records and carries
current counts for every precinct. Its precincts join to ours by precinct code
within each locality. The activity date is never taken from its labels: a
locality is imported only when its county totals match one day of our DAL
history (dist/region.json), and the precinct counts are filed under that day.
Existing precinct days (DAL through September 23, Arlington's own dashboard)
are never overwritten.

Backup for late DAL files: when the tracker's county totals are a day ahead of
our DAL history, they go into region.json `provisional` (provisional.py) under
the Daily Absentee List label, so the page shows them until the DAL file for
that day arrives and replaces them. Its activity date is the tracker's latest
source date minus one day (its file dates are report dates). An existing
provisional day from a county dashboard is kept. Prints one JSON line.
"""
import argparse, gzip, json, re, hashlib
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from source_attribution import DAL_LABEL, preserve_provenance
from status_log import record
import provisional

ROOT = Path(__file__).resolve().parent
LATEST = ROOT / 'sources/precinct-snapshots/latest.json'
PAGE = 'https://projects.statenavigate.com/interactives/va/early-vote-2026/'

def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

def precinct_code(name):
    m = re.match(r'\s*(\d+)\s*-?\s*', name)
    return str(int(m[1])) if m else None

def tolerance(total):
    # Same records, rebuilt at slightly different moments: allow a few late corrections.
    return max(10, round(total * 0.003))

def match_day(history, early, mail):
    """The latest DAL day whose early and mail totals match the tracker's county totals.

    Totals repeat over weekends and closed days; the tracker is a current snapshot, so take the latest."""
    days = [v['date'] for v in history if abs(v['early'] - early) <= tolerance(early) and abs(v['mail'] - mail) <= tolerance(mail)]
    return max(days, default=None)

def activity_date(group):
    sd = group['source_dates']
    return (date.fromisoformat(max(sd['on_machine_date'] + sd['mail_in_date'])) - timedelta(days=1)).isoformat()

def backup(data, region):
    """Add tracker county totals that are ahead of DAL as provisional days. Returns {locality: date}."""
    groups = {slug(g['name']): g for g in data['current']['groups']['county'].values()}
    added = {}
    for l in region['elections']['2026']['localities']:
        g, last = groups.get(l['id']), l['history'][-1]
        if not g:
            continue
        day = activity_date(g)
        if day <= last['date'] or g['in_person'] < last['early'] or g['mail'] < last['mail']:
            continue
        existing = region.get('provisional', {}).get(l['id'], {}).get(day)
        if existing and existing.get('source') != DAL_LABEL:
            continue
        if provisional.record(l['id'], day, {'early': g['in_person'], 'mail': g['mail']}, DAL_LABEL, data['current']['observed_at'], region):
            added[l['id']] = day
    return added

def plan(data, region, read):
    """Return ({precinct file: new json}, report) without writing anything."""
    rows = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    extra = defaultdict(int)
    for r in data['precincts']:
        code = precinct_code(r['name'])
        if code is None:
            raise ValueError('Precinct without a code: ' + r['county_name'] + ' ' + r['name'])
        # Precincts split by a congressional line arrive as one row per part.
        e = rows[slug(r['county_name'])][code]
        e[0] += r['in_person']; e[1] += r['mail']
    groups = {slug(g['name']): g for g in data['current']['groups']['county'].values()}
    out, report = {}, {'imported': {}, 'skipped': {}, 'unmatchedBallots': {}}
    for l in region['elections']['2026']['localities']:
        lid = l['id']
        g, mine = groups.get(lid), rows.get(lid)
        if not g or not mine:
            report['skipped'][lid] = 'not in tracker'; continue
        if sum(v[0] for v in mine.values()) != g['in_person'] or sum(v[1] for v in mine.values()) != g['mail']:
            report['skipped'][lid] = 'precincts do not add up to county total'; continue
        backups = [{'date': d, **x} for d, x in region.get('provisional', {}).get(lid, {}).items() if x.get('source') == DAL_LABEL and d > l['history'][-1]['date']]
        day = match_day(l['history'] + backups, g['in_person'], g['mail'])
        if not day:
            last = l['history'][-1]
            report['skipped'][lid] = f"county total {g['in_person']}+{g['mail']} matches no DAL day (latest {last['date']}: {last['early']}+{last['mail']})"; continue
        path = ROOT / 'dist/precinct-data' / f'2026-{lid}.json'
        pd = json.loads(read(path))
        missing = set(pd['precincts']) - set(mine)
        if missing:
            report['skipped'][lid] = 'tracker lacks precincts ' + ', '.join(sorted(missing)); continue
        unmatched = sum(sum(v) for c, v in mine.items() if c not in pd['precincts'])
        if unmatched:
            report['unmatchedBallots'][lid] = unmatched
        if all(day in p['history'] for p in pd['precincts'].values()):
            continue
        for code, p in pd['precincts'].items():
            if day in p['history']:
                continue
            registered = next((v[2] for _, v in sorted(p['history'].items()) if v[2]), 0)
            p['history'][day] = [mine[code][0], mine[code][1], registered]
            p['history'] = dict(sorted(p['history'].items()))
        pd['dates'] = sorted({d for p in pd['precincts'].values() for d in p['history']})
        out[path] = json.dumps(pd, separators=(',', ':'))
        report['imported'][lid] = day
    return out, report

def main():
    a = argparse.ArgumentParser(); a.add_argument('--file', type=Path); args = a.parse_args()
    src = args.file or ROOT / json.loads(LATEST.read_text())['data']
    raw = src.read_bytes()
    if src.suffix == '.gz':
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    region_text = (ROOT / 'dist/region.json').read_text()
    region = json.loads(region_text)
    report_backup = backup(data, region)
    if report_backup:
        (ROOT / 'dist/region.json').write_text(json.dumps(region, separators=(',', ':')))
    out, report = plan(data, region, lambda p: p.read_text())
    changed = []
    for path, text in out.items():
        if text != path.read_text():
            path.write_text(text); changed.append(str(path.relative_to(ROOT)))
    days = sorted(set(report['imported'].values()))
    if report_backup:
        record(DAL_LABEL, f'Loaded backup locality totals for {len(report_backup)} localities ahead of the main daily file.', max(report_backup.values()))
    if changed or report_backup:
        preserve_provenance(ROOT, {'source': DAL_LABEL, 'url': PAGE, 'file': str(src.relative_to(ROOT)) if src.is_relative_to(ROOT) else str(src),
                                   'sha256': hashlib.sha256(raw).hexdigest(), 'observedAt': data['current'].get('observed_at')})
    if changed:
        record(DAL_LABEL, f'Updated precinct counts for {len(changed)} localities from Daily Absentee List records.', days[-1])
    print(json.dumps({'source': 'precinct counts', 'backupTotals': report_backup, 'changedFiles': changed, 'days': days, **report}))

if __name__ == '__main__':
    main()
