import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {syncBing} from '../syncers.js';
import {Store} from '../store.js';
import {weeklyAnalyses,latestKeywordSnapshots} from '../analysis.js';
import {seoScope} from '../seo-reports.js';
test('daily query sync survives reload and resync, excludes snapshots and keeps site totals separate',async()=>{
 const root=await mkdtemp(fileURLToPath(new URL('../../qa-bing-weekly-',import.meta.url))),store=new Store(root),old=globalThis.fetch,calls=[];
 try{
 await store.saveCreds({bingApiKey:'fixture',bingSiteUrl:'https://example.com/'});
 globalThis.fetch=async value=>{const u=new URL(value),endpoint=u.pathname.split('/').at(-1);calls.push({endpoint,query:u.searchParams.get('query')});
 if(endpoint==='GetQueryTrafficStats'&&u.searchParams.get('query')==='failed')throw Error('fixture failure');
 const d=endpoint==='GetQueryStats'?[{Query:'desktop',Date:'2026-10-09',Clicks:99,Impressions:999,AvgImpressionPosition:2},{Query:'desktop',Date:'2026-10-02'},{Query:'failed',Date:'2026-10-09'}]:endpoint==='GetQueryTrafficStats'?[{Date:'2026-10-04',Clicks:4,Impressions:40},{Date:'2026-10-05',Clicks:1,Impressions:10},{Date:'2026-10-09',Clicks:2,Impressions:20},{Date:'2026-10-12',Clicks:5,Impressions:50},{Date:'bad',Clicks:1,Impressions:1},{Date:'2026-10-10',Clicks:1}]:endpoint==='GetRankAndTrafficStats'?[{Date:'2026-10-09',Clicks:100,Impressions:1000}]:[];
 return {ok:true,status:200,text:async()=>JSON.stringify({d})};};
 let result=await syncBing(store);assert.ok(result.note.includes('失败 1 词'));assert.ok(result.note.includes('丢弃 2 行'));
 let state=await store.read();assert.equal(state.records.filter(r=>r.dimension==='query-daily').length,4);assert.equal(latestKeywordSnapshots(state).length,2);
 const week=weeklyAnalyses(state,3,{},new Date('2026-10-13')).find(w=>w.from==='2026-10-05');const keyword=week.a.seoAgg.keywords.find(k=>k.name==='desktop');assert.equal(keyword.clicks,3);assert.equal(keyword.impressions,30);assert.equal(keyword.ctr,0.1);assert.equal(keyword.position,null);assert.equal(week.a.seoAgg.totals.clicks,100);
 const report=seoScope(state,{site:'example.com',sources:['bing'],from:'2026-10-05',to:'2026-10-11',coverage:'actual'});assert.equal(report.records.filter(r=>r.dimension==='query-daily').length,2);assert.equal(report.snapshots.filter(r=>r.keyword==='desktop').length,1);
 const before=state.records.length;await syncBing(store);state=await store.read();assert.equal(state.records.length,before);assert.equal(state.records.filter(r=>r.dimension==='snapshot-query'&&r.keyword==='desktop').length,2);assert.equal(calls.filter(c=>c.endpoint==='GetQueryTrafficStats'&&c.query==='desktop').length,2);
 }finally{globalThis.fetch=old;await rm(root,{recursive:true,force:true});}
});

