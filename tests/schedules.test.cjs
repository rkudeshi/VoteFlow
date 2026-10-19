const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const S=require('../dist/old/v2/schedules.js'),P=require('../dist/old/v2/planning.js');
const raw=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../dist/region.json')));
const data=S.prepare(structuredClone(raw));
test('historical templates do not manufacture weekend openings',()=>{
 const c=data.calendars['fairfax-county']['2025'];
 assert.equal(c.partial,true);assert.equal(c.hours.government_center['2025-09-21'],undefined);
 assert.equal(c.hours.government_center['2025-09-27'],undefined);
 assert.ok(c.hours.government_center['2025-09-20']);
 assert.equal(P.exposure(data,'fairfax-county','2025','2025-09-21'),null);
});
test('schedule normalization is repeatable without changing raw input',()=>{
 const before=JSON.stringify(data.calendars);S.prepare(data);assert.equal(JSON.stringify(data.calendars),before);
 assert.ok(raw.calendars['fairfax-county']['2025'].hours.government_center['2025-09-21']);
});
test('Fairfax groups distinguish Government Center, two early satellites, and remaining sites',()=>{
 const groups=S.groups(data.calendars['fairfax-county']['2026']);assert.deepEqual(groups.map(g=>g.sites.length).sort((a,b)=>a-b),[1,2,13]);
 assert.equal(groups.find(g=>g.sites.length===1).sites[0].key,'government_center');
});
// Freeze Fairfax 2026 at October 15 so the closed days and the Oct 18 Sunday stay in
// the forecast window as daily imports advance.
function asOf(day){
 const r=structuredClone(raw),l=r.elections['2026'].localities.find(x=>x.id==='fairfax-county');
 l.history=l.history.filter(h=>h.date<=day);
 const o=r.official?.['2026'];if(o?.history)o.history=o.history.filter(h=>h.date<=day);
 return S.prepare(r);
}
test('planning predicts zero on verified closed days and permits scheduled weekends',()=>{
 const data=asOf('2026-10-15');
 const result=P.run(data,'fairfax-county','2026');assert.equal(result.hasSchedule,true);
 const closed=result.future.filter(r=>P.exposure(data,'fairfax-county','2026',r.date).hours===0);assert(closed.length>0);
 for(const r of closed){assert.equal(r.mean,0);assert.equal(r.low,0);assert.equal(r.high,0);}
 const sunday=result.future.find(r=>r.date==='2026-10-18');assert(sunday.mean>0);assert(sunday.hours>0);
});
test('unknown schedules do not establish closures or daily readiness',()=>{
 assert.equal(P.exposure(data,'fairfax-city','2026','2026-10-04'),null);
 assert.equal(P.run(data,'fairfax-city','2026').hasSchedule,false);
});
test('hours and date intervals preserve fractional durations and gaps',()=>{
 assert.equal(S.duration(['13:00','19:00']),6);assert.equal(S.duration(['08:00','16:30']),8.5);
 assert.deepEqual(S.dateRuns(['2025-09-19','2025-09-20','2025-09-22']),[['2025-09-19','2025-09-20'],['2025-09-22']]);
});
