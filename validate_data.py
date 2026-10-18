"""Validate aggregate invariants without requiring network access."""
import json
from pathlib import Path
r=Path(__file__).resolve().parent/'dist';d=json.loads((r/'region.json').read_text())
supplement=json.loads((r/'archived-voting-history.json').read_text())
for locality,years in supplement['localities'].items():
 assert locality!='fairfax-county', 'Fairfax must retain its official history'
 for year,record in years.items():
  assert record['id']==locality
  assert all(l['id']!=locality for l in d['elections'][year]['localities']), 'Supplement must fill a gap'
  cumulative={'early':0,'mail':0,'total':0}
  from datetime import date,timedelta
  previous=None
  for row in record['history']:
   current=date.fromisoformat(row['date'])
   assert previous is None or current==previous+timedelta(days=1)
   previous=current
   assert row['daily']['early']+row['daily']['mail']==row['daily']['total']
   for key in cumulative:
    assert row['daily'][key]>=0
    cumulative[key]+=row['daily'][key]
    assert cumulative[key]==row[key]
  assert cumulative==record['archivedVoting']['dailySum']
  headline=record['archivedVoting']['headline']
  assert headline['early']+headline['mail']==headline['total']
  d['elections'][year]['localities'].append(record)
wcov=json.loads((r/'weather/manifest.json').read_text())['coverage']
for y,e in d['elections'].items():
 weather=json.loads((r/f'weather/{y}.json').read_text())
 assert len(weather)==133,(y,'weather locality coverage')
 for l in e['localities']:
  h=l['history'];assert [v['date'] for v in h]==sorted(set(v['date'] for v in h)),(y,l['id'])
  for v in h:
   assert v['total']==v['early']+v['mail'],(y,l['id'],v['date'])
   # Weather lags ballot data when the provider is unavailable; days after the
   # saved weather coverage may be missing, but never days inside it.
   w=weather[f'{l["id"]}-{y}-general'].get(v['date'])
   if w is None and v['date']>wcov[y]['end']:continue
   assert w,(y,l['id'],v['date'],'weather')
   assert all(w.get(k) is not None for k in ['tempMax','tempMin','precip','code'])
   assert w['tempMax']>=w['tempMin'] and w['precip']>=0
for id,ys in d.get('siteReports',{}).items():
 for y,o in ys.items():
  assert o['source'] and o['siteKeys']
  for v in o['history']:
   assert sum(n for n in v['sites'].values() if n is not None)==v['early']
   assert set(v['sites'])<=set(o['siteKeys'])
   if 'countyCumulative' in v:assert v['early']<=v['countyCumulative']
for p in (r/'precinct-data').glob('2026-*.json'):
 x=json.loads(p.read_text());assert x['dates']==sorted(set(x['dates']))
 for pr in x['precincts'].values():
  for day,v in pr['history'].items():assert day in x['dates'] and len(v)==3 and all(n>=0 for n in v)
for year in ('2020','2021','2022'):
 assert {l['id'] for l in d['elections'][year]['localities']}=={l['id'] for l in d['names']}, f'Incomplete {year} coverage'
 assert len(d['elections'][year]['localities'])==133, f'Duplicate {year} locality'
geo=json.loads((r/'regional.geojson').read_text())
assert len(geo['features'])==133
assert {f['properties']['id'] for f in geo['features']}=={l['id'] for l in d['names']}
assert all(f['properties']['landSqMiles']>0 for f in geo['features'])
for key in ['accomack-county','northampton-county']:
 f=next(f for f in geo['features'] if f['properties']['id']==key)
 assert f['geometry']['type']=='MultiPolygon' and len(f['geometry']['coordinates'])>1, 'Shoreline islands lost'
print('PASS totals, complete 2020–2022 coverage, weather, coastline geometry, daily ordering, and precinct records')
