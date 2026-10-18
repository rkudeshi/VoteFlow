"""Turn the latest captured Arlington Power BI data into a dashboard snapshot.

capture_dashboards.cjs saves the raw Power BI query results under
sources/dashboard-archive/arlington-county/. This script decodes the newest
capture, checks it and writes sources/site-snapshots/dashboard/<date>-arlington.json
for refresh_dashboard_snapshots.py to merge.

The workbook still uses 2024 column names ("10/19/2024") under a 2026 visible
calendar. Each column is the same weekday 104 weeks later (9/20/2024 shows as
Friday September 18, 2026), as checked against the calendar page screenshot.
Only days before the report's refresh date are imported; a nonzero count on or
after it means the mapping moved, so the import fails closed. Zero days are
closed days, not observations. The calendar visual has shown a doubled total
for a day (5,780 for October 17 while the site table and Snapshot page agree on
2,890); the site table is used.
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARCHIVE = ROOT / "sources" / "dashboard-archive" / "arlington-county"
OUT = ROOT / "sources" / "site-snapshots" / "dashboard"
SOURCE = "https://vote.arlingtonva.gov/Elections/Results-Data"
SITES = {"EV1 - Courthouse": "courthouse", "EV2 - Langston Brown": "langston_brown", "EV3 - Walter Reed": "walter_reed"}
UNUSED = {"EV4 - Long Bridge"}  # template row, not a 2026 location
OFFSET = timedelta(weeks=104)


def decode(result):
    """Decode a Power BI DSR result into a list of dicts keyed by select name."""
    data = result["results"][0]["result"]["data"]
    names = [s["Name"] for s in data["descriptor"]["Select"]]
    ds = data["dsr"]["DS"][0]
    dicts = ds.get("ValueDicts", {})
    rows = ds["PH"][0]["DM0"]
    schema = rows[0]["S"]
    keys = [s["N"] for s in schema]
    prev = [None] * len(schema)
    out = []
    for row in rows:
        if "C" not in row and all(k in row for k in keys):
            current = [row[k] for k in keys]
        else:
            values = iter(row.get("C", []))
            current = []
            for i in range(len(schema)):
                if row.get("R", 0) >> i & 1:
                    current.append(prev[i])
                elif row.get("Ø", 0) >> i & 1:
                    current.append(None)
                else:
                    current.append(next(values))
        prev = current
        out.append({names[i]: dicts[schema[i]["DN"]][v] if v is not None and "DN" in schema[i] else v for i, v in enumerate(current)})
    return out


def activity_date(column):
    month, day, year = map(int, column.split("/"))
    assert year == 2024, column
    return (date(year, month, day) + OFFSET).isoformat()


def main():
    latest = json.loads((ARCHIVE / "latest.json").read_text())
    capture = json.loads((ROOT / latest["dataFile"]).read_text())
    q = capture["queries"]
    refreshed = datetime.fromtimestamp(decode(q["refreshed"])[0]["Refreshed"] / 1000, timezone.utc).date().isoformat()
    rows = {r["Site"]: r for r in decode(q["daily"])}
    totals = decode(q["totals"])[0]
    unknown = set(rows) - set(SITES) - UNUSED - {"Total"}
    assert not unknown, f"New Arlington site rows need review: {sorted(unknown)}"
    for name in UNUSED & set(rows):
        assert not rows[name]["Total"], f"{name} has votes; review before importing"

    days = []
    for column in capture["dateColumns"]:
        when = activity_date(column)
        sites = {key: int(rows[name][column] or 0) for name, key in SITES.items() if name in rows}
        total = int(rows["Total"][column] or 0)
        assert sum(sites.values()) == total, (column, sites, total)
        if not total:
            continue
        assert when < refreshed, f"{column} maps to {when}, on or after the {refreshed} refresh; check the date mapping"
        days.append({"date": when, "early": total, "sites": sites})

    early = int(totals["Early Voting"])
    assert sum(d["early"] for d in days) == int(rows["Total"]["Total"]) == early, "Daily site counts do not add up to the Snapshot total"
    snapshot = {
        "election": "2026",
        "locality": "arlington-county",
        "source": SOURCE,
        "retrievedAt": capture["retrievedAt"],
        "reportDate": refreshed,
        "activityThrough": max(d["date"] for d in days),
        "early": early,
        "mail": int(totals["Mail Ballots Cast"]),
        "capture": latest["dataFile"],
        "sitesDaily": days,
    }
    path = OUT / f"{refreshed}-arlington.json"
    text = json.dumps(snapshot, indent=2) + "\n"
    changed = not path.exists() or path.read_text() != text
    if changed:
        path.write_text(text)
    print(json.dumps({"source": "Arlington dashboard", "changed": changed, "snapshot": str(path.relative_to(ROOT)), "activityThrough": snapshot["activityThrough"], "latestDay": days[-1]}))


if __name__ == "__main__":
    sys.exit(main())
