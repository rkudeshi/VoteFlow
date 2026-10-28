"""Refresh Prince William County's daily early-voting counts from the county's public sheet.

The sheet has two tabs we use, both downloaded as CSV:

  NOV26    in-person voters and drop box ballots per early-voting site per day
  Mail AB  mail ballots sent (mail, email), returned (mail, email, drop box) and
           undeliverable, one row per processing day

Staff type the numbers in during the evening, so the newest day can be half
filled. A day's site counts are taken once every site that took voters the day
before has a count, or once a later day has started. A blank drop box cell stays
unknown (null), never zero. The whole sheet is re-read on every run, so later
corrections replace earlier values.

Writes into dist/region.json:
  siteReports[prince-william-county][2026]   in-person voters per site per day
                                             (dropbox per site under "dropbox")
  countyReports[prince-william-county][2026] the county's own daily series in the
                                             Fairfax report shape (sent, postal,
                                             dropbox, early, sites, cumulative)
  provisional[prince-william-county]         cumulative in-person ballots for days
                                             DAL doesn't have yet (provisional.py)

Raw CSVs are saved under sources/pwc-sheet/ when they change. Exits without
writing anything when the sheet is unchanged since the last saved copy.
"""
import csv
import hashlib
import io
import json
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

from provisional import record as provisional

ROOT = Path(__file__).resolve().parent
REGION = ROOT / "dist" / "region.json"
RAW = ROOT / "sources" / "pwc-sheet"
SHEET = "https://docs.google.com/spreadsheets/d/1QpfhAu8iPcga1wo7I-PPVuyBKDEFEo_8xf8ZBdPQ_Ro/export?format=csv&gid="
TABS = {"sites": "0", "mail": "1110567771"}
LID = "prince-william-county"
LABEL = "Prince William County daily report"
YEAR = 2026
# Column headers in the NOV26 tab -> site keys (build_voteflow.SITE_REPORT_NAMES).
SITES = {"OFFICE": "office", "DMV": "dmv", "HAYMARKET": "haymarket", "BRENTSVILLE": "brentsville", "DUMFRIES": "dumfries", "FERLAZZO": "ferlazzo"}
# The county sheet's in-person running total may differ from DAL's by a few ballots.
DAL_SLACK = 50


def num(cell):
    cell = (cell or "").strip().replace(",", "")
    return int(float(cell)) if cell else None


def day_of(cell):
    """'9/18' or '9/18/2026' -> ISO date in the election year."""
    parts = [int(x) for x in cell.strip().split("/")]
    return date(parts[2] if len(parts) == 3 else YEAR, parts[0], parts[1]).isoformat()


def parse_sites(text):
    """Rows of {date, voters{site}, dropbox{site}} in date order, from the NOV26 tab.
    Days with no voters at any site (closed days, future days) are left out."""
    rows = list(csv.reader(io.StringIO(text)))
    head = next(i for i, r in enumerate(rows) if r and r[0].strip() == "Date")
    names = rows[head]
    cols = {}
    for j, name in enumerate(names):
        key = SITES.get(name.strip().upper())
        if key:
            assert rows[head + 1][j].strip().upper() == "VOTERS" and rows[head + 1][j + 1].strip().upper() == "DROPBOX", "Prince William sheet layout changed"
            cols[key] = j
        elif name.strip() and name.strip() not in ("Date", "DAILY TOTAL"):
            raise ValueError(f"New Prince William site column needs review: {name!r}")
    assert set(cols) == set(SITES.values()), "Prince William sheet is missing a site column"
    total_col = next(j for j, name in enumerate(names) if name.strip().upper() == "DAILY TOTAL")
    out = []
    for r in rows[head + 2:]:
        if len(r) < 2 or not r[1].strip() or "/" not in r[1]:
            if r and r[0].strip().upper() == "TOTALS":
                break
            continue
        voters = {k: num(r[j]) for k, j in cols.items()}
        box = {k: num(r[j + 1]) for k, j in cols.items()}
        if not any(voters.values()):
            continue
        day_total = num(r[total_col])
        assert day_total == sum(v or 0 for v in voters.values()), (r[1], "site counts don't add up to the daily total")
        out.append({"date": day_of(r[1]), "voters": voters, "dropbox": box})
    return sorted(out, key=lambda x: x["date"])


