"""Load Fairfax's final April 21, 2026 special election report into official['2026-special'].
The saved PDF text is parsed and reconciled like the live November report; rerunning is a no-op."""
import hashlib,json
from pathlib import Path
from refresh_fairfax import parse
R=Path(__file__).resolve().parent
PDF=R/'sources/fairfax-snapshots/april-2026-special/2026-04-24-61050ee3accb.pdf'
URL='https://www.fairfaxcounty.gov/elections/sites/elections/files/Assets/Documents/PDF/AB_Daily_Report_Apr-21-2026.pdf'
def main():
 digest=hashlib.sha256(PDF.read_bytes()).hexdigest()
 o=parse(PDF.with_suffix('.txt').read_text(),URL,digest,election='April 21, 2026',election_day='2026-04-21')
 o['final']=True
 p=R/'dist/region.json';d=json.loads(p.read_text())
 if d['official'].get('2026-special')==o:
  print(json.dumps({'changed':False}));return
 d['official']['2026-special']=o
 tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(d,separators=(',',':')));tmp.replace(p)
 from status_log import record
 record('Fairfax County PDF','Loaded the county’s final April 2026 special election report; its totals now replace the Daily Absentee List counts for Fairfax.',o['activityThrough'],URL)
 print(json.dumps({'changed':True,'activityThrough':o['activityThrough'],'total':sum(o['history'][-1]['cumulative'][k] for k in ['early','postal','dropbox'])}))
if __name__=='__main__':main()
