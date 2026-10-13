import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Store} from '../store.js';import {exampleState,weeklyAnalyses,weekStart,classifyAiReferrer} from '../analysis.js';
const root=fileURLToPath(new URL('../../qa-v016/unit/',import.meta.url));await mkdir(root,{recursive:true});
test('brand spaces retain records, credentials and delayed background work after switching',async()=>{
 const store=new Store(await mkdtemp(path.join(root,'brand-')));const s=exampleState();s.records=[{id:'history',kind:'geo'}];s.credentials={bingApiKey:'TEST_SENTINEL'};await store.mutate(x=>Object.assign(x,s));
 const old=(await store.read()).activeBrandId;let release;const gate=new Promise(r=>release=r);
 const pending=store.withBrand(old,async()=>{await gate;await store.mutate(x=>x.records.push({id:'late'}));});
 const {id}=await store.action({type:'brand.create',name:'Other'});assert.notEqual(id,old);assert.equal((await store.read()).records.length,0);assert.deepEqual((await store.read()).credentials,{});
 await store.action({type:'brand.save',brand:{name:'Other',aliases:['Other'],officialUrl:'https://other.example',competitors:[],entityRivals:[]}});
 release();await pending;assert.equal((await store.read()).records.length,0);
 await store.action({type:'brand.switch',id:old});assert.deepEqual((await store.read()).records.map(x=>x.id),['history','late']);assert.equal((await store.read()).credentials.bingApiKey,'TEST_SENTINEL');assert.equal((await store.read()).brand.officialUrl,'https://dshdesktop.com');
 const restored=new Store(store.root);assert.equal((await restored.read()).brands.length,2);assert.equal((await restored.read()).records.length,2);
 await assert.rejects(()=>store.withBrand('missing',()=>store.action({type:'tasks.add'})),/品牌不存在/);
});
test('weekly statistics follow Shanghai Monday boundaries, preserve missing weeks, exclude cumulative and ranged records',()=>{
 const s=exampleState();s.records=[{id:'sun',kind:'geo',source:'official_web',eligible:true,date:'2026-10-11T15:59:59Z',answer:'DSH Desktop',citations:[],entity:'ours'}, {id:'mon',kind:'geo',source:'official_web',eligible:true,date:'2026-10-11T16:00:00Z',answer:'DSH Desktop',citations:[],entity:'ours'}, {id:'snapshot',kind:'seo',date:'2026-10-05',dimension:'snapshot',impressions:9000}, {id:'period',kind:'traffic',date:'2026-10-05',periodFrom:'2026-09-01',periodTo:'2026-10-05',visits:5000}];
 const weeks=weeklyAnalyses(s,3,{},new Date('2026-10-12T05:00:00Z'));assert.equal(weekStart('2026-10-11T16:00:00Z'),'2026-10-12');assert.deepEqual(weeks.map(w=>w.total),[0,1,1]);assert.equal(weeks.at(-1).current,true);assert.equal(weeks[1].a.traffic.length,0);assert.equal(weeks[1].a.seo.length,0);
});
test('AI referrer classification is domain based and rejects misleading llm or .ai domains',()=>{
 for(const domain of ['llm.ustc.edu.cn','clawith.ai','notchatgpt.com','chatgpt.com.bad.example','https://bad.example/chatgpt.com'])assert.equal(classifyAiReferrer(domain),null,domain);
 assert.equal(classifyAiReferrer('https://chatgpt.com/a'),'ChatGPT');assert.equal(classifyAiReferrer('www.doubao.com'),'豆包');
});

test('latest keywords keep snapshot dates, discard revoked and page associations without adding to weeks',async()=>{
 const {latestKeywordSnapshots}=await import('../analysis.js');const s=exampleState();s.imports=[{id:'bing',api:true,provider:'bing'},{id:'revoked',revoked:true}];s.records=[
 {id:'old',batchId:'bing',kind:'seo',keyword:'desktop',date:'2026-09-25',dimension:'snapshot-query',clicks:1,impressions:100,position:8},
 {id:'new',batchId:'bing',kind:'seo',keyword:'desktop',date:'2026-10-09',dimension:'snapshot-query',clicks:3,impressions:120,position:5},
 {id:'pair',batchId:'bing',kind:'seo',keyword:'desktop',page:'https://example.com/',date:'2026-10-09',dimension:'snapshot-query-page',clicks:2,impressions:80,position:6},
 {id:'bad',batchId:'revoked',kind:'seo',keyword:'revoked',date:'2026-10-09',dimension:'snapshot-query'}];
 const keys=latestKeywordSnapshots(s);assert.equal(keys.length,1);assert.equal(keys[0].date,'2026-10-09');assert.equal(keys[0].impressions,120);assert.equal(keys[0].ctr,0.025);assert.equal(weeklyAnalyses(s,2,{},new Date('2026-10-13')).reduce((n,w)=>n+w.a.seo.length,0),0);
});
