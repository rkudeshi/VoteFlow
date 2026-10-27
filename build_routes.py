"""Generate real GitHub Pages entry files so deep links return HTTP 200.

The current site (dist/index.html) uses /va/<locality>/<election month>, /va/statewide/<election month>
and /va/<locality>; the previous design (dist/old/v2/index.html) keeps /old/v2/2026/fairfax-county.
"""
import json,re
from html import escape
from pathlib import Path
root=Path(__file__).resolve().parent/'dist'
SITE='https://voteflow.raviudeshi.com'
def share(shell,place,state,slug):
 """Point a page's link preview at its place's own image and video (render_share_preview.cjs)."""
 if not (root/'share'/slug).with_suffix('.png').exists():return shell
 name=escape(place);img=f'{SITE}/share/{slug}.png';vid=f'{SITE}/share/{slug}.mp4'
 tags=(f'<!--share--><meta property="og:type" content="website"><meta property="og:site_name" content="VoteFlow"><meta property="og:title" content="{name} · VoteFlow">'
  f'<meta property="og:description" content="Early voting and mail ballot turnout in {name}, {state}, updated daily.">\n'
  f'<meta property="og:image" content="{img}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Map of {name} within {state}.">\n'
  f'<meta property="og:video" content="{vid}"><meta property="og:video:secure_url" content="{vid}"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="960"><meta property="og:video:height" content="504">\n'
  f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{img}"><meta name="twitter:image:alt" content="Map of {name} within {state}."><!--/share-->')
 return re.sub(rb'<!--share-->.*?<!--/share-->',lambda m:tags.encode(),shell,count=1,flags=re.S)
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
names={loc['id']:loc['name'] for loc in data['names']}
for base,routes in ((root,paths),(root/'old'/'v2',old)):
 shell=(base/'index.html').read_bytes()
 for route in routes:
  directory=base/route;directory.mkdir(parents=True,exist_ok=True)
  parts=route.split('/')
  page=share(shell,names[parts[1]],'Virginia','va/'+parts[1]) if base==root and parts[0]=='va' and len(parts)>1 and parts[1] in names else shell
  (directory/'index.html').write_bytes(page)
# California (not linked from the Virginia pages yet): /ca, /ca/<county>, and the same in capitals.
ca=root/'ca'/'index.html'
if ca.exists():
 shell=ca.read_bytes();counties={c['id']:c['name'] for c in json.loads((root/'ca'/'data.json').read_text())['counties']}
 for route in ['CA']+[f'{s}/{c}' for s in ('ca','CA') for c in list(counties)+['about']]:
  directory=root/route;directory.mkdir(parents=True,exist_ok=True)
  c=route.split('/')[-1]
  (directory/'index.html').write_bytes(share(shell,counties[c],'California','ca/'+c) if c in counties else shell)
# Unknown paths (old /2026/... links included) get the current site, which shows a not-found page.
(root/'404.html').write_bytes((root/'index.html').read_bytes())
print('Generated',len(paths)+len(old),'clean routes')
