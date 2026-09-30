import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reportActionPlan} from '../analysis.js';
import {Store} from '../store.js';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const report=(id,at,lines,extra={})=>({id,kind:'geo',createdAt:at,recordIds:['a1234567-full','b1234567-full'],text:'## 1. 主要发现\n证据\n\n## 6. 行动与复测\n'+lines.join('\n')+'\n\n复测总表：\n| 指标 | 目标 |\n|---|---|',...extra});

test('latest completed GEO report supplies priority, scope, evidence and retest target',()=>{
 const s=initialState();s.records=[{id:'a1234567-full',date:'2026-09-28'},{id:'b1234567-full',date:'2026-09-29'}];
 s.reports=[report('old','2026-09-20T00:00:00Z',['P0｜旧建议：旧做法；复测：旧目标。']),report('latest','2026-09-29T00:00:00Z',['P1｜发布场景教程：参考 a1234567，补齐页面；复测：场景提及提升至 3/20。','P0｜统一实体归属：修改首页与 README；复测：官网引用达到 10 条。']),report('qa','2026-09-30T00:00:00Z',['P0｜不应采纳：问答。'],{kind:'report-qa'}),report('running','2026-10-01T00:00:00Z',['P0｜不应采纳：未完成。'],{analysisJob:{status:'running'}})];
 const plan=reportActionPlan(s);
 assert.equal(plan.report.id,'latest');assert.deepEqual(plan.actions.map(a=>a.priority),['P0','P1']);
 assert.equal(plan.actions[0].retest,'官网引用达到 10 条。');assert.equal(plan.actions[0].sourceRange,'2026-09-28 ~ 2026-09-29');
 assert.deepEqual(plan.actions[1].ids,['a1234567-full']);assert.equal(plan.actions[1].sourceCount,2);
});

test('new report keeps relevant status and drops unrelated unfinished advice',()=>{
 const s=initialState();
 s.reports=[report('old','2026-09-20T00:00:00Z',['P0｜同名混淆治理：官网声明实体；复测：正确率提升。','P1｜修复采集管道：补齐截图；复测：覆盖达到 90%。']),report('new','2026-09-29T00:00:00Z',['P0｜统一实体归属：官网与仓库声明归属；复测：正确率达到 80%。','P1｜发布场景教程：建设内容；复测：提及破零。'])];
 const old=reportActionPlan({...s,reports:[s.reports[0]]}).actions;
 s.actionStates[old[0].key]={status:'done',doneAt:'2026-09-25T00:00:00Z'};
 s.actionStates[old[1].key]={status:'todo'};
 const plan=reportActionPlan(s);
 assert.equal(plan.actions.length,2);assert.equal(plan.actions[0].key,old[0].key);
 assert.equal(s.actionStates[plan.actions[0].key].status,'done');
 assert.ok(!plan.actions.some(a=>a.title.includes('采集管道')));
 assert.notEqual(plan.actions[1].key,old[1].key);
});

test('latest completed SEO analysis joins GEO actions without replacing its track',()=>{
 const s=initialState();s.reports=[report('geo','2026-09-28T00:00:00Z',['P0｜统一实体归属：修订官网；复测：官网引用提升。']),
  {id:'seo-base',kind:'seo-snapshot',createdAt:'2026-09-29T00:00:00Z',records:[{id:'seo1'}],options:{from:'2026-09-01',to:'2026-09-29'}},
  {id:'seo-done',kind:'seo-snapshot',parentId:'seo-base',createdAt:'2026-09-29T02:00:00Z',analysisJob:{status:'completed'},narrative:'## 优先行动与复测\n\n**P0｜品牌核心词簇承接页优化实验**\n- 依据：Bing 快照排名 5–7。\n- 怎么做：\n  1. 检查当前承接页。\n  2. 补充下载步骤。\n- 复测：2–4 周比较同词同页 CTR。\n\n## 数据限制'}];
 const plan=reportActionPlan(s);
 assert.deepEqual(plan.reports.map(r=>r.id),['seo-done','geo']);
 assert.equal(plan.actions.length,2);
 assert.equal(plan.actions[0].sourceKind,'SEO');assert.equal(plan.actions[0].sourceOpenId,'seo-base');
 assert.equal(plan.actions[0].sourceRange,'2026-09-01 ~ 2026-09-29');
 assert.match(plan.actions[0].do,/补充下载步骤/);assert.match(plan.actions[0].retest,/同词同页 CTR/);
 assert.equal(plan.actions[1].sourceKind,'GEO');
});

test('report with no complete action section leaves rule fallback available',()=>{
 const s=initialState();s.reports=[{id:'draft',kind:'geo',createdAt:'2026-09-29',text:'## 1. 主要发现\n草稿'}];
 assert.equal(reportActionPlan(s).report,null);
});

test('cancel retest pauses pending tasks, preserves completed results and clears status',async()=>{
 const base=new URL('../../qa-test-data/',import.meta.url);await mkdir(base,{recursive:true});
 const store=new Store(await mkdtemp(join(fileURLToPath(base),'retest-cancel-')));
 await store.mutate(s=>{s.actionStates.example={status:'retest',retestBatchId:'batch-r'};s.tasks=[{id:'queued',batchId:'batch-r',status:'queued'},{id:'running',batchId:'batch-r',status:'running'},{id:'done',batchId:'batch-r',status:'completed'},{id:'other',batchId:'batch-x',status:'queued'}];s.records=[{id:'result',taskId:'done'}];});
 const result=await store.action({type:'action.retest.cancel',key:'example'});
 const state=await store.read();assert.equal(result.paused,2);
 assert.deepEqual(state.tasks.map(t=>t.status),['paused','paused','completed','queued']);
 assert.equal(state.actionStates.example.status,'todo');assert.equal(state.records.length,1);
 await assert.rejects(()=>store.action({type:'action.retest.cancel',key:'example'}),/找不到进行中的复测/);
});
