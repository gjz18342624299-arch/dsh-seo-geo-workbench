import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initialState,analyse,makeAnalysisPrompt,makePayloadPrompt,reportActionPlan} from '../analysis.js';
import {geoNarrativeHtml,Store} from '../store.js';

const narrative='一句话结论：先讲清产品归属，再补使用案例。\n\n## 1. 主要发现\n### 发现 1｜同名产品容易混淆\n问题：用户可能走错官网。\n结论：优先说明开发团队。\n建议：更新首页。\n证据与细节：事实：参考 [a1234567]；推断：需要复测。\n\n## 2. 品牌认知与推荐理由\n原始细节 <script>alert(1)</script>\n\n## 3. 竞品场景差异\n对比依据\n\n## 4. 引用来源机会\n官方链接\n\n## 5. 数据缺口\n缺少来源\n\n## 6. 行动与复测\nP0｜说明产品归属：建议：修改官网首段；为什么：同名混淆 [a1234567]；复测：同题同平台检查归属。\n\n复测总表：\n| 指标 | 当前基线 | 下次目标 | 取数 |\n|---|---|---|---|\n| 正确归属 | 未知 | 先统一范围 | 同题复测 |';
const fixture=()=>{
 const state=initialState();
 state.brand={...state.brand,name:'Test Brand',aliases:['Test Brand'],domain:'example.com'};
 state.records=[{id:'a1234567-full',kind:'geo',eligible:true,source:'official_web',date:'2026-10-08',platform:'Test',question:'推荐工具',answer:'Test Brand https://example.com',citations:['https://example.com']},{id:'b1234567-full',kind:'geo',eligible:true,source:'official_web',date:'2026-10-08',platform:'Test',question:'品牌是什么',answer:'Test Brand',citations:[],entity:'unknown',entitySource:'auto-llm',entityJudgedAt:'2026-10-08'}];
 return state;
};
test('both generation paths carry fixed statistics and plain-language writing rules',()=>{
 const state=fixture(),before=JSON.stringify(state);
 const prompts=[makeAnalysisPrompt(state,state.records),makePayloadPrompt(state,{path:'D:/payload.json',specPath:'D:/report-format.md'},2,'','',state.records)];
 for(const prompt of prompts){
  assert.match(prompt,/结论先行/);assert.match(prompt,/问题：/);assert.match(prompt,/证据与细节：/);
  assert.match(prompt,/"validGeo":2/);assert.match(prompt,/"auto":1/);assert.match(prompt,/"llm":1/);
  assert.match(prompt,/不能把|不等于已确认归属/);assert.match(prompt,/不得用模型自行清点的子集/);
 }
 assert.equal(JSON.stringify(state),before);
});
test('HTML puts findings and actions first, collapses evidence and preserves escaped details',()=>{
 const html=geoNarrativeHtml(narrative);
 assert.ok(html.indexOf('主要发现')<html.indexOf('行动与复测'));
 assert.ok(html.indexOf('行动与复测')<html.indexOf('品牌认知与推荐理由'));
 assert.match(html,/<details class="report-evidence"><summary>展开证据与细节/);
 assert.match(html,/a1234567/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/复测总表/);
 assert.match(geoNarrativeHtml('旧报告正文'),/旧报告正文/);
});
test('new action wording stays usable by the action page',()=>{
 const state=fixture();state.reports=[{id:'report',kind:'geo',recordIds:state.records.map(r=>r.id),createdAt:'2026-10-08',text:narrative}];
 const actions=reportActionPlan(state).actions;
 assert.equal(actions.length,1);assert.equal(actions[0].priority,'P0');
 assert.match(actions[0].do,/修改官网首段/);assert.equal(actions[0].retest,'同题同平台检查归属。');
 assert.deepEqual(actions[0].ids,['a1234567-full']);
});
test('export warns when narrative scope differs and automatic total includes unknown verdicts',()=>{
 const state=fixture();state.reports=[{id:'report',kind:'geo',recordIds:['a1234567-full'],createdAt:'2026-10-08',text:narrative}];
 const html=new Store('.').htmlReport(state,analyse(state),{});
 assert.match(html,/范围提醒/);assert.match(html,/自动判定合计 2 条/);
 assert.match(html,/合计不等于已确认归属的数量/);
});
test('client embeds current shared report rules and passes records to payload prompt',async()=>{
 const client=await readFile(new URL('../client.js',import.meta.url),'utf8');
 const analysis=await readFile(new URL('../analysis.js',import.meta.url),'utf8');
 const start=client.indexOf('factory(require){')+'factory(require){'.length,end=client.indexOf('const SG_CSS=');
 assert.equal(client.slice(start,end).trim(),analysis.replace(/^export /gm,'').trim());
 assert.match(client,/makePayloadPrompt\(state,payload,records.length,question,note,records\)/);
});
