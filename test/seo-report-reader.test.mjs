import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readSeoReport} from '../seo-report-reader.js';
const r={id:'frozen-id',options:{sources:[]},sources:[],records:Array.from({length:51},(_,i)=>({id:String(i),source:'gsc',clicks:i,downloads:null,raw:{secret:'HIDDEN'}})),snapshots:[],warnings:[],narrative:'优先优化落地页',credentials:{token:'HIDDEN'}};
const store={seoSaved:async id=>{assert.equal(id,r.id);return r;}};
test('reader retains frozen narrative and pages evidence without raw or credentials',async()=>{
 const summary=JSON.parse(await readSeoReport(store,{reportId:r.id}));assert.equal(summary.narrative,r.narrative);assert.equal(summary.evidenceCounts.current,51);assert.ok(!JSON.stringify(summary).includes('HIDDEN'));
 const first=JSON.parse(await readSeoReport(store,{reportId:r.id,section:'evidence'}));assert.equal(first.records.length,50);assert.equal(first.nextOffset,50);assert.ok(!JSON.stringify(first).includes('HIDDEN'));
 const last=JSON.parse(await readSeoReport(store,{reportId:r.id,section:'evidence',offset:'50'}));assert.equal(last.records[0].id,'50');assert.equal(last.nextOffset,null);
 await assert.rejects(readSeoReport(store,{reportId:r.id,offset:'-1'}));await assert.rejects(readSeoReport(store,{reportId:r.id,section:'state'}));
});
test('actual SEO handoff sends a short prompt even with a large report',async()=>{
 const src=await readFile(new URL('../client.js',import.meta.url),'utf8');const body=src.match(/const askSeo=.*?const prompt=(.*?);setMessage/)[1];
 const make=new Function('seoQuestion','seoDocument','return '+body);
 const prompt=make('',{id:r.id,html:'secret table'.repeat(10000)});assert.ok(prompt.length<180);assert.ok(prompt.includes('seo_report_read'));assert.ok(!prompt.includes('secret table'));
 assert.ok(make('我应该先改哪个页面？',{id:r.id}).startsWith('我应该先改哪个页面？'));
});
