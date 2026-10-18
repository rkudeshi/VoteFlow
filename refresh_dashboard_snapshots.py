"""Merge manually verified locality-dashboard site snapshots into the public series.

Dashboard snapshots use activity dates for chart observations and retain the
separate report/retrieval dates. Re-running this script is idempotent. DAL
remains the countywide aggregate source; dashboards contribute site counts.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SNAPSHOTS = ROOT / "sources" / "site-snapshots" / "dashboard"
REGION = ROOT / "dist" / "region.json"


def main():
    data = json.loads(REGION.read_text())
    latest = {}
    for path in sorted(SNAPSHOTS.glob("*.json")):
        snapshot = json.loads(path.read_text())
        assert snapshot["election"] == "2026"
        assert snapshot["activityThrough"] <= snapshot["reportDate"]
        assert snapshot["early"] >= 0 and snapshot["mail"] >= 0
        assert snapshot.get("outstanding", 0) >= 0
        previous = latest.get(snapshot["locality"])
        if not previous or snapshot["retrievedAt"] > previous["retrievedAt"]:
            latest[snapshot["locality"]] = snapshot

    changes = []
    for locality_id, snapshot in latest.items():
        site_rows = snapshot.get("sitesDaily", [])
        if site_rows:
            report = data.setdefault("siteReports", {}).setdefault(locality_id, {}).setdefault(
                "2026",
                {
                    "source": snapshot["source"],
                    "siteKeys": sorted(site_rows[0]["sites"]),
                    "coverageStart": min(item["date"] for item in site_rows),
                    "history": [],
                },
            )
            report["source"] = snapshot["source"]
            report["siteKeys"] = sorted(set(report.get("siteKeys", [])) | set(site_rows[0]["sites"]))
            history = {item["date"]: item for item in report.get("history", [])}
            for item in site_rows:
                assert sum(item["sites"].values()) == item["early"]
                candidate = {
                    "date": item["date"],
                    "early": item["early"],
                    "sites": item["sites"],
                    "reportedAt": snapshot["retrievedAt"],
                }
                existing = history.get(item["date"])
                if existing and existing.get("early") == candidate["early"] and existing.get("sites") == candidate["sites"]:
                    continue
                history[item["date"]] = candidate
                changes.append([locality_id, item["date"], "sites"])
            report["history"] = [history[day] for day in sorted(history)]
            report["coverageStart"] = min(history)

    content = json.dumps(data, separators=(",", ":"))
    changed = content != REGION.read_text()
    if changed:
        REGION.write_text(content)
    if changed:
        from status_log import record
        localities=', '.join(sorted({c[0].replace('-', ' ').title() for c in changes}))
        record("Locality dashboards", "Updated voting-site counts for " + (localities or "verified localities") + ".", max((c[1] for c in changes), default=None))
    print(json.dumps({"changed": changed, "observations": changes}))


if __name__ == "__main__":
    main()
