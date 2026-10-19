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



def drop_partial_files(history):
    """Rows from a partial DAL file: early and mail both fall, and the next row equals the row before."""
    out = []
    for i, row in enumerate(history):
        prev, nxt = (history[i - 1] if i else None), (history[i + 1] if i + 1 < len(history) else None)
        if prev and nxt and row.get('early') is not None and row['early'] < prev.get('early', 0) and row.get('mail', 0) < prev.get('mail', 0) \
                and (nxt.get('early'), nxt.get('mail')) == (prev.get('early'), prev.get('mail')):
            continue
        out.append(row)
    return out
