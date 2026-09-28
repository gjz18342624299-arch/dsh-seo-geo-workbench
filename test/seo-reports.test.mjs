import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {seoScope,createSeoSnapshot,seoHtml,seoCsv,seoInsights,seoAnalysisPrompt} from '../seo-reports.js';
import {Store} from '../store.js';
import {normalizeRows,mappingFor} from '../analysis.js';
const options={site:'example.com',sources:['bing','gsc','cloudflare'],from:'2026-09-01',to:'2026-09-02',coverage:'actual',compare:'previous'};
test('conclusions explain evidence limits and actionable targets without inventing growth',()=>{
 const s=fixture();s.records.find(x=>x.id==='g2').clicks=1;
 const r=createSeoSnapshot(s,{...options,compare:'none'}),a=seoInsights(r);
 assert.ok(a.actions.some(x=>x.task.includes('https://example.com/a')));
 assert.ok(a.limits.some(x=>x.includes('不能确认增长')));
 assert.ok(a.findings.some(x=>x.evidence.includes('g2')));
 const h=seoHtml(r);assert.ok(h.indexOf('核心结论与优先行动')<h.indexOf('数据依据与分析范围'));
 assert.ok(h.includes('具体做法'));assert.ok(h.includes('复测'));
 assert.ok(seoAnalysisPrompt(r).includes('omittedRows'));
 const rich=seoHtml({...r,narrative:'## 核心结论\n**保留证据**\n<script>alert(1)</script>'});
 assert.ok(rich.includes('核心结论</h3>'));assert.ok(!rich.includes('<script>'));
});
test('GSC date-range export restores legacy raw columns without inventing daily values',()=>{
 const raw={'日期范围':'2026-09-20 - 2026-09-25','点击次数':'1643','展示':'6228','排名':'3.30'};
 const rows=normalizeRows([raw],mappingFor(Object.keys(raw)),'seo','g');assert.equal(rows[0].date,'');assert.equal(rows[0].periodFrom,'2026-09-20');assert.equal(rows[0].impressions,6228);
 const s={brand:{domain:'example.com'},imports:[{id:'g',sourceLabel:'GSC',name:'example.com-Performance-on-Search-2026-09-28.xlsx'}],records:[{id:'legacy',batchId:'g',kind:'seo',date:'',clicks:1643,position:3.3,impressions:null,raw}]};
 const o={site:'example.com',sources:['gsc'],from:'2026-09-20',to:'2026-09-25',coverage:'actual'};
 const r=createSeoSnapshot(s,o);assert.equal(r.count,1);assert.equal(r.sources[0].days,6);assert.equal(r.sources[0].groups[0].metrics.impressions,6228);assert.equal(r.sources[0].groups[0].metrics.ctr,1643/6228);
 assert.equal(seoScope(s,{...o,from:'2026-09-24'}).count,0);assert.ok(seoScope(s,{...o,from:'2026-09-24'}).warnings.some(w=>w.includes('无法拆分')));
 assert.equal(seoScope(s,{...o,coverage:'common'}).count,1);
 assert.ok(seoHtml(r).includes('无逐日明细'));assert.ok(seoCsv(r,'gsc').includes('periodFrom'));
});
function fixture(){return {brand:{domain:'example.com'},imports:[{id:'b',api:true,provider:'bing',site:'example.com'}],records:[
 {id:'b1',batchId:'b',kind:'seo',date:'2026-09-01',keyword:'（整站）',clicks:2,impressions:100},
 {id:'bs',batchId:'b',kind:'seo',date:'2026-09-02',keyword:'snapshot',clicks:999,impressions:9999},
 {id:'g1',provider:'gsc',site:'example.com',kind:'seo',date:'2026-09-02',keyword:'query',clicks:3,impressions:100},
 {id:'g2',provider:'gsc',site:'example.com',kind:'seo',date:'2026-09-02',page:'https://example.com/a',clicks:3,impressions:100},
 {id:'cf1',provider:'cloudflare',site:'example.com',kind:'traffic',date:'2026-09-02',channel:'Cloudflare 全站',visits:20},
 {id:'cf2',provider:'cloudflare',site:'example.com',kind:'traffic',date:'2026-09-02',channel:'Google',visits:10},
 {id:'other',provider:'gsc',site:'other.com',kind:'seo',date:'2026-09-02',clicks:900},
 {id:'unknown',provider:'gsc',kind:'seo',date:'2026-09-02',clicks:800}
 ]};}
