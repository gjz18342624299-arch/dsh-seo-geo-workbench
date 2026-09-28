import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingLlmJudge,buildJudgePrompt,judgeSystemPrompt,parseJudgeVerdicts,chunk,MAX_ATTEMPTS} from '../entity-judge.js';
import {exampleState as initialState} from '../analysis.js';

const brand=initialState().brand;
const rec=(over={})=>({id:'r1',kind:'geo',eligible:true,platform:'测试',date:'2026-09-22T00:00:00.000Z',question:'DSH Desktop 是什么？',answer:'DSH Desktop 是一个桌面客户端。',citations:[],...over});

test('pendingLlmJudge：只挑"提及品牌 + 零信号 + 未固化"的有效 geo 样本',()=>{
  const records=[
    rec({id:'keep'}),                                                                  // ✓ 待判
    rec({id:'judged',entity:'ours'}),                                                   // 已固化 → 跳过
    rec({id:'silent',answer:'完全没有品牌相关内容。'}),                                  // 未提及 → 跳过
    rec({id:'signaled',answer:'DSH Desktop 官网 dshdesktop.com 上有下载。'}),             // 有我方信号 → 跳过
    rec({id:'ineligible',eligible:false}),                                              // 无效样本 → 跳过
    rec({id:'invalid',invalidatedAt:'2026-09-22T01:00:00.000Z'}),                       // 已剔除 → 跳过
    rec({id:'seo',kind:'seo'}),                                                         // 非 geo → 跳过
  ];
  const ids=pendingLlmJudge(records,brand).map(r=>r.id);
  assert.deepEqual(ids,['keep']);
});

test('pendingLlmJudge：重试次数到上限后跳过',()=>{
  const records=[rec({id:'x'})];
  assert.equal(pendingLlmJudge(records,brand,new Map([['x',MAX_ATTEMPTS-1]])).length,1);
  assert.equal(pendingLlmJudge(records,brand,new Map([['x',MAX_ATTEMPTS]])).length,0);
});

test('buildJudgePrompt：回答截断到 1500 字、引用最多 12 条',()=>{
  const long='长'.repeat(3000);
  const r=rec({id:'t',answer:long,citations:Array.from({length:20},(_,i)=>'https://example.com/'+i)});
  const prompt=buildJudgePrompt([r]);
  assert.ok(!prompt.includes(long));
  assert.ok(prompt.includes('长'.repeat(100)));
  assert.equal((prompt.match(/example\.com/g)||[]).length,12);
});

test('judgeSystemPrompt：包含官网域名、官方组织与同名实体名单',()=>{
  const s=judgeSystemPrompt(brand);
  assert.ok(s.includes('dshdesktop.com'));
  assert.ok(s.includes('github.com/dataelement'));
  assert.ok(s.includes('web-casa'));
  assert.ok(s.includes('dsharness'));
});

test('parseJudgeVerdicts：解析正常输出并过滤越界内容',()=>{
  const ids=new Set(['a','b','c']);
  const text='好的，判定如下：\n[{"id":"a","entity":"ours","evidence":"写明 DataElem 出品"},{"id":"b","entity":"rival","evidence":"引用 anywhere-labs"},{"id":"x","entity":"ours"},{"id":"c","entity":"banana"},{"id":"a","entity":"mixed"}]';
  const v=parseJudgeVerdicts(text,ids);
  assert.equal(v.length,3);
  assert.deepEqual(v[0],{id:'a',entity:'ours',evidence:'写明 DataElem 出品'});
  assert.deepEqual(v[1],{id:'b',entity:'rival',evidence:'引用 anywhere-labs'});
  assert.deepEqual(v[2],{id:'a',entity:'mixed',evidence:''});
});

test('parseJudgeVerdicts：垃圾输入返回空数组',()=>{
  assert.deepEqual(parseJudgeVerdicts('',new Set(['a'])),[]);
  assert.deepEqual(parseJudgeVerdicts('无法判定',new Set(['a'])),[]);
  assert.deepEqual(parseJudgeVerdicts('[{broken json',new Set(['a'])),[]);
  assert.deepEqual(parseJudgeVerdicts('{"entity":"ours"}',new Set(['a'])),[]);
});

test('chunk：按批量大小切分',()=>{
  assert.deepEqual(chunk([1,2,3,4,5,6,7,8,9],8),[[1,2,3,4,5,6,7,8],[9]]);
  assert.deepEqual(chunk([],8),[]);
});
