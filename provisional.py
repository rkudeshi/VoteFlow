"""Same-night county totals from locality dashboards, used until DAL catches up.

dist/region.json keeps DAL history unchanged. Dashboard totals go under
provisional[locality][activity date] as cumulative counts for only the fields
the dashboard reports in DAL's own terms (Loudoun: early in person; Arlington:
early in person and mail). build_voteflow.py shows a provisional day only when
DAL has no row for that date, so DAL always wins once its file arrives.
"""
import json
from pathlib import Path

REGION = Path(__file__).resolve().parent / 'dist' / 'region.json'


def record(locality, day, values, source, reported_at, data=None):
    """Store one provisional day. Returns True when region.json content changed."""
    own = data is None
    if own:
        data = json.loads(REGION.read_text())
    entry = {**{k: int(v) for k, v in values.items()}, 'source': source, 'reportedAt': reported_at}
    days = data.setdefault('provisional', {}).setdefault(locality, {})
    if days.get(day) == entry:
        return False
    days[day] = entry
    data['provisional'][locality] = dict(sorted(days.items()))
    if own:
        REGION.write_text(json.dumps(data, separators=(',', ':')))
    return True
