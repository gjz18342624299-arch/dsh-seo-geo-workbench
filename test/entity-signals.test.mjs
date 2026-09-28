import test from 'node:test';
import assert from 'node:assert/strict';
import {entitySignalScan,autoJudgeEntity,analyse,exampleState as initialState,isRivalCitation,DEFAULT_ENTITY_RIVALS} from '../analysis.js';

const brand=initialState().brand;
const rec=(over={})=>({id:'r1',kind:'geo',eligible:true,platform:'测试',date:'2026-09-22T00:00:00.000Z',question:'DSH Desktop 是什么？',answer:'',citations:[],...over});

test('平台截断引用标记 "dsharness...." 命中裸词竞品信号',()=>{
  const r=rec({answer:'DSH Desktop 是社区开源项目，并非 DeepSeek 官方出品dsharness....。简单一句话：……'});
  const {rival}=entitySignalScan(r,brand);
  assert.ok(rival.some(s=>s.includes('dsharness')),JSON.stringify(rival));
  assert.equal(autoJudgeEntity(r,brand).entity,'rival');
});

test('web-casa 社区组织名命中竞品信号',()=>{
  const r=rec({answer:'不是 DeepSeek 官方出品，是 web-casa 社区维护的桌面封装。'});
  assert.equal(autoJudgeEntity(r,brand).entity,'rival');
});

test('出品方 DataElem / dataelement/dsh 变体判我方',()=>{
  assert.equal(autoJudgeEntity(rec({answer:'DSH Desktop 由 DataElem 团队维护。'}),brand).entity,'ours');
  assert.equal(autoJudgeEntity(rec({answer:'源码见 Dataelem/DSH 仓库的 releases。'}),brand).entity,'ours');
  assert.equal(autoJudgeEntity(rec({answer:'github.com/dataelement 组织下可以找到。'}),brand).entity,'ours');
});

test('问题锚定官网域名 → 整条问答主体判我方',()=>{
  const r=rec({question:'dshdesktop.com 是什么产品？',answer:'这是一个桌面 AI Agent 客户端，主打本地文件与办公自动化。'});
  const {ours}=entitySignalScan(r,brand);
  assert.ok(ours.some(s=>s.includes('问题锚定官网域名')),JSON.stringify(ours));
  assert.equal(autoJudgeEntity(r,brand).entity,'ours');
});

test('同名家族域名引用判竞品：dsh.so / dshai.org / dshmobile.app',()=>{
  for(const u of ['https://dsh.so/','https://www.dshai.org/download','https://dshmobile.app/']){
    assert.ok(isRivalCitation(u,brand),u);
    assert.equal(autoJudgeEntity(rec({citations:[u]}),brand).entity,'rival',u);
  }
});

test('官方信源不受同名家族规则误伤',()=>{
  assert.ok(!isRivalCitation('https://dshdesktop.com/zh/',brand));
  assert.ok(!isRivalCitation('https://github.com/dataelement/dsh-desktop',brand));
  assert.equal(autoJudgeEntity(rec({citations:['https://dshdesktop.com/zh/']}),brand).entity,'ours');
});

test('DeepSeek 官方平台等无关域名不产生信号',()=>{
  const r=rec({answer:'模型密钥需要到 platform.deepseek.com 自己申请。',citations:['https://platform.deepseek.com/']});
  const {ours,rival}=entitySignalScan(r,brand);
  assert.deepEqual(rival,[]);
  assert.deepEqual(ours,[]);
});

test('老数据的 entityRivals 名单与内置名单取并集，自动获得新增实体',()=>{
  const oldBrand={...brand,entityRivals:['anywhere-labs','dshdesktop.cn','dsharness.app','dshmobile.app']};
  const r=rec({answer:'这是 web-casa 社区的开源封装版本。'});
  assert.equal(autoJudgeEntity(r,oldBrand).entity,'rival');
});

test('内置名单包含全部新实体项',()=>{
  for(const al of ['anywhere-labs','web-casa','dshdesktop.cn','dsharness','dshmobile','dsh.so','dshai.org'])
    assert.ok(DEFAULT_ENTITY_RIVALS.includes(al),al);
});

test('analyse：auto-llm 固化判定计入 llm 而非 manual；unjudgedMentioned 只算提及品牌的',()=>{
  const s=initialState();
  s.records=[
    rec({id:'a',answer:'DSH Desktop 由 DataElement 出品。'}),                                    // 信号判我方
    rec({id:'b',answer:'DSH Desktop 和 WorkBuddy 哪个好？'}),                                     // 提及但无信号 → 待判定（提及）
    rec({id:'c',answer:'今天天气怎么样？'}),                                                       // 未提及 → 待判定（未提及）
    rec({id:'d',answer:'DSH Desktop 是某个社区封装。',entity:'rival',entitySource:'auto-llm',entityJudgedAt:'2026-09-22T01:00:00.000Z'}), // LLM 固化
    rec({id:'e',answer:'DSH Desktop 挺好用。',entity:'ours',entitySource:'manual',entityJudgedAt:'2026-09-22T01:00:00.000Z'}),          // 人工
  ];
  const a=analyse(s,{});
  assert.equal(a.entity.auto,1);
  assert.equal(a.entity.llm,1);
  assert.equal(a.entity.manual,1);
  assert.equal(a.entity.unjudged,2);
  assert.equal(a.entity.unjudgedMentioned,1);
  const d=a.geo.find(r=>r.id==='d');
  assert.equal(d.entityEffective,'rival');
  assert.equal(d.entitySource,'auto-llm');
});

test('无信号行动项只在"提及品牌却判不了"时出现',()=>{
  const s=initialState();
  s.records=[rec({id:'x',answer:'完全不相关的内容，没有任何品牌。'})];
  const a=analyse(s,{});
  assert.ok(!a.actions.some(x=>x.title==='复核无信号样本'));
  s.records.push(rec({id:'y',answer:'DSH Desktop ⭐⭐⭐⭐⭐ 榜单提名，无链接无锚点。'}));
  const b=analyse(s,{});
  assert.ok(b.actions.some(x=>x.title==='复核无信号样本'));
});
