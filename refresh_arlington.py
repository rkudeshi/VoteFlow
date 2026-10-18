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
closed days, not observations. Cumulative early and mail ballots by precinct
also go into dist/precinct-data/2026-arlington-county.json for the activity
date (the state's precinct files stopped updating after September 23). The calendar visual has shown a doubled total
for a day (5,780 for October 17 while the site table and Snapshot page agree on
2,890); the site table is used.
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from provisional import record as provisional

ROOT = Path(__file__).resolve().parent
ARCHIVE = ROOT / "sources" / "dashboard-archive" / "arlington-county"
PRECINCTS = ROOT / "dist" / "precinct-data" / "2026-arlington-county.json"
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


def update_precincts(rows, day, early, mail):
    """Cumulative early/mail by precinct for one activity date; every saved precinct must match."""
    data = json.loads(PRECINCTS.read_text())
    by_code = {}
    for r in rows:
        code, _, name = r["Precinct"].partition(" - ")
        by_code[str(int(code))] = (name, int(r["Early Voting"] or 0), int(r["Mail Ballots Cast"] or 0))
    assert set(by_code) == set(data["precincts"]), "Arlington precinct list changed; review before importing"
    assert sum(v[1] for v in by_code.values()) == early and sum(v[2] for v in by_code.values()) == mail, "Precinct counts do not add up"
    for code, p in data["precincts"].items():
        name, e, m = by_code[code]
        assert name == p["name"], (code, name, p["name"])
        registered = next((v[2] for _, v in sorted(p["history"].items()) if v[2]), 0)
        p["history"][day] = [e, m, registered]
        p["history"] = dict(sorted(p["history"].items()))
    data["dates"] = sorted({d for p in data["precincts"].values() for d in p["history"]})
    text = json.dumps(data, separators=(",", ":"))
    if text == PRECINCTS.read_text():
        return False
    PRECINCTS.write_text(text)
    return True


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
    # The Snapshot totals match DAL's cumulative early and mail counts.
    provisional("arlington-county", snapshot["activityThrough"], {"early": early, "mail": snapshot["mail"]}, "Arlington County dashboard", capture["retrievedAt"])
    precincts_changed = update_precincts(decode(q["precincts"]), snapshot["activityThrough"], early, snapshot["mail"])
    path = OUT / f"{refreshed}-arlington.json"
    text = json.dumps(snapshot, indent=2) + "\n"
    changed = not path.exists() or path.read_text() != text
    if changed:
        path.write_text(text)
    print(json.dumps({"source": "Arlington dashboard", "changed": changed, "snapshot": str(path.relative_to(ROOT)), "activityThrough": snapshot["activityThrough"], "latestDay": days[-1], "precinctsChanged": precincts_changed}))


if __name__ == "__main__":
    sys.exit(main())
