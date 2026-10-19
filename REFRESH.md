# VA Vote data refresh

## Automatic recovery and Fairfax checks
Fetch Fairfax report contents on each hourly check. Identical PDF bytes exit
without parsing, rebuilding, or writing status entries.
Every new PDF is kept in `sources/fairfax-snapshots/` and committed, named
`<report date>-<hash>.pdf` with its text; a PDF that fails to parse is kept as
`retrieved-<Eastern retrieval date>-<hash>.pdf` for review. Never delete these. DAL remains a daily
refresh. Both fetchers retry transient network errors and HTTP 408/429/5xx
failures up to three attempts with short backoff; permanent errors remain errors.
Fairfax accepts two- or four-digit report years and detailed activity on the
report date. Lone template zeros are not observations. All table totals, cover
totals, and site sums must reconcile before any data is replaced; detailed
activity after the report date and regressing coverage require review.

Minor source-format changes may be diagnosed and repaired automatically in the
data importers, with regression tests, without asking the user each time. Inspect
the latest remote code first, preserve design and concurrent edits, and verify
the actual source contents. Never guess missing numbers, bypass reconciliation,
or label a failed import successful. Preserve last valid data if recovery fails.
Notify the user of published changes, new failures, or recovery; suppress repeated
unchanged checks and identical failure notifications. Never add a public error
banner. ELECT schedule checks remain daily, not hourly; this supersedes the older
on-demand-only schedule instructions below.

## URLs, charts, and weather
Use clean routes such as `/2022/loudoun-county/`. The publishing workflow runs
`python build_routes.py` to generate entry pages for every supported route;
keep `<base href="/">` in the shared HTML so deep-link assets resolve correctly.
Use clean path URLs. Do not commit generated route copies.
Daily-chart ticks use the exact same noon-UTC date positions as the columns.
Trim only leading/trailing days without daily ballot activity; preserve interior
zero days and negative reporting corrections. Comparison charts use a taller view.
Run `python refresh_weather.py` after importing ballot data. It reuses saved
weather and fetches only days after the saved coverage, respecting rate limits.
If the weather provider fails, ballot data still validates and publishes; the
missing recent days are filled on the next run. Commit `dist/weather/*.json` and its manifest.
Weather keys use complete locality IDs: Richmond City and Richmond County, for
example, must not share observations. Daily high/low temperature, precipitation,
snow, wind, and weather code are saved in local time for each tracked election.

## Recovered historical daily data
`dist/archived-voting-history.json` supplements missing locality/election histories. The app
merges it with `region.json` without replacing existing histories. Fairfax is
explicitly excluded. Do not delete this supplemental file during future refreshes.
Saved chart literals are in `sources/archived-voting/`; regenerate with `python import_archived_voting.py`.
The importer validates daily in-person + mail totals against the cumulative chart,
preserves zero days, and retains headline totals separately when they differ.
Unreturned applications are final snapshots only, never invented daily observations.
Registration uses the existing November 1 registration series, not a denominator
inferred from rounded turnout rates. Public metadata uses “Archived voting data”
and “Historical voting totals compiled from archived reports.” These are
intermediary reports, not data downloaded directly from the state.
Preserve exact URLs and original attribution privately under the ignored
`.private/source-provenance/` directory. For newly acquired archived snapshots,
keep the original there and use neutral attribution in the tracked copy (a null
`url` and `sourceLabel: "Archived voting data"`); preserve every chart literal,
count, date, and retrieval timestamp. The importer also records supplied URLs
privately and never exports them to the website.

After validation, commit data and any display changes to `main` in
`rkudeshi/HowVirginiaVotes`. `.github/workflows/pages.yml` automatically validates
and publishes `dist` on every push to `main`. Verify the workflow succeeds and the
live GitHub Pages site shows the new data. Do not publish to ChatGPT Sites.

## Public update status
Successful changed-data imports automatically append retrieval timestamps and source
details to `dist/status.json` through `status_log.py`. Publish that file with every
data update. Do not fabricate past retrieval times or log unchanged checks as imports.
When `refresh_dal.py` completes but the download has nothing newer, it adds one
"Checked for new data" entry per Eastern day (`status_log.record_check`). Commit and
push that `dist/status.json` change so the Status page shows the daily check ran.
DAL imports use the public label “Daily Absentee List”; their download URL and
content hash are recorded privately, not as a public Status link.
For a manual verified import, run `python status_log.py "Source name" "What changed"
--through YYYY-MM-DD --url SOURCE_URL` immediately after saving the data.
Also log substantive site changes. The Status page formats UTC timestamps in the
visitor's local timezone. Preserve its existing event history.
Precinct maps are displayed only for the current November 2026 election.

