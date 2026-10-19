"""Registrar office addresses and regular hours from the state's contact lookup.

Every registrar's office offers early voting, but the state's early-voting site list
usually leaves the office out. The Department of Elections' Local Voter Registration
Office page (dist/region.json names[].officeSource) lists each office's facility,
address and regular weekly hours. This saves them to sources/registrar-offices.json
for build_voteflow.py. Office extended and weekend early-voting hours are not on that
page; sources/office-schedules.json carries them where the locality publishes them.

    python3 refresh_offices.py
"""
import concurrent.futures
import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sources" / "registrar-offices.json"
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def field(page, label):
    m = re.search(r"<strong[^>]*>\s*" + label + r"\s*</strong>\s*</p>\s*<p[^>]*>(.*?)</p>", page, re.S)
    return m and html.unescape(re.sub(r"\s+", " ", re.sub(r"<br\s*/?>", "\n", m.group(1))).strip())


def parse(page):
    addr = re.search(r"<strong>(?:Physical )?Address</strong></p>\s*<p>(.*?)</p>", page, re.S)
    lines = [html.unescape(re.sub(r"\s+", " ", x)).strip() for x in re.split(r"<br\s*/?>", addr.group(1))] if addr else []
    hours = {}
    for day, a, b in re.findall(r"(" + "|".join(DAYS) + r")\s*:\s*(\d\d:\d\d)\s*-\s*(\d\d:\d\d)", page):
        hours[day] = [a, b]
    return {"facility": field(page, "Facility"), "address": ", ".join(x for x in lines if x), "hours": hours}


def fetch(item):
    lid, url = item
    with urllib.request.urlopen(url, timeout=60) as r:
        return lid, parse(r.read().decode("utf-8", "replace"))


def main():
    region = json.loads((ROOT / "dist" / "region.json").read_text())
    jobs = {n["id"]: n["officeSource"] for n in region["names"] if n.get("officeSource")}
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for lid, rec in ex.map(fetch, jobs.items()):
            assert rec["address"], f"No address for {lid}"
            out[lid] = dict(rec, url=jobs[lid])
    data = {"source": "https://vote.elections.virginia.gov/VoterInformation/PublicContactLookup",
            "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "offices": dict(sorted(out.items()))}
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(json.dumps({"offices": len(out), "withHours": sum(1 for x in out.values() if x["hours"])}))


if __name__ == "__main__":
    main()
