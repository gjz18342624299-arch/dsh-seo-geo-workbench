// Verify production analysis.js auto-judge against the real state snapshot.
import {readFile} from 'node:fs/promises';
import {analyse,autoJudgeEntity,initialState} from '../analysis.js';
const s=JSON.parse(await readFile(new URL('../../monitor-v3/state.json',import.meta.url),'utf8'));
s.brand={...initialState().brand,...s.brand};

// 1) Per-batch auto-judge agreement with yesterday's manual labels
const geo=s.records.filter(r=>r.kind==='geo'&&r.eligible&&!r.invalidatedAt);
const taskBatch=new Map(s.tasks.map(t=>[t.id,t.batchId]));
let agree=0,disagree=0,judged=0;
for(const r of geo){
  if(!r.entity)continue;
  judged++;
  const auto=autoJudgeEntity(r,s.brand);
  if(r.entity===auto.entity||(r.entity==='unknown'&&!auto.entity))agree++;
  else{disagree++;console.log('disagree:',r.id.slice(0,8),'manual='+r.entity,'auto='+(auto.entity||'none'),r.platform,(r.question||'').slice(0,26),JSON.stringify(auto.signals));}
}
console.log(`manual-judged ${judged}: agree ${agree}, disagree ${disagree}`);

// 2) Full analyse on the 97-record batch (2026-09-22)
const a=analyse(s,{cbatch:'47bf4bb4-9ee1-4eb2-918f-b5c4df6e3a60'});
console.log('97-batch: geo='+a.geo.length,'mentions='+a.mentions,'cited='+a.cited,'entity=',JSON.stringify(a.entity));
console.log('rate(ours/geo)='+(100*a.entity.ours/a.geo.length).toFixed(1)+'%');
console.log('foundNotCited=',JSON.stringify(a.foundNotCited));
for(const r of a.geo.filter(r=>a.foundNotCited.ids.includes(r.id)))console.log('  fnc:',r.platform,'|',(r.question||'').slice(0,28),'| tier:',Array.isArray(r.searchedSources)?'检索列表':'正文信号');
console.log('byPlatform sample:',JSON.stringify(a.byPlatform.slice(0,3)));
const autoExample=a.geo.find(r=>r.entitySource==='auto');
console.log('auto example:',autoExample.id.slice(0,8),autoExample.entityEffective,JSON.stringify(autoExample.entitySignals));

// 3) Yesterday's batch via analyse (manual must win over auto)
const b=analyse(s,{cbatch:'835dcd4d-c1af-4cdd-a90e-f87a0c6bc082'});
console.log('yesterday batch: entity=',JSON.stringify(b.entity));
const manualOurs=b.geo.filter(r=>r.entity==='ours');
console.log('manual ours kept:',manualOurs.every(r=>r.entityEffective==='ours'&&r.entitySource==='manual'));