def complete_days(days):
    """Drop a trailing day that is still being typed in: some site that took voters the
    day before has no count yet. A day followed by a later day is always complete."""
    if len(days) >= 2:
        last, prev = days[-1], days[-2]
        if any(prev["voters"][k] and not last["voters"][k] for k in prev["voters"]):
            return days[:-1]
    return days


def parse_mail(text):
    """Rows of {date, sentMail, sentEmail, retMail, retEmail, dropbox, undeliverable}, by date,
    from the Mail AB tab. A row whose returned-by-mail cell is still blank isn't entered yet."""
    rows = list(csv.reader(io.StringIO(text)))
    head = next(i for i, r in enumerate(rows) if len(r) > 6 and r[2].strip() == "Mail" and r[3].strip() == "Email")
    assert [c.strip() for c in rows[head][2:8]] == ["Mail", "Email", "Mail", "Emailed", "Dropbox", "Mail"], "Prince William mail tab layout changed"
    out = {}
    for r in rows[head + 1:]:
        if len(r) < 8 or "/" not in r[1] or num(r[4]) is None:
            continue
        d = day_of(r[1])
        assert d not in out, (d, "listed twice in the mail tab")
        out[d] = {"date": d, "sentMail": num(r[2]) or 0, "sentEmail": num(r[3]) or 0, "retMail": num(r[4]) or 0,
                  "retEmail": num(r[5]) or 0, "dropbox": num(r[6]) or 0, "undeliverable": num(r[7]) or 0}
    return [out[d] for d in sorted(out)]


def mail_totals(text):
    """The tab's own grand totals (sent, returned, undeliverable) for reconciliation."""
    rows = list(csv.reader(io.StringIO(text)))
    flat = [c.strip() for r in rows[:3] for c in r]
    pick = lambda label: next(num(flat[i + 1]) for i, c in enumerate(flat[:-1]) if c == label and num(flat[i + 1]) is not None)
    return {"sent": pick("Outgoing"), "returned": pick("Returned"), "undeliverable": pick("Undeliverable")}


def county_series(days, mail):
    """The county's own daily series in the Fairfax report shape. Stops at the last complete
    in-person day so every row has all four running totals."""
    if not days:
        return []
    through = days[-1]["date"]
    by_site = {x["date"]: x for x in days}
    by_mail = {x["date"]: x for x in mail}
    cum = {"sent": 0, "postal": 0, "dropbox": 0, "early": 0}
    hist = []
    for d in sorted(set(by_site) | set(by_mail)):
        if d > through:
            break
        s, m = by_site.get(d), by_mail.get(d)
        row = {"date": d, "sites": {k: v for k, v in (s["voters"] if s else {}).items() if v},
               "sent": m["sentMail"] + m["sentEmail"] if m else 0, "postal": m["retMail"] + m["retEmail"] if m else 0,
               "dropbox": m["dropbox"] if m else 0, "early": sum(v or 0 for v in s["voters"].values()) if s else 0}
        for k in cum:
            cum[k] += row[k]
        row["cumulative"] = dict(cum)
        hist.append(row)
    return hist


def fetch(gid):
    req = urllib.request.Request(SHEET + gid, headers={"Cache-Control": "no-cache", "User-Agent": "VoteFlow data refresh"})
    for attempt in range(3):
        try:
            return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
        except OSError:
            if attempt == 2:
                raise


def unchanged(texts):
    """True when both tabs match the newest saved copies."""
    for tab, text in texts.items():
        saved = sorted(RAW.glob(f"*-{tab}-*.csv"))
        if not saved or saved[-1].read_text() != text:
            return False
    return True


