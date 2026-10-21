# California data (hidden /ca page)

Source: California Secretary of State, VoteCal vote-by-mail ballot statistics, posted once a day
on https://www.sos.ca.gov/elections/upcoming-elections/general-election-november-3-2026 as a PDF
and an XLSX. Each report is cumulative through 11:59 PM the day before it posts (observed posting
times so far: about 9 to 10:35 AM Pacific).

- `reports/` holds every file unchanged, named by the report's own as-of date. Oct 11 to 19, 2026
  came from Ravi's earlier ChatGPT archive (`handoff/` keeps its notes and manifest; the Oct 12
  PDF there differs from its recorded hash, see HANDOFF-NOTES.txt). Same-date revisions are kept
  as `-retrieved-<UTC stamp>` copies; the newest one feeds the site.
- `observations.jsonl` logs every check (URLs, HTTP headers, Last-Modified, hashes, result).
- `unprocessed/` will hold the Unprocessed Ballots reports once the state starts posting them
  (after Election Day). They are archived but not parsed yet.

Refresh: `python3 refresh_ca.py` (exit 0 new data, 3 nothing new, 1 failure). It rebuilds
`dist/ca/data.json` through `ca_data.py`, which validates 58 counties, no duplicates, county rows
adding to the Total row, and return methods adding to total returned. Commit `sources/ca/` and
`dist/ca/data.json` together. `python3 build_ca_map.py` regenerates `dist/ca/map.json` (rarely needed).

Page: `dist/ca/index.html` + `ca.js` + `/vf/templates/ca.html`; `build_routes.py` copies the shell
to `/ca/<county>/` and `/CA/...`. Not linked from the Virginia pages and marked noindex until
Ravi says it's ready. Daily figures are changes between consecutive reports; negative changes
(county corrections) are kept and flagged.