test('scope isolates site, providers, dimensions and cumulative snapshots',()=>{
 const r=seoScope(fixture(),options);assert.equal(r.count,5);assert.equal(r.snapshots.length,1);
 assert.equal(r.sources.find(x=>x.source==='bing').groups[0].metrics.clicks,2);
 assert.equal(r.sources.find(x=>x.source==='gsc').groups.length,2);
 assert.equal(r.sources.find(x=>x.source==='cloudflare').groups.length,2);
 assert.equal(r.comparison.from,'2026-08-30');assert.equal(r.comparison.to,'2026-08-31');
 assert.equal(seoScope(fixture(),{...options,coverage:'common'}).count,0);
 assert.equal(seoScope(fixture(),{...options,includeUnknownSite:true}).count,6);
 assert.throws(()=>createSeoSnapshot(fixture(),{...options,coverage:'common'}),/没有可分析/);
 assert.throws(()=>seoScope(fixture(),{...options,from:'2026-02-30'}),/有效日期/);
 assert.throws(()=>seoScope(fixture(),{...options,compare:'custom',compareFrom:'2026-09-01',compareTo:'2026-09-02'}),/之前/);
});
test('frozen snapshot and safe export do not pick up new records or HTML/formulas',()=>{
 const s=fixture();s.records[2].keyword='=HYPERLINK("evil")<script>alert(1)</script>';
 const r=createSeoSnapshot(s,options),before=seoHtml(r);s.records[2].clicks=999;s.records.push({...s.records[2],id:'new'});
 assert.equal(seoHtml(r),before);assert.ok(!before.includes('<script>'));assert.ok(seoCsv(r,'gsc').includes("'=HYPERLINK"));
 assert.throws(()=>seoCsv(r,'unknown'),/未选择/);
});
test('sync keeps same-key Bing and GSC records separate; report exports remain fixed',async()=>{
 const root=await mkdtemp(fileURLToPath(new URL('../../qa-seo-report-',import.meta.url)));const store=new Store(root);
 try{
  const row={kind:'seo',date:'2026-09-01',keyword:'keyword',clicks:3,impressions:100};
  await store.addSyncBatch({kind:'seo',sourceLabel:'Bing',site:'example.com',records:[row]});
  await store.addSyncBatch({kind:'seo',sourceLabel:'Google Search Console',site:'example.com',records:[row]});
  assert.equal((await store.read()).records.length,2);
  await store.addSyncBatch({kind:'seo',sourceLabel:'Bing',site:'example.com',records:[{...row,clicks:4}]});
  assert.equal((await store.read()).records.length,2);
  const report=await store.seoSnapshot({...options,sources:['gsc'],compare:'none'});
  await store.addSyncBatch({kind:'seo',sourceLabel:'Google Search Console',site:'example.com',records:[{...row,clicks:99}]});
  assert.equal((await store.seoSaved(report.id)).records[0].clicks,3);
  const narrative=await store.seoNarrative({id:report.id,text:'分析仅覆盖固定版本 <script>bad</script>'});
  assert.notEqual(narrative.id,report.id);assert.equal(narrative.parentId,report.id);assert.equal(narrative.records[0].clicks,3);
  assert.ok(!narrative.html.includes('<script>'));assert.equal((await store.seoSaved(report.id)).narrative,undefined);
  const html=await store.seoExport({id:report.id,format:'html'});assert.equal(await readFile(html.path,'utf8'),report.html);
  const csv=await store.seoExport({id:report.id,format:'csv',source:'gsc'});assert.ok(csv.text.includes('current'));
  const pdf=await store.seoExport({id:report.id,format:'pdf'});assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,4).toString(),'%PDF');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('data gaps are limitations, cumulative keywords become bounded optimization experiments',()=>{const r=createSeoSnapshot(fixture(),options);r.snapshots.push({id:'candidate',source:'bing',dimension:'snapshot-query',keyword:'desktop app',impressions:500,clicks:20,position:5,date:'2026-09-02'});const a=seoInsights(r);assert.ok(a.actions.some(x=>x.task.includes('desktop app')&&x.implementation));assert.ok(a.actions.every(x=>!x.task.includes('确认')&&!x.task.includes('补充')));assert.ok(seoAnalysisPrompt(r).includes('cumulativeDiscovery'));});

