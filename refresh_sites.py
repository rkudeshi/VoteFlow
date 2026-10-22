"""Refresh verified jurisdiction-published Loudoun per-site data.
Loudoun's EV_<site> fields are DAILY counts, per the dashboard's 'Early Voters
Today' labels. EV_Total is cumulative and must not be summed with daily fields.
A missing day is not a zero. Repeated checks replace the same dated snapshot.
DAL remains the countywide aggregate source.
The feed can move Date_Updated to a new day before its EV fields change; a
snapshot whose sites and EV_Total repeat an earlier day's is stale and skipped.
"""
import argparse,json,urllib.request,hashlib
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parent
URL='https://services1.arcgis.com/MxjRokvPm7bjslyR/arcgis/rest/services/ELECTION_VRDATA_VIEW/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json'
SOURCE='https://www.loudoun.gov/5564/Loudoun-Elections-Dashboard'
FIELDS={'leesburg':'EV_Leesburg','sterling':'EV_Sterling','dulles_south':'EV_South_Riding','purcellville':'EV_Purcellville','ashburn':'EV_Ashburn'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--file',type=Path);args=p.parse_args()
 raw=args.file.read_text() if args.file else urllib.request.urlopen(URL,timeout=40).read().decode();data=json.loads(raw)
 zone=ZoneInfo('America/New_York');dt=lambda n:datetime.fromtimestamp(n/1000,zone)
 def observation(text):
  payload=json.loads(text);assert len(payload['features'])==1
  a=payload['features'][0]['attributes']
  assert dt(a['Election_Date']).date().isoformat()=='2026-11-03'
  day=dt(a['Date_Updated']).date().isoformat();sites={k:a[v] for k,v in FIELDS.items()}
  assert all(isinstance(v,(int,float)) and v>=0 and v==int(v) for v in sites.values())
  assert sum(sites.values())<=a['EV_Total']
  return day,a,sites
 def stale(snapshot_day,snapshot,site_values):
  return any(d<snapshot_day and r['sites']==site_values and r['countyCumulative']==snapshot['EV_Total'] for d,r in days.items())
 day,a,sites=observation(raw)
 basepath=ROOT/'dist/region.json';base=json.loads(basepath.read_text())
 o=base.setdefault('siteReports',{}).setdefault('loudoun-county',{}).setdefault('2026',{'source':SOURCE,'feed':URL,'siteKeys':list(FIELDS),'history':[],'coverageStart':day,'coverage':'partial'})
 days={r['date']:r for r in o['history']}

 # Reapply every preserved site snapshot. The live ArcGIS layer exposes only
 # its latest day.
 archived=[]
 dest=ROOT/'sources/site-snapshots/loudoun';dest.mkdir(parents=True,exist_ok=True)
 for path in sorted(dest.glob('*.json')):
  archived.append(path.read_text())
 # Same-day snapshots can share Date_Updated while EV_Total catches up, so the
 # larger cumulative wins regardless of file-name order.
 key=lambda t:(lambda x:(x['Date_Updated'],x['EV_Total']))(json.loads(t)['features'][0]['attributes'])
 for text in sorted(archived+[raw],key=key):
  snapshot_day,snapshot,site_values=observation(text)
  if stale(snapshot_day,snapshot,site_values):continue
  days[snapshot_day]={'date':snapshot_day,'sites':site_values,'early':sum(site_values.values()),'countyCumulative':snapshot['EV_Total'],'reportedAt':dt(snapshot['Date_Updated']).isoformat()}
 if days.get(day,{}).get('reportedAt')!=dt(a['Date_Updated']).isoformat():
  print(json.dumps({'source':'Loudoun dashboard','changed':False,'stale':True,'activityDate':day,'countyCumulative':a['EV_Total']}));return
 o['history']=[days[d] for d in sorted(days)];o['coverageStart']=min(days)
 # EV_Total matches DAL's cumulative early in-person count; its mail fields use
 # different definitions, so only early voting is used before DAL arrives.
 from provisional import record as provisional
 provisional('loudoun-county',day,{'early':a['EV_Total']},'Loudoun County dashboard',dt(a['Date_Updated']).isoformat(),base)
 content=json.dumps(base,separators=(',',':'));changed=content!=basepath.read_text()
 if changed:
  temp=basepath.with_suffix('.tmp');temp.write_text(content);temp.replace(basepath)
 digest=hashlib.sha256(raw.encode()).hexdigest()[:12];snapshot_path=dest/(day+'-'+digest+'.json')
 if not snapshot_path.exists():snapshot_path.write_text(raw)
 if changed:
  from status_log import record
  record('Loudoun County dashboard','Updated daily voting-site counts.',day,o.get('source'))
 print(json.dumps({'source':'Loudoun dashboard','changed':changed,'activityDate':day,'dailyBySite':sites,'countyCumulative':a['EV_Total']}))
if __name__=='__main__':main()
