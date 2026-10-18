"""Fetch Fairfax's PDF CONTENT every run, including unchanged URLs.
Parse the six-page 2026 report, reconcile daily tables with first-page totals,
archive content-addressed PDFs and replace corrected observations atomically.
Unknown layouts or inconsistent totals fail closed, preserving the last report.
"""
import argparse,hashlib,json,re,subprocess,tempfile,urllib.request,html
from urllib.parse import urljoin, unquote
from source_fetch import fetch_bytes
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
R=Path(__file__).resolve().parent
HOME='https://www.fairfaxcounty.gov/elections/'
KEYS=['government_center','mt_vernon','north_county','burke','centreville','franconia','great_falls','herndon_fortnightly','jim_scott','lorton','mason','mclean','sully','thomas_jefferson','tysons_pimmit','west_springfield']
def fetch(url):return fetch_bytes(url)
def parse(text,url,digest):
 pages=text.split('\f');assert len(pages)>=6,'Unexpected PDF layout'
 first=pages[0]
 match=re.search(r'\b(\d{1,2}/\d{1,2}/(?:2026|26))\b',first);assert match,'Missing or unrecognized report date'
 report=datetime.strptime(match[1],'%m/%d/%Y' if len(match[1].split('/')[-1])==4 else '%m/%d/%y').date().isoformat()
 assert 'November 3, 2026' in first
 def nums(s):return [int(n.replace(',','')) for n in re.findall(r'(?<![\w.])\d[\d,]*(?![\w.])',s)]
 head=next(line for line in first.splitlines() if line.strip().startswith('Total '));totals=nums(head)[:6];registered,sent,postal,dropbox,early=totals[:5]
 ballot_total=int(re.search(r'Total Ballots Cast\s+([\d,]+)',first)[1].replace(',',''));assert postal+dropbox+early==ballot_total
 by={};tabletotals={};extras={};cutoffs=[]
 for page,metric,title in [(1,'sent','Mailed Absentee'),(2,'postal','Returned by Mail'),(3,'dropbox','Returned by Dropbox'),(4,'early','Early In Person')]:
  assert title in pages[page],(page,title)
  line=next(l for l in pages[page].splitlines() if re.match(r'^\s*Total\s+\d',l));tt=nums(line);tabletotals[metric]=tt[0]
  if metric=='sent':extras.update(dict(zip(['mailedDomestic','UOCAVApostal','email'],tt[1:4])))
  if metric=='postal':extras['undeliverable']=tt[2]
  if metric=='dropbox':extras.update(dict(zip(['dropbox24Hour','dropboxEarlyVotingSites'],tt[1:3])))
  for line in pages[page].splitlines():
   m=re.match(r'^\s*(\d{1,2}-[A-Za-z]{3})\s+(.*)',line)
   if not m:continue
   day=datetime.strptime(m[1]+'-2026','%d-%b-%Y').date().isoformat();vs=nums(m[2])
   # A lone template zero is not an observation. Full detail verifies activity.
   if len(vs)<2:continue
   assert day<=report, ('Detailed activity after report date',day,report)
   row=by.setdefault(day,{'date':day,'sites':{}});row[metric]=vs[0];cutoffs.append(day)
   if metric=='early':
    assert len(vs)-1 in (3,16), 'Unexpected site columns; review the PDF layout'
    row['sites']={k:vs[i+1] if i+1<len(vs) else None for i,k in enumerate(KEYS)}
    assert sum(v for v in row['sites'].values() if v is not None)==vs[0],day
 last=max(cutoffs);c={k:0 for k in tabletotals};history=[]
 for day,row in sorted(by.items()):
  for k in c:
   row.setdefault(k,None);c[k]+=row[k] or 0
  history.append({**row,'cumulative':dict(c)})
 assert c==tabletotals,(c,tabletotals)
 assert c==dict(sent=sent,postal=postal,dropbox=dropbox,early=early)
 sw=nums(next(l for l in pages[5].splitlines() if re.match(r'^\s*Total\s+\d',l)))
 extras.update(switchedTotal=sw[0],switchedNotSurrendered=sw[1],switchedSurrendered=sw[2]);assert sw[0]==sw[1]+sw[2]
 return {'source':url,'reportDate':report,'activityThrough':last,'contentHash':digest,'registered':registered,'siteKeys':KEYS,'history':history,'extras':extras}
def main():
 a=argparse.ArgumentParser();a.add_argument('--file',type=Path);args=a.parse_args()
 page=fetch(HOME).decode();urls=[urljoin(HOME,html.unescape(u)) for u in re.findall(r'href=["\']([^"\']+)',page) if 'ab daily' in unquote(u).lower() and '.pdf' in u.lower()];assert urls,'No report link found'
 url=urls[-1];raw=args.file.read_bytes() if args.file else fetch(url);digest=hashlib.sha256(raw).hexdigest()
 assert raw.startswith(b'%PDF-'),'County report download is not a PDF'
 p=R/'dist/region.json';d=json.loads(p.read_text());old=d['official']['2026']
 if old.get('contentHash')==digest:
  print(json.dumps({'changed':False,'reportDate':old['reportDate'],'activityThrough':old['activityThrough']}));return
 # Keep a dated copy of every new PDF before parsing, so reports that fail to
 # parse or reconcile are still preserved for review.
 dest=R/'sources/fairfax-snapshots';dest.mkdir(exist_ok=True);saved=sorted(dest.glob('*-'+digest[:12]+'.pdf'))
 pending=saved[0] if saved else dest/('retrieved-'+datetime.now(ZoneInfo('America/New_York')).date().isoformat()+'-'+digest[:12]+'.pdf')
 if not saved:pending.write_bytes(raw)
 with tempfile.TemporaryDirectory() as td:
  pdf=Path(td)/'report.pdf';out=Path(td)/'report.txt';pdf.write_bytes(raw);subprocess.run(['pdftotext','-layout',str(pdf),str(out)],check=True,capture_output=True);text=out.read_text();o=parse(text,url,digest)
 assert o['activityThrough']>=old['activityThrough'],'Report coverage regressed; retain saved observations and review'
 if old.get('userReport'):o['userReport']=old['userReport']
 d['official']['2026']=o
 content=json.dumps(d,separators=(',',':'));changed=content!=p.read_text()
 final=dest/(o['reportDate']+'-'+digest[:12]+'.pdf')
 if pending!=final:pending.replace(final)
 final.with_suffix('.txt').write_text(text)
 if changed:
  tmp=p.with_suffix('.tmp');tmp.write_text(content);tmp.replace(p)
 if changed:
  from status_log import record
  record('Fairfax County PDF','Loaded county totals, mail-return details and voting-site counts.',o['activityThrough'],url)
 print(json.dumps({'changed':changed,'reportDate':o['reportDate'],'activityThrough':o['activityThrough'],'snapshot':final.relative_to(R).as_posix(),'total':sum(o['history'][-1]['cumulative'][k] for k in ['early','postal','dropbox'])}))
if __name__=='__main__':main()