def save_raw(texts, stamp):
    """Keep each changed download (after a successful import, so a failed one is retried)."""
    RAW.mkdir(parents=True, exist_ok=True)
    for tab, text in texts.items():
        saved = sorted(RAW.glob(f"*-{tab}-*.csv"))
        if not saved or saved[-1].read_text() != text:
            (RAW / f"{stamp}-{tab}-{hashlib.sha256(text.encode()).hexdigest()[:12]}.csv").write_text(text)


def main(force=False):
    texts = {tab: fetch(gid) for tab, gid in TABS.items()}
    now = datetime.now(timezone.utc).replace(microsecond=0)
    if unchanged(texts) and not force:
        print(json.dumps({"changed": False, "reason": "sheet unchanged"}))
        return
    days = complete_days(parse_sites(texts["sites"]))
    mail = parse_mail(texts["mail"])
    totals = mail_totals(texts["mail"])
    assert sum(x["sentMail"] + x["sentEmail"] for x in mail) == totals["sent"], "Mail sent rows don't add up to the tab total"
    assert sum(x["retMail"] + x["retEmail"] + x["dropbox"] for x in mail) == totals["returned"], "Mail returned rows don't add up to the tab total"

    data = json.loads(REGION.read_text())
    before = json.dumps(data, separators=(",", ":"))
    reported = now.isoformat()

    # Site counts: keep reportedAt for days whose numbers didn't change.
    report = data.setdefault("siteReports", {}).setdefault(LID, {}).setdefault(str(YEAR), {"history": []})
    old = {x["date"]: x for x in report.get("history", [])}
    hist = []
    for x in days:
        sites = {k: v or 0 for k, v in x["voters"].items()}
        row = {"date": x["date"], "early": sum(sites.values()), "sites": sites, "dropbox": x["dropbox"]}
        prev = old.get(x["date"])
        row["reportedAt"] = prev["reportedAt"] if prev and all(prev.get(k) == row[k] for k in ("early", "sites", "dropbox")) else reported
        hist.append(row)
    report.update({"source": LABEL, "siteKeys": list(SITES.values()), "coverageStart": hist[0]["date"] if hist else None, "history": hist})

    series = county_series(days, mail)
    county = data.setdefault("countyReports", {}).setdefault(LID, {})
    county[str(YEAR)] = {"source": LABEL, "activityThrough": series[-1]["date"] if series else None, "history": series,
                         "extras": {"undeliverable": totals["undeliverable"]}}

    # Same-night in-person running total for days DAL doesn't have yet.
    loc = next(l for l in data["elections"][str(YEAR)]["localities"] if l["id"] == LID)
    dal_last = loc["history"][-1]
    dal_day = dal_last.get("activityDate", dal_last["date"])
    run = {x["date"]: x["cumulative"]["early"] for x in series}
    gap = run[dal_day] - dal_last["early"] if dal_day in run else None
    if gap is not None and abs(gap) <= DAL_SLACK:
        for d, early in run.items():
            if d > dal_day:
                provisional(LID, d, {"early": early}, LABEL, reported, data)
    elif gap is not None:
        print(f"Prince William sheet runs {gap:+} from DAL on {dal_day}; same-night totals skipped", file=sys.stderr)

    text = json.dumps(data, separators=(",", ":"))
    changed = text != before
    save_raw(texts, now.strftime("%Y%m%dT%H%MZ"))
    if changed:
        REGION.write_text(text)
        from status_log import record
        record("Locality dashboards", "Updated Prince William County site, drop box and mail counts.", series[-1]["date"] if series else None)
    print(json.dumps({"changed": changed, "through": series[-1]["date"] if series else None, "dalGap": gap,
                      "provisional": [d for d in run if d > dal_day]}))


if __name__ == "__main__":
    main(force="--force" in sys.argv)
