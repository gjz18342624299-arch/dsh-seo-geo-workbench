import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir} from 'node:fs/promises';
import {Store} from '../store.js';import {analyse,exampleState,activityFor} from '../analysis.js';
const qa=new URL('../../qa-v015/',import.meta.url);await mkdir(qa,{recursive:true});
const mk=async()=>{const root=await mkdtemp(new URL('case-',qa));const store=new Store(root);await store.mutate(s=>{s.brand=exampleState().brand;});return store;};

test('action.status 标记完成并校验输入',async()=>{
 const store=await mk();
 await store.action({type:'action.status',key:'pending-samples',status:'done'});
 let s=await store.read();assert.equal(s.actionStates['pending-samples'].status,'done');assert.ok(s.actionStates['pending-samples'].doneAt);
 await store.action({type:'action.status',key:'pending-samples',status:'todo'});
 s=await store.read();assert.equal(s.actionStates['pending-samples'].status,'todo');assert.equal(s.actionStates['pending-samples'].doneAt,'');
 await assert.rejects(()=>store.action({type:'action.status',key:'bad key!',status:'done'}),/行动标识无效/);
 await assert.rejects(()=>store.action({type:'action.status',key:'x',status:'bogus'}),/行动状态取值无效/);
});

test('action.retest 复制基准批次的问题与平台并记录状态',async()=>{
 const store=await mk();
 const s0=await store.read();const pid=s0.platforms[0].id,pid2=s0.platforms[1].id;
 await store.action({type:'tasks.add',platformIds:[pid,pid2],questions:['Q1','Q2'],group:'品牌',mode:'联网搜索',repeat:2});
 const r=await store.action({type:'action.retest',key:'pending-samples'});
 assert.ok(r.batchId);
 const s=await store.read();
 const base=s.batches[0],re=s.batches.find(b=>b.id===r.batchId);
 assert.deepEqual(re.questions,base.questions);
 assert.deepEqual(re.platformIds,base.platformIds);
 assert.equal(re.group,base.group);assert.equal(re.mode,base.mode);assert.equal(re.repeat,base.repeat);
 assert.ok(String(re.name).startsWith('复测 · '));
 assert.equal(s.tasks.filter(t=>t.batchId===re.id).length,s.tasks.filter(t=>t.batchId===base.id).length);
 const st=s.actionStates['pending-samples'];
 assert.equal(st.status,'retest');assert.equal(st.baseBatchId,base.id);assert.equal(st.retestBatchId,re.id);assert.ok(st.startedAt);
 await store.action({type:'action.retest.cancel',key:'pending-samples'});
 const again=await store.action({type:'action.retest',key:'pending-samples'});
 assert.equal((await store.read()).actionStates['pending-samples'].baseBatchId,base.id,'cancelled retest must not become the next baseline');
 assert.notEqual(again.batchId,re.id);
 await assert.rejects(()=>store.action({type:'action.retest',key:'bad key!'}),/行动标识无效/);
});

test('activity.add 校验字段，activity.delete 删除',async()=>{
 const store=await mk();
 await store.action({type:'activity.add',title:'发了篇区别说明',category:'帖子',channel:'知乎',url:'https://zhuanlan.zhihu.com/p/123456',date:'2026-03-01',note:'n',actionKey:'check-citable'});
 let s=await store.read();
 assert.equal(s.activities.length,1);
 assert.equal(s.activities[0].type,'帖子');assert.equal(s.activities[0].channel,'知乎');assert.equal(s.activities[0].actionKey,'check-citable');
 await assert.rejects(()=>store.action({type:'activity.add',title:''}),/1-120/);
 await assert.rejects(()=>store.action({type:'activity.add',title:'x'.repeat(121)}),/1-120/);
 await assert.rejects(()=>store.action({type:'activity.add',title:'t',category:'广播'}),/动作类型无效/);
 await assert.rejects(()=>store.action({type:'activity.add',title:'t',url:'ftp://example.com/a'}),/HTTPS/);
 await assert.rejects(()=>store.action({type:'activity.add',title:'t',date:'2026/03/01'}),/YYYY-MM-DD/);
 await store.action({type:'activity.add',title:'只填标题'});
 s=await store.read();assert.equal(s.activities.length,2);
 assert.equal(s.activities[0].title,'只填标题');assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.activities[0].date));
 const id=s.activities[0].id;
 await store.action({type:'activity.delete',id});
 s=await store.read();assert.equal(s.activities.length,1);
 await assert.rejects(()=>store.action({type:'activity.delete',id}),/动作记录不存在/);
});

