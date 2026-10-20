"""Precinct ballots by vote method (Election Day, early in person, mail, provisional)
from Fairfax County's official precinct results reports.

Reads the saved PDFs in sources/election-results/fairfax-county/ and writes
dist/election-day/fairfax-county.json. Only the "Ballots Cast" statistics are
kept: no candidate or party totals. Every column must reconcile with the county
summary before anything is written.
"""
import json, re, subprocess, sys
from pathlib import Path

R = Path(__file__).resolve().parent
SRC = R / 'sources' / 'election-results' / 'fairfax-county'
OUT = R / 'dist' / 'election-day' / 'fairfax-county.json'

# Column order of the "Ballots Cast - Total" row after TOTAL, per report.
# ENM = mail counted election night, PEM = mail counted after election night.
ELECTIONS = [
    ('2026-04', '2026-04-21', 'April 2026 special', ['ev', 'ed', 'enm', 'prov', 'pem', 'hand']),
    ('2025-11', '2025-11-04', 'November 2025 general', ['ev', 'ed', 'enm', 'prov', 'pem', 'hand']),
    ('2024-11', '2024-11-05', 'November 2024 general', ['ev', 'ed', 'enm', 'pem', 'hand']),
    ('2023-11', '2023-11-07', 'November 2023 general', ['ev', 'enm', 'ed', 'pem', 'hand']),
]
# The county summary always lists provisional, even when precinct pages do not.
SUMMARY = {
    '2026-04': ['ev', 'ed', 'enm', 'prov', 'pem', 'hand'],
    '2025-11': ['ev', 'ed', 'enm', 'prov', 'pem', 'hand'],
    '2024-11': ['ev', 'ed', 'enm', 'prov', 'pem', 'hand'],
    '2023-11': ['ev', 'enm', 'ed', 'prov', 'pem', 'hand'],
}


def nums(line, label):
    return [int(x.replace(',', '')) for x in line[len(label):].split()]


def parse(text, cols, summary_cols):
    county, reg_total, cur = None, None, None
    precincts = {}
    for line in text.split('\n'):
        m = re.match(r'^\s*(\d{3}) - (.+?)\s*$', line)
        if m and len(m.group(2)) < 40:
            cur = m.group(1)
            precincts.setdefault(cur, {'n': m.group(2).strip()})
            continue
        if line.startswith('Registered Voters - Total'):
            v = nums(line, 'Registered Voters - Total')[0]
            if cur:
                precincts[cur].setdefault('r', v)
            elif reg_total is None:
                reg_total = v
        if line.startswith('Ballots Cast - Total'):
            v = nums(line, 'Ballots Cast - Total')
            if cur is None and county is None:
                if len(v) != len(summary_cols) + 1:
                    raise ValueError(f'county summary has {len(v)} values')
                county = dict(zip(['t'] + summary_cols, v))
            elif cur and 't' not in precincts[cur]:
                if len(v) != len(cols) + 1:
                    raise ValueError(f'precinct {cur} has {len(v)} values')
                precincts[cur].update(zip(['t'] + cols, v))
    return county, reg_total, precincts


def tidy(p):
    out = {'n': p['n'], 'r': p['r'], 't': p['t'], 'ed': p['ed'], 'ev': p['ev'],
           'mail': p['enm'] + p['pem'], 'prov': p.get('prov'), 'hand': p['hand']}
    if sum(out[k] or 0 for k in ('ed', 'ev', 'mail', 'prov', 'hand')) != out['t']:
        raise ValueError(f"precinct {p['n']} parts do not add to its total")
    return out


def nice(s):
    return re.sub(r"'S\b", "'s", (s or '').title())


def polling_places():
    path = SRC / 'polling-places.geojson'
    if not path.exists():
        return {}
    out = {}
    for f in json.loads(path.read_text())['features']:
        a = f['properties']
        place = {'name': nice(a['DESCRIPTION']), 'addr': ' '.join(x for x in (a['STREET_NUMBER'], nice(a['STREET_NAME']), nice(a['CITY'])) if x),
                 'xy': [round(c, 5) for c in f['geometry']['coordinates']]}
        for code in (a['PREC_IDENT'], a['PREC_IDENT2']):
            if code:
                out[f'{int(code):03d}'] = place
    return out


def main():
    elections = []
    for eid, date, label, cols in ELECTIONS:
        pdf = SRC / f'{date}.pdf'
        text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], check=True, capture_output=True, text=True).stdout
        county, reg_total, raw = parse(text, cols, SUMMARY[eid])
        precincts = {c: tidy(p) for c, p in raw.items()}
        # Precinct pages must add up to the county summary, column by column.
        for k in ['t', 'ev', 'ed', 'enm', 'pem', 'hand'] + (['prov'] if 'prov' in cols else []):
            s = sum(p[k] for p in raw.values())
            want = county[k] - (0 if 'prov' in cols or k != 't' else county['prov'])
            if s != want:
                raise ValueError(f'{eid} {k}: precincts {s} != county {want}')
        if sum(p['r'] for p in precincts.values()) != reg_total:
            raise ValueError(f'{eid}: registered voters do not reconcile')
        elections.append({'id': eid, 'date': date, 'label': label, 'registered': reg_total,
                          'county': {'t': county['t'], 'ed': county['ed'], 'ev': county['ev'], 'mail': county['enm'] + county['pem'],
                                     'prov': county['prov'], 'hand': county['hand']},
                          'provByPrecinct': 'prov' in cols, 'precincts': precincts})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'locality': 'fairfax-county', 'elections': elections, 'polling': polling_places()}, separators=(',', ':')) + '\n')
    for e in elections:
        print(e['id'], len(e['precincts']), 'precincts', e['county'])


if __name__ == '__main__':
    sys.exit(main())
