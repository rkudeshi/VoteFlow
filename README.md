# VoteFlow · Virginia

Virginia early-voting turnout dashboard covering all 133 localities, historical comparisons, precinct maps, voting schedules, and planning scenarios.

The website is static HTML, JavaScript, and saved JSON data. It needs no server, database, API key, or package installation.

- **Current design** (`dist/index.html`, `dist/vf/`): pages are HTML templates in `dist/vf/templates/` with logic in `dist/vf/pages/`, rendered by a small runtime (`dist/vf/runtime.js`) on a vendored copy of Preact (`dist/vf/preact.min.js`, MIT). Routes: `/`, `/va/statewide/<election>`, `/va/<locality>` (its election history), `/va/<locality>/<election>`, `/status`, `/about`. An election is its year and month (`2026-11`), or its full ISO date (`2026-11-03`) only when two elections share a month. Unknown paths show a not-found page.
- **Page data** (`dist/data/`, not committed): `build_voteflow.py` turns the saved data into one bundle per election (`home-<election>.json`) and one per locality (`loc/<locality>.json`). The publish workflow runs it on every deploy.
- **Previous design** (`dist/old/v2/`): the earlier dashboard, kept at `/old/v2/`. It reads the same saved data files from the site root.

## Website and publishing

GitHub Pages publishes **only `dist/`** through `.github/workflows/pages.yml` when changes reach `main`. The workflow validates the saved data and JavaScript before publishing. The custom domain is `voteflow.raviudeshi.com`.

For a local preview, run `python3 build_voteflow.py && python3 build_routes.py`, then `python3 -m http.server 8000 --directory dist` and open http://localhost:8000. Navigation uses clean paths; `build_routes.py` writes an entry page for each route so deep links work on GitHub Pages.

## Where scheduled updates belong

The scheduled ChatGPT task should update this repository:

- `dist/region.json`: locality totals, histories, reports, schedules, and supporting data.
- `dist/precinct-data/`: saved precinct turnout by election and locality.
- `dist/status.json`: append verified import and substantive site-change records.
- `dist/map-manifest.json`, `dist/maps/`, and other geography files: update only when geography changes.
- `sources/`: preserve source snapshots, provenance, and coverage records; this folder is not published to Pages.

Follow **[REFRESH.md](REFRESH.md)** for source precedence, corrections, missing data, and validation. Run the relevant Python refresh scripts, inspect the diff, run `python3 validate_data.py` and `python3 build_voteflow.py` (it must finish without errors), then commit the actual changes to `main`. A successful push triggers publication. Do not put credentials, personal voter records, or temporary files in this repository.

The data-fetching schedule is managed separately in ChatGPT. This repository's workflow only validates and publishes saved files; it does not schedule data collection. Do not create a second refresh schedule here.

## Data preparation

The primary DAL updater uses Python's standard library. The Fairfax PDF updater also requires `pdftotext` (Poppler). Some optional acquisition and historic/geographic reconstruction scripts use Beautiful Soup, pdfplumber, shapely, pyshp, and pyproj. None are required to view or deploy the saved website.

Source names are **Daily Absentee List (DAL)** and **Archived voting data**.
DAL totals are compiled from Virginia Daily Absentee List records via intermediary
reports. Historical voting totals are compiled from archived reports. These
datasets were not obtained directly from the state; official locality reports
retain their existing precedence.

Use `refresh_dal.py` for current DAL updates and `import_archived_voting.py` for
saved historical reports. Archives live in `sources/dal-snapshots/` and
`sources/archived-voting/`; the website loads `dist/archived-voting-history.json`.
Exact original attribution and URLs are preserved locally in the ignored
`.private/source-provenance/` directory, outside both Git and the Pages artifact.
Keep a private backup of that directory when transferring the workspace; it is
not included in a fresh clone. Git history and original raw data archives remain
unchanged. The DAL download URL stays in the acquisition script.

Preserve existing enriched data. **Do not run older `build_data.py` or `prepare_region.py` to refresh the current dataset**; follow REFRESH.md instead. Older implementation and provenance notes are retained in [SOURCE-NOTES.md](SOURCE-NOTES.md); dated historical descriptions there may no longer match the current site.

## Migration provenance

Imported from VA Vote Sites source commit `5077aaf511f95a11c2a58ed116470dea114aa0d3`. The original Sites deployment is retained. The public site contains aggregate election data, not individual voter records.

## Comparison checks

Run `node --test tests/*.test.cjs` to check comparison defaults, election-relative alignment, matched coverage, weighted turnout, and the election-day cutoff. These tests also run in the Pages workflow.

Run `python3 -m unittest discover -s tests -p 'test_*.py'` to verify historical
import reproducibility, DAL corrections and repeatability, preserved registration
and official-report precedence, and private acquisition metadata. The Pages
workflow runs these checks before deployment.

## Planned updates

See [TODO.md](TODO.md) for deferred congressional district views, percentage precision, and Election Day voting data.

Schedule checks cover verified closed-day planning, incomplete schedules, and historical Fairfax dates. The browser uses `dist/schedules.js` to distinguish recorded historical activity from a verified opening calendar; missing ballot cells do not establish closure.
