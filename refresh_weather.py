"""Save gridded daily weather for every tracked locality and election date.

Keeps cached batches to resume interrupted downloads. No future weather is fetched.
"""
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def flatten(x):
 if len(x)==2 and isinstance(x[0],(int,float)):yield x
 else:
  for v in x:yield from flatten(v)
def slug(id):
 return id
def get(url):
 for attempt in range(12):
  try:
   with urllib.request.urlopen(url,timeout=60) as response:return json.load(response)
  except urllib.error.HTTPError as error:
   if error.code!=429 or attempt==11:raise
   print('Weather rate limit; waiting 65 seconds',flush=True)
   time.sleep(65)
  except Exception:
   if attempt>=3:raise
   time.sleep(3*(attempt+1))
def label(code):
 return ('Clear' if code==0 else 'Partly cloudy' if code in (1,2) else 'Cloudy' if code==3 else 'Fog' if code in (45,48) else 'Drizzle' if code in (51,53,55,56,57) else 'Rain' if code in (61,63,65,66,67) else 'Snow' if code in (71,73,75,77,85,86) else 'Showers' if code in (80,81,82) else 'Thunderstorms')
def main():
 region=json.loads((ROOT/'dist/region.json').read_text())
 features=json.loads((ROOT/'dist/regional.geojson').read_text())['features']
 locations=[]
 for f in features:
  points=list(flatten(f['geometry']['coordinates']))
  locations.append({'id':f['properties']['id'],'latitude':round((min(p[1] for p in points)+max(p[1] for p in points))/2,5),'longitude':round((min(p[0] for p in points)+max(p[0] for p in points))/2,5)})
 cache=ROOT/'sources/weather-batches';cache.mkdir(exist_ok=True)
 out=ROOT/'dist/weather';out.mkdir(exist_ok=True)
 metadata={'method':'Locality bounding-box center; gridded estimate','timezone':'America/New_York','provider':'Open-Meteo historical weather API','endpoint':'https://archive-api.open-meteo.com/v1/archive','generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'locations':locations,'coverage':{}}
 ranges={'2020':('2020-09-18','2020-11-08'),'2021':('2021-09-17','2021-11-07'),'2022':('2022-09-23','2022-11-14')}
 old=json.loads((out/'manifest.json').read_text()).get('coverage',{}) if (out/'manifest.json').exists() else {}
 for y,e in region['elections'].items():
  start,end=ranges.get(y,(min(l['history'][0]['date'] for l in e['localities']),max(l['history'][-1]['date'] for l in e['localities'])))
  result={};missing=[];saved=out/f'{y}.json';prior=old.get(y);first=start
  # Reuse saved weather; fetch only dates after the saved coverage so routine
  # refreshes stay well inside the provider's daily request limit.
  if prior and saved.exists() and prior['start']==start:
   if prior['end']>=end:
    metadata['coverage'][y]=prior;print('CACHED',y,flush=True);continue
   result=json.loads(saved.read_text());missing=list(map(tuple,prior.get('missing',[])))
   start=(dt.date.fromisoformat(prior['end'])+dt.timedelta(days=1)).isoformat()
  for offset in range(0,len(locations),10):
   batch=locations[offset:offset+10]
   params={'latitude':','.join(str(l['latitude']) for l in batch),'longitude':','.join(str(l['longitude']) for l in batch),'start_date':start,'end_date':end,'daily':'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,snowfall_sum,wind_speed_10m_max','temperature_unit':'fahrenheit','precipitation_unit':'inch','wind_speed_unit':'mph','timezone':'America/New_York'}
   endpoint='https://archive-api.open-meteo.com/v1/archive'
   path=cache/f'{y}-{offset}-{start}-{end}.json'
   if path.exists():objects=json.loads(path.read_text())
   else:
    url=endpoint+'?'+urllib.parse.urlencode(params)
    objects=get(url)
    path.write_text(json.dumps(objects,separators=(',',':')))
   if isinstance(objects,dict):objects=[objects]
   assert len(objects)==len(batch)
   for loc,obj in zip(batch,objects):
    daily=obj['daily'];rows={}
    for i,date in enumerate(daily['time']):
     vals={k:v[i] for k,v in daily.items() if k!='time'}
     if any(v is None for v in vals.values()):missing.append((loc['id'],date));continue
     code=int(vals['weather_code']);precip=vals['precipitation_sum'];snow=vals['snowfall_sum']
     rows[date]={'code':code,'label':label(code),'tempMax':round(vals['temperature_2m_max'],1),'tempMin':round(vals['temperature_2m_min'],1),'precip':round(precip,3),'snow':snow,'wind':vals['wind_speed_10m_max'],'wet':precip>=.25,'snowy':snow>0}
    result.setdefault(f'{slug(loc["id"])}-{y}-general',{}).update(rows)
   print(y,offset+len(batch),'of',len(locations),flush=True)
  (out/f'{y}.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
  # Coverage ends at the last date every locality has, so days the provider
  # has not filled yet are fetched again on the next run.
  covered=min(max(rows,default=first) for rows in result.values())
  missing=[m for m in missing if m[1]<=covered]
  metadata['coverage'][y]={'start':first,'end':covered,'localities':len(result),'records':sum(map(len,result.values())),'missing':missing}
  (out/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
  print('SAVED',y,metadata['coverage'][y],flush=True)
if __name__=='__main__':main()