test('analyse().byBatch 按 state.batches 顺序给出每批计数',async()=>{
 const store=await mk();
 await store.mutate(s=>{
  s.batches.push({id:'b1',name:'批次1',createdAt:Date.parse('2026-03-01T00:00:00Z'),questions:['Q'],platformIds:[],group:'品牌',mode:'联网搜索',repeat:1});
  s.batches.push({id:'b2',name:'批次2',createdAt:Date.parse('2026-03-05T00:00:00Z'),questions:['Q'],platformIds:[],group:'品牌',mode:'联网搜索',repeat:1});
  s.batches.push({id:'b0',name:'空批次',createdAt:Date.parse('2026-03-06T00:00:00Z'),questions:['Q'],platformIds:[],group:'品牌',mode:'联网搜索',repeat:1});
  s.tasks.push({id:'t1',batchId:'b1',status:'completed'},{id:'t2',batchId:'b2',status:'completed'},{id:'t3',batchId:'b2',status:'completed'});
  const rec=(id,taskId,answer,citations,entity)=>({id,kind:'geo',source:'official_web',eligible:true,taskId,platform:'DeepSeek',question:'Q',answer,date:'2026-03-02T00:00:00Z',mode:'联网搜索',locale:'unknown',region:'unknown',group:'品牌',citations:citations||[],searchedSources:[],sourceUrl:'https://example.com/x',screenshotPath:'',issues:[],entity:entity||'',raw:{}});
  s.records.push(rec('r1','t1','DSH Desktop 是 DataElem 的产品',['https://dshdesktop.com/zh/'],'ours'));
  s.records.push(rec('r2','t2','提到 DSH 但说的是 anywhere-labs',[],'rival'));
  s.records.push(rec('r3','t3','DSH Desktop 是 DataElem 的产品',['https://dshdesktop.com/zh/download'],'ours'));
 });
 const a=analyse(await store.read(),{});
 assert.equal(a.byBatch.length,2);
 assert.deepEqual(a.byBatch.map(b=>b.id),['b1','b2']);
 assert.equal(a.byBatch[0].total,1);assert.equal(a.byBatch[0].ours,1);assert.equal(a.byBatch[0].cited,1);
 assert.equal(a.byBatch[1].total,2);assert.equal(a.byBatch[1].ours,1);assert.equal(a.byBatch[1].rival,1);assert.equal(a.byBatch[1].cited,1);
});

test('动作归因：只命中域名不算，路径前缀与跳转解包命中算',async()=>{
 const acts=[{id:'a1',url:'https://dshdesktop.com/blog/v015',date:'2026-03-01',type:'帖子',title:'t'}];
 assert.equal(activityFor('https://dshdesktop.com/',acts),null,'只命中域名不应归因');
 assert.equal(activityFor('https://dshdesktop.com/blog/other',acts),null,'同域不同路径不应归因');
 assert.equal(activityFor('https://dshdesktop.com/blog/v015',acts)?.id,'a1','同路径应归因');
 assert.equal(activityFor('https://dshdesktop.com/blog/v015/comments',acts)?.id,'a1','子路径应归因');
 const wrapped='https://link.wtturl.cn/?target='+encodeURIComponent('https://dshdesktop.com/blog/v015');
 assert.equal(activityFor(wrapped,acts)?.id,'a1','跳转链接解包后应归因');
 const noPath=[{id:'a2',url:'https://dshdesktop.com',date:'2026-03-01',type:'帖子',title:'t'}];
 assert.equal(activityFor('https://dshdesktop.com/anything',noPath),null,'动作 url 无路径时不匹配任何引用');
});

test('HTML 与 Markdown 报告都包含「本周动作与归因」',async()=>{
 const store=await mk();
 await store.action({type:'activity.add',title:'发了篇区别说明',category:'帖子',url:'https://zhuanlan.zhihu.com/p/123456',date:'2026-03-01'});
 const html=await store.report({format:'html'});
 assert.ok(html.text.includes('本周动作与归因'));
 assert.ok(html.text.includes('发了篇区别说明'));
 const md=await store.report({});
 assert.ok(md.text.includes('## 本周动作与归因'));
 const empty=await mk();
 const html2=await empty.report({format:'html'});
 assert.ok(html2.text.includes('本期没有记录动作。'));
});
