"""Generate real GitHub Pages entry files so deep links return HTTP 200.

The current site (dist/index.html) uses /va/<locality>/<election month>, /va/statewide/<election month>
and /va/<locality>; the previous design (dist/old/v2/index.html) keeps /old/v2/2026/fairfax-county.
"""
import json
from pathlib import Path
root=Path(__file__).resolve().parent/'dist'
data=json.loads((root/'region.json').read_text())
dates=[e['electionDate'] for e in data['elections'].values()]
# Year-month (2026-11); the full date only when two elections share a month (matches build_voteflow.py).
dates=[d if [x[:7] for x in dates].count(d[:7])>1 else d[:7] for d in dates]
paths=['status','about','va','va/statewide']+[f'va/statewide/{d}' for d in dates]
for loc in data['names']:
 paths.append(f'va/{loc["id"]}')
 paths+=[f'va/{loc["id"]}/{d}' for d in dates]
old=['status','about']
for year in data['elections']:
 old.append(year)
 for loc in data['names']:
  old.append(f'{year}/{loc["id"]}')
  if year=='2026':old.append(f'{year}/{loc["id"]}/scenarios')
for base,routes in ((root,paths),(root/'old'/'v2',old)):
 shell=(base/'index.html').read_bytes()
 for route in routes:
  directory=base/route;directory.mkdir(parents=True,exist_ok=True)
  (directory/'index.html').write_bytes(shell)
# California (not linked from the Virginia pages yet): /ca, /ca/<county>, and the same in capitals.
ca=root/'ca'/'index.html'
if ca.exists():
 shell=ca.read_bytes();ids=[c['id'] for c in json.loads((root/'ca'/'data.json').read_text())['counties']]
 for route in ['CA']+[f'{s}/{c}' for s in ('ca','CA') for c in ids+['about']]:
  directory=root/route;directory.mkdir(parents=True,exist_ok=True)
  (directory/'index.html').write_bytes(shell)
# Unknown paths (old /2026/... links included) get the current site, which shows a not-found page.
(root/'404.html').write_bytes((root/'index.html').read_bytes())
print('Generated',len(paths)+len(old),'clean routes')
