import test from 'node:test';import assert from 'node:assert/strict';
import {SeoJobs} from '../seo-jobs.js';
test('background analysis deduplicates, persists result, preserves failure and recovers interrupted work',async()=>{
 const state={reports:[{id:'base',analysisPrompt:'evidence'}]};let release,calls=0;
 const store={mutate:async fn=>fn(state),seoSaved:async id=>structuredClone(state.reports.find(r=>r.id===id)),seoNarrative:async({text})=>{const r={id:'result',narrative:text,analysisJob:{status:'completed'}};state.reports.push(r);return r;}};
 const jobs=new SeoJobs(store,async()=>{calls++;return new Promise(r=>release=r);});await jobs.start({id:'base'});await jobs.start({id:'base'});assert.equal(calls,1);release('analysis');await jobs.pending;assert.equal((await jobs.status('base')).report.narrative,'analysis');assert.equal((await jobs.status('result')).job.status,'completed');
 state.reports.push({id:'failure'});jobs.complete=async()=>{throw Error('model unavailable');};await jobs.start({id:'failure'});await jobs.pending;assert.equal((await jobs.status('failure')).job.status,'failed');assert.equal(state.reports[0].analysisPrompt,'evidence');
 state.reports.push({id:'interrupted',analysisJob:{status:'running'}});await jobs.recover();assert.equal((await jobs.status('interrupted')).job.status,'failed');
});
