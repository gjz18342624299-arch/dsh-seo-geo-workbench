import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import vm from 'node:vm';
import {QuestionJobs} from '../question-jobs.js';import {Store} from '../store.js';import {exampleState as initialState} from '../analysis.js';
const qa=new URL('../../qa-v013/',import.meta.url);await mkdir(qa,{recursive:true});
test('question job survives UI detachment, prevents duplicate submit, and recovers restart',async()=>{
 const root=await mkdtemp(new URL('job-',qa));const store=new Store(root);let finish;const gate=new Promise(r=>finish=r);const jobs=new QuestionJobs(store,()=>gate);
 await jobs.start({prompt:'生成品牌问题'});assert.equal((await store.read()).questionJob.status,'running');await assert.rejects(()=>jobs.start({prompt:'重复'}),/正在后台/);
 finish('品牌适合什么用户？');await jobs.pending;assert.equal((await new Store(root).read()).questionJob.text,'品牌适合什么用户？');
 await store.mutate(s=>{s.questionJob.status='running'});await new QuestionJobs(store,()=>{}).recover();assert.equal((await store.read()).questionJob.status,'interrupted');
});
test('question errors persist without overwriting records',async()=>{
 const store=new Store(await mkdtemp(new URL('fail-',qa)));await store.mutate(s=>s.records.push({id:'keep'}));const jobs=new QuestionJobs(store,async()=>{throw Error('model unavailable')});await jobs.start({prompt:'test'});await jobs.pending;const s=await store.read();assert.equal(s.questionJob.status,'failed');assert.equal(s.records[0].id,'keep');
});
test('all primary views render with full onboarding and neutral model default',async()=>{
 const original=await readFile(new URL('../client.js',import.meta.url),'utf8');
 for(const view of ['action','board','collect','evidence','reports','settings']){
 const state=initialState();state.credStatus={};
 let source=original.replace('return {App,call};','globalThis.testApp=App; return {App,call};').replace('[state,setState]=useState(null)','[state,setState]=useState(globalThis.fixture)').replace("[view,setView]=useState('board')",`[view,setView]=useState('${view}')`).replace('[brand,setBrand]=useState(null)','[brand,setBrand]=useState(globalThis.fixture.brand)');
 const React={createElement:(type,props,...children)=>({type,props,children}),Fragment:'fragment',useState:x=>[typeof x==='function'?x():x,()=>{}],useEffect:()=>{},useRef:x=>({current:x})};
 const ctx={fixture:state,localStorage:{getItem:()=>null},window:{__ModuleLoader__:{load:m=>{ctx.mod=m}}},console,URL,Date,setTimeout,clearTimeout,AbortController};vm.createContext(ctx);vm.runInContext(source,ctx);ctx.mod.factory(n=>{if(n==='react')return React;throw Error(n)});const tree=ctx.testApp({runtime:null,onClose:()=>{}});const text=JSON.stringify(tree);assert.ok(text.length>300,view);if(view==='settings'){assert.match(text,/安装浏览器扩展/);assert.match(text,/Microsoft Edge/);assert.match(text,/Firefox/);}assert.doesNotMatch(text,/tokenrouterdsh/);
 }
});
test('report questions create dedicated sessions and reuse only the same report',async()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const source=(await readFile(new URL('../client.js',import.meta.url),'utf8')).replace('return {App,call};','globalThis.askReport=runVisible; return {App,call};');
 const React={createElement:()=>null,useState:()=>[],useEffect:()=>{},useRef:()=>({})};
 const configured=[];
 const ctx={localStorage:storage,fetch:async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/workspace-directory'))return {ok:true,json:async()=>({exists:true})};if(body.catalog)return {ok:true,json:async()=>({default:{provider:'default-provider',model:'default-model'}})};configured.push(body);return {ok:true,json:async()=>body};},window:{__ModuleLoader__:{load:m=>ctx.mod=m}},console,Date,setTimeout};vm.createContext(ctx);vm.runInContext(source,ctx);ctx.mod.factory(()=>React);
 const sessions=new Map(),opened=[];let counter=0;
 const runtime={sessions:{list:{},create:async()=>{const id='dedicated-'+(++counter);const events=[];sessions.set(id,{eventSource:{getSnapshot:()=>({entries:events})},getSnapshot:()=>({running:false,pendingSubmissions:[]}),prompt:async()=>{events.push({seq:events.length+1,type:'assistant/message',data:{content:'基于报告的回答'}},{seq:events.length+2,type:'turn/end'});return {ok:true};}});return id;},binding:id=>({session:sessions.get(id)})},uiWorkspace:{selection:{getSnapshot:()=>({sessionId:opened.at(-1)})},pickDirectory:async()=>'/confirmed-project'}};
 runtime.desktopWorkbenches={isActive:()=>true,ownsSession:id=>sessions.has(id),ensureSession:async({sessionId})=>{const id=sessionId||await runtime.sessions.create();opened.push(id);return id;}};
 await ctx.askReport(runtime,'Q1',undefined,undefined,'report-A');await ctx.askReport(runtime,'Q2',undefined,undefined,'report-A',{provider:'selected-provider',model:'selected-model'});await ctx.askReport(runtime,'Q3',undefined,undefined,'report-B');assert.deepEqual(opened,['dedicated-1','dedicated-1','dedicated-2']);assert.equal(counter,2);
 assert.deepEqual(configured,[{sessionId:'dedicated-1',provider:'default-provider',model:'default-model'},{sessionId:'dedicated-1',provider:'selected-provider',model:'selected-model'},{sessionId:'dedicated-2',provider:'default-provider',model:'default-model'}]);
});
