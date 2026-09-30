import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {Store} from '../store.js';
import {SeoJobs} from '../seo-jobs.js';
import {QuestionJobs} from '../question-jobs.js';
import {exampleState} from '../analysis.js';

test('idle recovery is read-only and cannot fail due to an unrelated write lock',async()=>{
 let writes=0;const store={read:async()=>({reports:[],questionJob:{status:'completed'}}),mutate:async()=>{writes++;throw Error('EPERM');}};
 await new SeoJobs(store,()=>{}).recover();await new QuestionJobs(store,()=>{}).recover();assert.equal(writes,0);
});
test('backend API is registered even when every startup recovery write is blocked',async()=>{
 const src=await readFile(new URL('../index.js',import.meta.url),'utf8');
 const apply=src.slice(src.indexOf('export async function apply')).replace('export async function apply','async function apply').replaceAll('import.meta.url',JSON.stringify(new URL('../index.js',import.meta.url).href));
 const state=exampleState();state.tasks=[{status:'running'}];state.legacyMigrated=false;state.questionJob={status:'running'};state.reports=[{analysisJob:{status:'running'}}];
 let attempts=0;const routes=[],errors=[];
 class BlockedStore {async read(){return structuredClone(state);}async mutate(){attempts++;throw Object.assign(Error('file locked'),{code:'EPERM'});}}
 class FakeCollector {bridge={start:async()=>{}};close=async()=>{};}
 const context={Store:BlockedStore,Collector:FakeCollector,SeoJobs,QuestionJobs,resolveDataRoot:async()=>'/user/project',dirname,join,fileURLToPath,defineTool:x=>x,createHandler:()=>()=>{},readSeoReport:()=>{},setInterval:()=>1,setTimeout:()=>2,clearInterval:()=>{},clearTimeout:()=>{},console:{error:(...a)=>errors.push(a.join(' '))}};
 vm.createContext(context);vm.runInContext(apply+'\nglobalThis.run=apply;',context);
 await context.run({settings:{},tools:{register:()=>()=>{}},effect:fn=>fn(),webServer:{register:r=>{routes.push(r);return()=>{};}}});
 assert.equal(attempts,4);assert.equal(errors.length,4);assert.equal(routes.length,1);assert.equal(routes[0].path,'/api/seo-geo-v3');
});
test('atomic save does not reuse a stale shared temp file and preserves a valid state',async()=>{
 const qa=new URL('../../fix-startup-20260930/tests/',import.meta.url);await mkdir(qa,{recursive:true});
 const root=await mkdtemp(new URL('atomic-',qa)),store=new Store(root);await mkdir(dirname(store.file),{recursive:true});
 await writeFile(store.file+'.tmp','stale writer content');
 await store.mutate(s=>{s.brand.name='Preserved brand';});
 assert.equal((await store.read()).brand.name,'Preserved brand');
 assert.equal(await readFile(store.file+'.tmp','utf8'),'stale writer content');
 assert.deepEqual((await readdir(dirname(store.file))).filter(n=>/\.\d+\..*\.tmp$/.test(n)),[]);
});
test('frontend explains missing backend and preserves structured API errors',async()=>{
 const original=await readFile(new URL('../client.js',import.meta.url),'utf8');
 let response={status:404,ok:false,json:async()=>{throw new SyntaxError('not found');}};
 const context={localStorage:{getItem:()=>null},window:{__ModuleLoader__:{load:m=>{context.module=m;}}},fetch:async()=>response,console,URL,Date,setTimeout};
 vm.createContext(context);vm.runInContext(original.replace('return {App,call};','globalThis.testCall=call; return {App,call};'),context);context.module.factory(()=>({createElement:()=>{}}));
 await assert.rejects(()=>context.testCall('state'),/后台尚未加载成功/);
 response={status:503,ok:false,json:async()=>{throw Error('not JSON');}};await assert.rejects(()=>context.testCall('state'),/HTTP 503/);
 response={status:400,ok:false,json:async()=>({error:'原始业务错误'})};await assert.rejects(()=>context.testCall('state'),/原始业务错误/);
 response={status:200,ok:true,json:async()=>({records:[]})};assert.deepEqual(await context.testCall('state'),{records:[]});
});