This is a static GitHub Pages project in rkudeshi/HowVirginiaVotes. Start from
the latest main branch before editing. Preserve all historical data/UI. Do not rebuild
with build_data.py or prepare_region.py: those older builders predate enrichment.

1. Run `python refresh_dal.py`. It downloads aggregate metrics, merges current
   locality and vetted precinct histories, preserves registration denominators,
   validates mail component totals and saves changed source snapshots. It prints
   changedFiles. A second run with the same ZIP must report zero changed files.
2. Use DAL for non-Fairfax countywide aggregates. Run site-level dashboard
   refreshers only while one or more satellite early-voting locations are open
   and the source reports per-site turnout. Dashboards are for site counts, not
   an alternate countywide series. For Loudoun, `python refresh_sites.py`
   archives per-site days as published; the live ArcGIS feed exposes only the
   latest day. Preserve gaps, partial site coverage and prior verified site
   counts. Its EV_Total (same definition as DAL's cumulative early in
   person) is stored under `provisional` in region.json and shown that evening
   for any day DAL doesn't have yet; Ballots_Returned/Ballots_Mailed use other
   definitions and are not used. DAL always wins once its file has the day.
   Arlington's Snapshot early and mail totals (they match DAL) are stored the
   same way by refresh_arlington.py. See provisional.py. If a site feed fails, keep its previous data and
   continue the DAL update.
3. Run `python refresh_fairfax.py`. Fetch the linked PDF contents every time,
   even if its filename, URL, report date or HTTP metadata is unchanged. The
   September 19 filename was serving September 21 content. Parse the internal
   report date and compare content hashes. Reconcile every daily table to the
   cover totals before replacing data. The parser fails closed on a new layout;
   inspect and adapt it, then continue other sources if recovery is blocked.
   Fairfax PDF values take precedence everywhere they exist. the site applies
   preferCountyReports() for the homepage, locality cards and comparison charts;
   daily charts use official history and projections already use official rows.
   Raw DAL data remains for fields unavailable in the PDF, especially precincts.
   Never offer a source selector or competing Fairfax totals to visitors.
4. County dashboards (Loudoun, Arlington, Alexandria): run
   `node capture_dashboards.cjs`. It fingerprints each source and writes nothing
   when unchanged; a change saves the raw data and dated screenshots under
   `sources/dashboard-archive/<locality>/<date>/` so every imported number has
   an image to check against. Commit those files. Then:
   - Loudoun: `python refresh_sites.py --file <latest arcgis-feed.json>`.
   - Arlington: `python refresh_arlington.py` (decodes the Power BI capture,
     maps 2024 column names to the same weekday 104 weeks later, reconciles
     sites to the Snapshot total, fails closed otherwise).
   - Alexandria: Tableau blocks scripted data, so read the saved
     EarlyVotingbyLocation.png and Overview.png and write a snapshot in
     `sources/site-snapshots/dashboard/` (format of the September 22 file),
     transcribing only what the image shows.
   Then run `python refresh_dashboard_snapshots.py`. Dashboard snapshots keep
   activity dates separate from report and retrieval dates; a corrected
   snapshot replaces the affected site/day observation.
5. When Prince William satellite sites are open, check its official site-level
   feed or dashboard. `python refresh_pwc.py` currently captures countywide Wix
   figures and therefore should not run as the aggregate source. Retain its raw
   snapshots and prior verified observations, but let DAL supply current
   countywide totals.
6. Arlington's public Power BI workbook currently reuses 2024 internal field
   names with a 2026 visible calendar. The verified September18 counts are saved
   in siteReports. Do not rerun import_arlington_sites.py as a live updater: it is
   a reproducible importer for the preserved September19 snapshot. A future
   update must verify the displayed date-to-field mapping and reporting cutoff.
   Never import future calendar zeros, an unused site template, or assume the
   date embedded in a field name is its actual activity date.
7. Preserve source dates and coverage markers. siteReports is distinct from
   official (which carries full Fairfax mail composition). Do not fill site
   counts from precinct-of-residence data. Do not invent daily history from
   cumulative totals or allocate county totals across multiple sites.
8. Run `python validate_data.py` and `python build_voteflow.py` before publishing.
   Commit and push only actual changes to the GitHub main branch. The Pages
   workflow validates and publishes dist/; confirm the deployment succeeds.

