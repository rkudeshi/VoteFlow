"""Merge current Fairfax display history without modifying either saved source."""
from copy import deepcopy


def merged_history(dal, official):
    days = {}
    previous = None
    for saved in sorted(dal, key=lambda r: r['date']):
        row = deepcopy(saved)
        row['daily'] = {
            key: row.get(key) - previous[key] if previous and row.get(key) is not None and previous.get(key) is not None else None
            for key in ('early', 'mail')
        }
        days[row['date']] = row
        previous = saved
    for county in official.get('history', []):
        cumulative = county.get('cumulative') or {}
        row = days.setdefault(county['date'], {'date': county['date'], 'activityDate': county['date']})
        daily = row.setdefault('daily', {})
        # County cumulative values take precedence; absent daily cells still use DAL.
        if cumulative.get('early') is not None:
            row['early'] = cumulative['early']
            if county.get('early') is not None:
                daily['early'] = county['early']
        if all(cumulative.get(k) is not None for k in ('postal', 'dropbox')):
            row['mail'] = cumulative['postal'] + cumulative['dropbox']
            if all(county.get(k) is not None for k in ('postal', 'dropbox')):
                daily['mail'] = county['postal'] + county['dropbox']
        if county.get('sent') is not None and cumulative.get('sent') is not None:
            row['sent'] = cumulative['sent']
        if row.get('early') is not None and row.get('mail') is not None:
            row['total'] = row['early'] + row['mail']
    return [days[d] for d in sorted(days)]


def county_history(official, dal=()):
    """A final county report as the whole display history: the county's own activity dates and
    daily counts, with no DAL days mixed in (Ravi, Oct 2026: the county report supersedes DAL)."""
    rows = []
    for county in official.get('history', []):
        c = county.get('cumulative') or {}
        if any(c.get(k) is None for k in ('early', 'postal', 'dropbox')):
            continue
        daily = {'early': county.get('early') or 0, 'mail': (county.get('postal') or 0) + (county.get('dropbox') or 0)}
        rows.append({'date': county['date'], 'activityDate': county['date'], 'early': c['early'], 'mail': c['postal'] + c['dropbox'],
                     'total': c['early'] + c['postal'] + c['dropbox'], 'sent': c.get('sent'), 'daily': daily})
    # Unreturned ballots aren't in the county report; keep DAL's final count for them.
    if rows and dal:
        rows[-1]['outstanding'] = max(dal, key=lambda r: r['date']).get('outstanding')
    return rows
