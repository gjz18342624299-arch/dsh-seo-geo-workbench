// Re-append SEO tests in proper UTF-8 (removes the mojibake block appended via PowerShell).
import {readFileSync,writeFileSync} from 'node:fs';
const p='test/analysis.test.mjs';
let t=readFileSync(p,'utf8');
const marker="test('SEO aggregation:";
const i=t.indexOf(marker);
if(i<0)throw Error('marker not found');
// walk back to the start of that line
const lineStart=t.lastIndexOf('\n',i)+1;
t=t.slice(0,lineStart);
t+=`
test('SEO aggregation: totals, weighted position, halves trend and rule actions',()=>{
  const s=initialState();s.imports=[{id:'b1'}];
  const rec=(id,kind,fields)=>({id,kind,source:'imported',batchId:'b1',platform:'',group:'',mode:'',locale:'',region:'',location:'',date:'',question:'',answer:'',citations:[],raw:{},keyword:'',page:'',channel:'',clicks:null,impressions:null,position:null,visits:null,downloads:null,eligible:true,entity:'',entitySource:'',...fields});
  s.records=[
    rec('k1','seo',{keyword:'dsh desktop',date:'2026-09-01',clicks:10,impressions:500,position:6}),
    rec('k2','seo',{keyword:'dsh desktop',date:'2026-09-10',clicks:30,impressions:500,position:4}),
    rec('k3','seo',{keyword:'deepseek harness',date:'2026-09-10',clicks:0,impressions:300,position:8}),
    rec('t1','traffic',{channel:'organic',date:'2026-09-01',visits:100,downloads:10}),
    rec('t2','traffic',{channel:'organic',date:'2026-09-10',visits:40,downloads:4}),
  ];
  const a=analyse(s);
  assert.equal(a.seoAgg.totals.clicks,40);
  assert.equal(a.seoAgg.totals.impressions,1300);
  assert.ok(Math.abs(a.seoAgg.totals.ctr-40/1300)<1e-9);
  assert.ok(Math.abs(a.seoAgg.totals.position-(6*500+4*500+8*300)/1300)<1e-9);
  assert.equal(a.seoAgg.totals.visits,140);assert.equal(a.seoAgg.totals.downloads,14);
  const kw=a.seoAgg.keywords.find(k=>k.name==='dsh desktop');
  assert.equal(kw.clicks,40);assert.equal(kw.trend,2);
  assert.equal(a.seoAgg.range.mid,'2026-09-10');assert.equal(a.seoAgg.range.days,2);
  assert.equal(a.seoAgg.channels[0].name,'organic');assert.equal(a.seoAgg.channels[0].visitTrend,-0.6);
  assert.ok(a.seoActions.some(x=>x.title.includes('冲刺前三')));
  assert.ok(a.seoActions.some(x=>x.title.includes('零点击')));
  assert.ok(a.seoActions.some(x=>x.title.includes('访问量环比下滑')));
});
test('SEO report HTML contains summary cards, tables and honest legend',async()=>{
  const store=new Store(await mkdtemp(join(root,'seoreport-')));
  await store.mutate(s=>{s.imports.push({id:'b1',name:'t',kind:'seo',createdAt:''});
    s.records.push({id:'k1',kind:'seo',source:'imported',batchId:'b1',platform:'',group:'',mode:'',locale:'',region:'',location:'',date:'2026-09-01',question:'',answer:'',citations:[],raw:{},keyword:'dsh desktop',page:'',channel:'',clicks:10,impressions:500,position:6,visits:null,downloads:null,eligible:true,entity:'',entitySource:''});});
  const r=await store.seoReport({source:''});
  assert.match(r.text,/SEO 数据报告/);assert.match(r.text,/总点击/);assert.match(r.text,/dsh desktop/);assert.match(r.text,/判断口径/);
  assert.match(await readFile(r.path,'utf8'),/执行摘要/);
});
`;
writeFileSync(p,t);
console.log('appended OK');