The previous Sites refresh instructions used hourly checks at :30, America/New_York.
The active schedule is Claude scheduled tasks in the VoteFlow project
(America/New_York): DAL hourly from 6:45 a.m. until that day's file is imported,
the Fairfax PDF hourly from 9:05 a.m. to 2:05 p.m., and county dashboards (step 4):
Loudoun and Arlington at 5:30, 6, 6:30 and 7 p.m. (they post after polls close),
and all dashboards hourly 9:10 a.m.–2:10 p.m. (Alexandria posts next morning; this
is also the backup for the evening checks). Do not create other schedules. Check DAL for all 133 Virginia
localities and Fairfax's PDF every run. Check a locality dashboard or linked feed
only while satellite early-voting locations are open and it can add per-site
turnout. Use sources/site-audit/coverage.json as the starting source list, not a
permanent availability verdict. Same-day and same-URL corrections count,
including downward changes of one or two ballots.
Replace corrected observations, do not add a correction as another day's ballots.
Keep raw content-addressed snapshots and Git history. Do not enforce monotonic
counts or suppress small changes. Publish data changes only. If one source fails,
retain its last valid observations and continue all other checks.

## Statewide expansion

The homepage and five DAL election histories now cover all 133 localities.
Schedule checks are on demand only, not part of the daily turnout refresh.
Keep the existing inventory. Run `python refresh_satellites.py` only when a schedule
review is requested or a specific announced change requires verification.
`dist/region.json` satellites.2026 contains verified listed locations, opening
rules, and additional-site counts. Counts exclude the main voting office, even
when that office is offsite. The satellite list currently contains 17 multi-site
localities. Regions are editorial browsing groups; Northern Virginia is exactly
the original nine. No new precinct layers were created for this expansion.

Registrar offices: `python3 refresh_offices.py` saves every office's address and
regular weekday hours from the state's contact lookup to
`sources/registrar-offices.json`; pages show them, but the office stays out of the
day-by-day schedule because extended and weekend hours aren't listed there.
Where a locality publishes its office's full early-voting hours, transcribe them
into `sources/office-schedules.json` (Loudoun, Arlington and Alexandria so far);
the office then joins the schedule, calendar and ballots-per-hour figures, and
days before the first satellite opens credit that day's in-person ballots to the
office.

DAL refresh iterates all 133 current localities. Keep all fixed denominators and
historical series. New 2023/2024 localities use official November 1 registration
reports archived in sources; existing denominators are preserved. Some official
CSV URLs return PDF content; the expansion importer detects the content type.

For satellite jurisdictions with no verified site-level feed yet, consult the
source registry and official election office links. Do not claim a dashboard was
checked merely because its schedule was downloaded. Never manufacture site
counts or treat an incomplete set of site hours as a complete calendar for the
projection model. Verified textual schedules are shown separately when a full
calendar has not been reconstructed. Election-relative forecasts remain available
from DAL histories without unverified site-hours assumptions.

## Homepage comparisons and overview boundaries
The overview uses Census 2024 shoreline-clipped cartographic county boundaries,
not precinct unions that include offshore water. Rebuild with
`python build_overview_map.py path/to/cb_2024_us_county_500k.zip`.
Preserve `landSqMiles` in all 133 overview features. Community-density and size
groups use fixed 2026 registration counts, so membership does not change when
switching elections. Regional rates divide summed ballots by summed registration;
never average locality percentages. Pace comparisons match each locality at the
same election-relative day and disclose incomplete matched coverage.
Historical comparison filters apply to both axes, lines, and detail values.
The Through today view caps the selected election at its latest report and clips
all years to that election-relative day. In-person and mail filters remain distinct.
November 2020 now covers all 133 localities, preserving the existing Fairfax data.
November 2021 and 2022 also cover all 133 localities, preserving existing Fairfax and Loudoun histories.
Structured rendered-chart snapshots use schemaVersion 2; the historical importer
validates both saved chart literals and structured daily records.

## Current refresh policy (October 13, 2026)
Use DAL immediately for all 133 localities, including Fairfax County. Fetch the
county report whenever refreshing Fairfax; use county values for the exact
activity dates and fields it provides. Keep newer DAL dates until the county
covers those dates. A county report not yet covering the newest DAL day is normal,
not a failed update. Preserve both raw source series; build_voteflow.py merges them
in memory through fairfax_history.py. Preserve fixed registration denominators.
Use each source's own daily counts, not differences between unlike sources.
Do not clamp away negative corrections. Keep older county mail breakdowns dated;
do not present them as parts of a newer DAL mail total.

Do not run ELECT schedule checks as part of daily turnout updates. Schedule and
optional site-feed failures must not block otherwise valid DAL/Fairfax publication.
Report technical issues directly to the user. The public delay banner and its
status flag have been removed; do not recreate them or publish error-only commits.
