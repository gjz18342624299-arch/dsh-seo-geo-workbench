import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {Store,nextRunAtFor} from '../store.js';import {gscAssertion} from '../syncers.js';import {generateKeyPairSync,createVerify} from 'node:crypto';import {analyse,exampleState as initialState,normalizeRows,mappingFor,parseCSV,publicUrl,containsBrand,autoJudgeEntity,entitySignalScan,canonicalUrl,githubRepo,DEFAULT_ENTITY_RIVALS,makeAnalysisPrompt} from '../analysis.js';
const root=join(import.meta.dirname,'../../qa-test-data');
await (await import('node:fs/promises')).mkdir(root,{recursive:true});
const fixture='问题,回答,平台,采样时间,引用链接\n推荐客户端,"DSH Desktop 与 Cherry Studio。\n两行回答",DeepSeek,2026-09-19,https://dshdesktop.com/docs\n推荐客户端,没有目标品牌,Kimi,2026-09-20,https://example.com\n';
test('CSV preserves quoted newlines and rejects incomplete rows',()=>{assert.equal(parseCSV(fixture)[0].回答,'DSH Desktop 与 Cherry Studio。\n两行回答');assert.throws(()=>parseCSV('a,b\n1'));assert.throws(()=>parseCSV('a,b\n"unclosed'));});
test('URLs reject credentials, private targets and scripts',()=>{for(const u of ['javascript:alert(1)','https://127.0.0.1','https://user:pass@example.com','https://192.168.0.1/','https://[::1]/'])assert.throws(()=>publicUrl(u));assert.equal(publicUrl('https://example.com/'),'https://example.com/');});
test('brand matching does not count substring false positives',()=>{assert.equal(containsBrand('DSH Desktop','DSH'),true);assert.equal(containsBrand('headshot','DSH'),false);assert.equal(containsBrand('test',''),false);});
test('missing sampling date is unknown, not import time or a failed brand sample',()=>{const records=normalizeRows([{q:'q',a:'DSH',p:'Kimi'}],{question:'q',answer:'a',platform:'p'},'geo','b');assert.equal(records[0].date,'');assert.equal(records[0].eligible,false);});
test('metrics use valid active records and exact official domain',()=>{const rows=parseCSV(fixture),s=initialState();s.imports=[{id:'b'}];s.records=normalizeRows(rows,mappingFor(Object.keys(rows[0])),'geo','b');let a=analyse(s);assert.equal(a.geo.length,2);assert.equal(a.mentions,1);assert.equal(a.cited,1);assert.equal(a.competitors.find(c=>c.name==='Cherry Studio').total,1);s.records[0].citations=['https://dshdesktop.com.evil.example/'];assert.equal(analyse(s).cited,0);s.imports[0].revoked=true;assert.equal(analyse(s).geo.length,0);});
test('import preview, durable originals, dedup, revoke and reimport',async()=>{const dir=await mkdtemp(join(root,'import-')),store=new Store(dir);const p=await store.preview({name:'answers.csv',text:fixture});assert.equal(p.totalRows,2);await store.commit({id:p.id,mapping:p.mapping,kind:p.kind});assert.equal((await store.original(p.id)).bytes.toString(),fixture);assert.equal((await new Store(dir).read()).records.length,2);const q=await store.preview({name:'renamed.csv',text:fixture});await assert.rejects(()=>store.commit({id:q.id,mapping:q.mapping,kind:q.kind}),/已导入/);await store.action({type:'import.revoke',id:p.id});await store.commit({id:q.id,mapping:q.mapping,kind:q.kind});assert.equal(analyse(await store.read()).geo.length,2);});
test('concurrent platform writes survive restart and invalid duplicate domain fails',async()=>{const dir=await mkdtemp(join(root,'platform-')),s=new Store(dir);await Promise.all([s.action({type:'platform.add',name:'Test one',url:'https://one.example/'}),s.action({type:'platform.add',name:'Test two',url:'https://two.example/'})]);assert.equal((await new Store(dir).read()).platforms.length,12);await assert.rejects(()=>s.action({type:'platform.add',name:'dup',url:'https://one.example/chat'}),/已在/);});
test('Excel imports preserve worksheets and preview selection',async()=>{const XLSX=await import('../vendor/node_modules/xlsx/xlsx.mjs');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{关键词:'test',曝光:1000,点击:10}]),'搜索');XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{日期:'2026-09-19',访问量:12,下载量:3}]),'访问');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});const s=new Store(await mkdtemp(join(root,'excel-')));const p=await s.preview({name:'test.xlsx',base64:bytes.toString('base64'),sheet:'访问'});assert.equal(p.kind,'traffic');assert.equal(p.rows[0].访问量,'12');});
test('export report uses current filters and source references',async()=>{const s=new Store(await mkdtemp(join(root,'report-')));const p=await s.preview({name:'answers.csv',text:fixture});await s.commit({id:p.id,mapping:p.mapping,kind:p.kind});const r=await s.report({platform:'Kimi',source:'imported'});assert.match(r.text,/有效 GEO 样本 1/);assert.match(await readFile(r.path,'utf8'),/第 3 行/);});
test('auto entity judge: official site, GitHub repo and DataElem anchor mean ours',()=>{
  const brand=initialState().brand;
  assert.equal(autoJudgeEntity({answer:'见 https://dshdesktop.com/zh/ 下载',citations:[]},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'推荐',citations:['https://github.com/dataelement/dsh-desktop']},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'DSH Desktop by DataElem 是开源桌面端',citations:[]},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'DSH Desktop by DataElement 出品',citations:[]},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'认准 dshdesktop.cn 官网',citations:[]},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'由 anywhere-labs 团队维护',citations:[]},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'对比多个客户端',citations:['https://github.com/anywhere-labs/dsh-desktop']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'见 dshdesktop.com，另有 anywhere-labs 版本',citations:[]},brand).entity,'mixed');
  assert.equal(autoJudgeEntity({answer:'只列出 Claude Desktop、Ollama、Cherry Studio',citations:[]},brand).entity,'');
  assert.equal(autoJudgeEntity({answer:'完全没有线索',citations:[]},brand).entity,'');
  // 泛竞品名单不影响实体判定
  assert.equal(autoJudgeEntity({answer:'DSH Desktop（dshdesktop.com）优于 Claude Desktop 和 Ollama',citations:[]},brand).entity,'ours');
  // dshdesktop.com.cn 不算官网
  assert.equal(entitySignalScan({answer:'去看看 dshdesktop.com.cn',citations:[]},brand).ours.length,0);
});
test('any non-official same-name product is rival, not just anywhere-labs/dshdesktop.cn',()=>{
  const brand=initialState().brand;
  // 非 dataelement 组织的同名仓库 → 竞品
  assert.equal(autoJudgeEntity({answer:'社区版',citations:['https://github.com/liguobao/dsh-desktop']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'见 bruc3van/dsh-desktop 的 README',citations:[]},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://github.com/qufei1993/dsh-desktop']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://github.com/chokwinlee/deepseek-harness-desktop']},brand).entity,'rival');
  // 非官方 dshdesktop 站点 → 竞品
  assert.equal(autoJudgeEntity({answer:'',citations:['https://www.dshdesktop.cn/']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://dshdesktopstation.com/en/']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'下载请去 dshdesktopstation.com',citations:[]},brand).entity,'rival');
  // 同名产品站 → 竞品
  assert.equal(autoJudgeEntity({answer:'',citations:['https://dsharness.app/en/faq/']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://dshmobile.app/faq/']},brand).entity,'rival');
  // 官方引用 + 同名 fork 同现 → 混合
  assert.equal(autoJudgeEntity({answer:'主流是社区打包',citations:['https://github.com/dataelement/dsh-desktop','https://github.com/bruc3van/dsh-desktop']},brand).entity,'mixed');
  // 官方镜像（第三方站转载 dataelement 仓库路径）不算竞品
  assert.equal(entitySignalScan({answer:'',citations:['https://p.timeshining.com/detail/typescript/dataelement/dsh-desktop']},brand).rival.length,0);
  // 无关仓库与上游官方 runtime 仓库都不算同名产品
  assert.equal(entitySignalScan({answer:'',citations:['https://github.com/deepseek-ai/dsh']},brand).rival.length,0);
  assert.equal(entitySignalScan({answer:'',citations:['https://github.com/ollama/ollama']},brand).rival.length,0);
});
test('canonical URL unwraps doubao redirect links; repo variants and npm are covered',()=>{
  const brand=initialState().brand;
  // 豆包跳转链接解包
  assert.equal(canonicalUrl('https://link.wtturl.cn/?target=https%3A%2F%2Fdshdesktop.com&scene=im&aid=497858&lang=zh'),'https://dshdesktop.com');
  assert.equal(canonicalUrl('https://link.wtturl.cn/?target=https%3A%2F%2Fgithub.com%2Fdataelement%2Fdsh-desktop&scene=im'),'https://github.com/dataelement/dsh-desktop');
  // 解包后判我方
  assert.equal(autoJudgeEntity({answer:'',citations:['https://link.wtturl.cn/?target=https%3A%2F%2Fdshdesktop.com&scene=im']},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://link.wtturl.cn/?target=https%3A%2F%2Fgithub.com%2Fanywhere-labs%2Fdeepseek-harness-desktop&scene=im']},brand).entity,'rival');
  // raw.githubusercontent / npm 包页 / 下划线与 -app 变体
  assert.equal(githubRepo('https://raw.githubusercontent.com/dataelement/dsh-desktop/v0.3.0/README.zh.md').org,'dataelement');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://raw.githubusercontent.com/dataelement/dsh-desktop/v0.3.0/README.zh.md']},brand).entity,'ours');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://www.npmjs.com/package/@kuaizhongqiang/dsh-desktop']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://github.com/myYangyunfan/dsh_desktop']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'',citations:['https://github.com/Diluka/dsh-desktop-app']},brand).entity,'rival');
  assert.equal(autoJudgeEntity({answer:'见 OptLTD/dsh-desktop 的版本',citations:[]},brand).entity,'rival');
});
test('found-but-not-cited: retrieved or mentioned official source without formal citation',()=>{
  const s=initialState();s.imports=[{id:'b'}];
  const mk=(question,answer,citations,extra={})=>({id:Math.random().toString(36).slice(2),batchId:'b',kind:'geo',source:'imported',date:'2026-09-22T00:00:00Z',platform:'Kimi',question,answer,group:'品牌',mode:'联网搜索',locale:'unknown',region:'unknown',citations,eligible:true,...extra});
  s.records=[
    // 1. 正文写明官方仓库地址但引用里没有 → 找到未引用
    mk('DSH Desktop 是什么？','官网对应仓库是 github.com/dataelement/dsh-desktop，社区开源。',['https://example.com/a']),
    // 2. 问句自带域名，回答只是复读 → 不算
    mk('dshdesktop.com 是什么产品？','dshdesktop.com 是一个桌面客户端官网。',['https://example.com/a']),
    // 3. 检索来源列表里有官网但未正式引用 → 找到未引用（Tier A）
    mk('桌面 AI 客户端推荐？','推荐几个客户端。',['https://example.com/a'],{searchedSources:['https://dshdesktop.com/zh/','https://example.com/b']}),
    // 4. 引用已含官网（跳转解包后）→ 不算
    mk('DSH Desktop 官网？','官网是 dshdesktop.com',['https://link.wtturl.cn/?target=https%3A%2F%2Fdshdesktop.com&scene=im']),
    // 5. 检索列表里没有官网 → 不算找到未引用
    mk('桌面客户端？','泛泛而谈。',['https://example.com/a'],{searchedSources:['https://example.com/c']}),
  ];
  const a=analyse(s);
  assert.equal(a.foundNotCited.total,2);
  assert.equal(a.foundNotCited.fromSearchedList,1);
  assert.equal(a.foundNotCited.searchedCoverage.known,2);
  assert.ok(a.actions.some(x=>x.title==='官网被检索到但未被引用'));
  // 第 4 条跳转解包后计入官网引用
  assert.equal(a.cited,1);
});
test('analyse applies auto judgement while manual judgement wins',()=>{
  const rows=parseCSV(fixture),s=initialState();s.imports=[{id:'b'}];s.records=normalizeRows(rows,mappingFor(Object.keys(rows[0])),'geo','b');
  // fixture 第一条引用官网 → 自动判我方；第二条无信号 → 未判定
  let a=analyse(s);assert.equal(a.entity.ours,1);assert.equal(a.entity.unjudged,1);assert.equal(a.entity.auto,1);
  assert.equal(s.records[0].entityEffective,'ours');assert.equal(s.records[0].entitySource,'auto');assert.ok(s.records[0].entitySignals.length>0);
  // 人工改判为竞品后优先于自动
  s.records[0].entity='rival';a=analyse(s);assert.equal(a.entity.ours,0);assert.equal(a.entity.rival,1);assert.equal(a.entity.auto,0);
});
test('sample.entityAuto persists auto judgements and keeps manual ones',async()=>{
  const s=new Store(await mkdtemp(join(root,'import-')));const p=await s.preview({name:'answers.csv',text:fixture});await s.commit({id:p.id,mapping:p.mapping,kind:p.kind});
  await s.mutate(state=>{state.brand=initialState().brand;});
  const r=await s.action({type:'sample.entityAuto'});
  assert.equal(r.judged,1);assert.equal(r.ours,1);assert.equal(r.skipped,1);
  const st=await s.read();assert.equal(st.records[0].entity,'ours');assert.equal(st.records[0].entitySource,'auto');assert.ok(st.records[0].entitySignals.length>0);
  await s.action({type:'sample.entity',id:st.records[1].id,entity:'rival'});
  const r2=await s.action({type:'sample.entityAuto'});assert.equal(r2.judged,0);
  const st2=await s.read();assert.equal(st2.records[1].entity,'rival');assert.equal(st2.records[1].entitySource,'manual');
});
test('scheduled collection: save, launch, toggle, delete',async()=>{
  const s=new Store(await mkdtemp(join(root,'sched-')));
  const st0=await s.read();const plat=st0.platforms.find(p=>p.enabled);
  await s.action({type:'schedule.save',name:'每日巡检',questions:['DSH Desktop 是什么？','DSH Desktop 下载'],platformIds:[plat.id],group:'品牌',mode:'联网搜索',repeat:1,freq:'daily',time:'09:30'});
  let st=await s.read();assert.equal(st.schedules.length,1);
  const sch=st.schedules[0];assert.ok(sch.nextRunAt>Date.now());assert.equal(sch.enabled,true);
  // 每天 09:30：从 10:00 起应排到明天
  const from=new Date();from.setHours(10,0,0,0);
  const nr=nextRunAtFor({freq:'daily',time:'09:30'},from);assert.equal(new Date(nr).getDate(),new Date(from.getTime()+86400000).getDate());
  // 每周：目标周日=今天但时间已过 → 排 7 天后
  const w=nextRunAtFor({freq:'weekly',time:'08:00',weekday:from.getDay()},from);assert.ok(w-from.getTime()>6*86400000);
  // 立即运行：创建批次、写回 lastRun 并推进 nextRunAt
  const r=await s.launchSchedule(sch.id);assert.ok(r.batchId);assert.equal(r.tasks,2);
  st=await s.read();const sch2=st.schedules[0];assert.equal(sch2.lastBatchId,r.batchId);assert.ok(sch2.lastRunAt);assert.ok(sch2.nextRunAt>Date.now());
  const batch=st.batches.find(b=>b.id===r.batchId);assert.ok(batch.name.startsWith('定时 · '));assert.equal(st.tasks.filter(t=>t.batchId===r.batchId).length,2);
  // 平台全部停用时运行：错误写回 lastError 而不是崩溃
  await s.action({type:'platform.toggle',id:plat.id});
  const r2=await s.launchSchedule(sch.id);assert.ok(r2.error);
  st=await s.read();assert.ok(st.schedules[0].lastError.includes('请选择平台'));
  await s.action({type:'platform.toggle',id:plat.id});
  // 停用/删除
  await s.action({type:'schedule.toggle',id:sch.id});st=await s.read();assert.equal(st.schedules[0].enabled,false);
  await s.action({type:'schedule.delete',id:sch.id});st=await s.read();assert.equal(st.schedules.length,0);
});


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

test('GSC service-account assertion is a verifiable RS256 JWT',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const sa={client_email:'seo-bot@project.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const jwt=gscAssertion(sa,1700000000);
  const [h,c,sig]=jwt.split('.');
  const header=JSON.parse(Buffer.from(h,'base64url').toString());
  const claim=JSON.parse(Buffer.from(c,'base64url').toString());
  assert.equal(header.alg,'RS256');
  assert.equal(claim.iss,sa.client_email);
  assert.equal(claim.scope,'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(claim.aud,'https://oauth2.googleapis.com/token');
  assert.equal(claim.exp-claim.iat,3600);
  const v=createVerify('RSA-SHA256');v.update(h+'.'+c);v.end();
  assert.ok(v.verify(publicKey,sig,'base64url'));
});

test('plugin registrations follow cordis disposal contracts (HMR/boot-safe)',async()=>{
  const src=await readFile(new URL('../index.js',import.meta.url),'utf8');
  assert.ok(src.includes('ctx.effect(()=>ctx.tools.register('),'tools.register returns a disposer and must be wrapped in ctx.effect (HMR duplicate registration crash otherwise)');
  assert.ok(src.includes('ctx.effect(()=>ctx.webServer.register('),'webServer.register must stay wrapped in ctx.effect');
  assert.ok(!src.includes('ctx.effect(()=>ctx.settings.register'),'settings.register returns a handle object, not a disposer; wrapping it in ctx.effect fails boot');
});

test('cbatches merges multiple collection batches and labels the report subtitle',async()=>{
  const store=new Store(await mkdtemp(join(root,'cbatches-')));
  await store.mutate(s=>{
    s.batches.push({id:'c1',name:'批次一',questions:['q1'],platformIds:['p1'],repeat:1,createdAt:'2026-09-20T00:00:00Z'});
    s.batches.push({id:'c2',name:'批次二',questions:['q2'],platformIds:['p1'],repeat:1,createdAt:'2026-09-21T00:00:00Z'});
    s.tasks.push({id:'t1',batchId:'c1',status:'completed'},{id:'t2',batchId:'c2',status:'completed'});
    const rec=(id,taskId,q)=>({id,taskId,kind:'geo',source:'official_web',batchId:'',platform:'Kimi',group:'品牌',mode:'联网搜索',locale:'',region:'',location:'',date:'2026-09-21',question:q,answer:'DSH Desktop 是开源桌面端',citations:[],raw:{},eligible:true,entity:'',entitySource:''});
    s.records.push(rec('r1','t1','q1'),rec('r2','t2','q2'));
  });
  const s=await store.read();
  assert.equal(analyse(s,{cbatches:['c1','c2']}).geo.length,2);
  assert.equal(analyse(s,{cbatches:['c1']}).geo.length,1);
  assert.equal(analyse(s,{cbatches:['c9']}).geo.length,0);
  const r=await store.report({format:'html',cbatches:['c1','c2']});
  assert.match(r.text,/2 个批次合并/);assert.match(r.text,/批次一/);assert.match(r.text,/批次二/);
});

test('report embeds only comprehensive geo deep-analysis, never ad-hoc Q&A',async()=>{
  const mkGeo=()=>({id:'r1',taskId:'',kind:'geo',source:'official_web',batchId:'',platform:'Kimi',group:'品牌',mode:'联网搜索',locale:'',region:'',location:'',date:'2026-09-21',question:'q1',answer:'DSH Desktop',citations:[],raw:{},eligible:true,entity:'',entitySource:''});
  // 有 kind='geo' 标记：只内嵌它，哪怕临时问答更新
  const store=new Store(await mkdtemp(join(root,'deep-')));
  await store.mutate(s=>{
    s.records.push(mkGeo());
    s.reports.push(
      {id:'rep-legacy',createdAt:'2026-09-21T09:00:00Z',question:'综合分析',text:'## 1. 主要发现\n### 发现 1｜旧版综合分析\n## 6. 行动与复测\n复测总表',recordIds:['r1']},
      {id:'rep-geo',createdAt:'2026-09-21T11:00:00Z',question:'综合分析',kind:'geo',text:'## 1. 主要发现\n### 发现 1｜带标记综合版',recordIds:['r1']},
      {id:'rep-qa',createdAt:'2026-09-21T12:00:00Z',question:'报告对话：引用率?',kind:'report-qa',text:'直接结论：不能。没有流量数据。',recordIds:[]},
    );
  });
  const r=await store.report({format:'html'});
  assert.match(r.text,/带标记综合版/);
  assert.doesNotMatch(r.text,/直接结论：不能/);
  assert.doesNotMatch(r.text,/旧版综合分析/);
  // 无 kind 标记（老数据）：回退到符合六章节格式的最新根级分析；
  // report-qa 即使文本含"主要发现/复测总表"（引用了报告标题）也一律排除
  const store2=new Store(await mkdtemp(join(root,'deep2-')));
  await store2.mutate(s=>{
    s.records.push(mkGeo());
    s.reports.push(
      {id:'rep-legacy',createdAt:'2026-09-21T09:00:00Z',question:'综合分析',text:'## 1. 主要发现\n### 发现 1｜旧版综合分析\n## 6. 行动与复测\n复测总表',recordIds:['r1']},
      {id:'rep-qa',createdAt:'2026-09-21T12:00:00Z',question:'基于预览报告：主要发现是什么？',kind:'report-qa',text:'## 1. 主要发现\n引用率 68%。\n## 6. 行动与复测\n复测总表见报告。',recordIds:[]},
    );
  });
  const r2=await store2.report({format:'html'});
  assert.match(r2.text,/旧版综合分析/);
  assert.doesNotMatch(r2.text,/基于预览报告/);
  // 范围不匹配：唯一一份综合分析的记录不在本报告范围内 → 不内嵌，显示占位提示
  const store3=new Store(await mkdtemp(join(root,'deep3-')));
  await store3.mutate(s=>{
    s.records.push(mkGeo());
    s.reports.push(
      {id:'rep-other',createdAt:'2026-09-21T09:00:00Z',question:'综合分析',kind:'geo',text:'## 1. 主要发现\n### 发现 1｜另一批数据的结论',recordIds:['other-1','other-2','other-3']},
    );
  });
  const r3=await store3.report({format:'html'});
  assert.doesNotMatch(r3.text,/另一批数据的结论/);
  assert.match(r3.text,/还没有匹配的深入分析/);
});

test('deep analysis selection prefers the best scope match, not the latest',async()=>{
  const store=new Store(await mkdtemp(join(root,'deepmatch-')));
  const rec=id=>({id,taskId:'',kind:'geo',source:'official_web',batchId:'',platform:'Kimi',group:'品牌',mode:'联网搜索',locale:'',region:'',location:'',date:'2026-09-22',question:'q',answer:'DSH Desktop',citations:[],raw:{},eligible:true,entity:'',entitySource:''});
  await store.mutate(s=>{
    s.records.push({...rec('a1'),platform:'Grok'},{...rec('a2'),platform:'Grok'},rec('b1'),rec('b2'));
    s.reports.push(
      {id:'rep-merged',createdAt:'2026-09-22T10:00:00Z',question:'综合分析（合并）',kind:'geo',text:'## 1. 主要发现\n### 发现 1｜合并版结论',recordIds:['a1','a2','b1','b2']},
      {id:'rep-sub',createdAt:'2026-09-22T11:00:00Z',question:'综合分析（子集）',kind:'geo',text:'## 1. 主要发现\n### 发现 1｜子集版结论',recordIds:['a1','a2']},
    );
  });
  // 全量范围（4 条都在）：合并版 4/4=1.0 > 子集版 2/4=0.5
  const rs=await store.report({format:'html',source:'official_web'});
  assert.match(rs.text,/合并版结论/);assert.doesNotMatch(rs.text,/子集版结论/);
  // 子集范围（仅 Grok 两条）：子集版 2/2=1.0 > 合并版 2/4=0.5，哪怕子集版保存更晚也不串用
  const rs2=await store.report({format:'html',source:'official_web',platform:'Grok'});
  assert.match(rs2.text,/子集版结论/);assert.doesNotMatch(rs2.text,/合并版结论/);
});

test('makeAnalysisPrompt fits a full batch within the 80k budget',()=>{
  const s=initialState();
  const rec=i=>({id:'abcdef'+String(i).padStart(34,'0'),platform:'Kimi',date:'2026-09-22',question:'q'+i,answer:'很长的回答。'.repeat(800),citations:Array(20).fill('https://example.com/x'),raw:{huge:'x'.repeat(5000)},searchedSources:['https://dshdesktop.com/zh/']});
  const batch80=Array.from({length:80},(_,i)=>rec(i));
  const p=makeAnalysisPrompt(s,batch80,'综合分析');
  assert.ok(p.length<80000,'80 条长答案也应塞进预算');
  assert.match(p,/abcdef00/,'证据使用 8 位短 ID');
  assert.ok(!p.includes('huge'),'raw 不进提示词');
  // 超大批次不再硬失败：自动瘦身降级（丢检索来源/引用等体积字段），仍保持在预算内。
  const big=makeAnalysisPrompt(s,Array.from({length:300},(_,i)=>rec(i)),'综合分析');
  assert.ok(big.length<80000+2000,'300 条也不硬失败且保持在预算内');
  assert.match(big,/abcdef00/,'降级后仍保留短 ID');
  assert.ok(!big.includes('huge'),'降级后 raw 仍不进提示词');
});

test('api sync batches replace same-day rows instead of stacking duplicates',async()=>{
  const store=new Store(await mkdtemp(join(root,'syncreplace-')));
  const row=(day,channel,visits)=>({kind:'traffic',date:day+'T00:00:00.000Z',channel,page:'',visits,downloads:null,raw:{}});
  const a=await store.addSyncBatch({kind:'traffic',sourceLabel:'Cloudflare Analytics API 自动同步',records:[row('2026-09-22','Cloudflare 全站',100)],note:''});
  assert.equal(a.added,1);assert.equal(a.replaced,0);
  const b=await store.addSyncBatch({kind:'traffic',sourceLabel:'Cloudflare Analytics API 自动同步',records:[row('2026-09-22','Cloudflare 全站',180)],note:''});
  assert.equal(b.added,1);assert.equal(b.replaced,1,'同日同渠道旧行被替换而非叠加');
  const s=await store.read();
  const day=s.records.filter(r=>r.kind==='traffic'&&String(r.date).startsWith('2026-09-22'));
  assert.equal(day.length,1,'同一天同键只保留最新一行');assert.equal(day[0].visits,180,'保留最新指标');
  assert.equal(s.imports.find(i=>i.api&&i.revoked)?.note.includes('整批替换'),true,'被整批替换的旧批次标记撤销');
  // 不同日、不同渠道的行不受影响
  await store.addSyncBatch({kind:'traffic',sourceLabel:'Cloudflare Analytics API 自动同步',records:[row('2026-09-23','Google 搜索',7),row('2026-09-22','Google 搜索',9)],note:''});
  const s2=await store.read();
  assert.equal(s2.records.filter(r=>r.kind==='traffic').length,3,'不同键的行共存');
});

test('channel board: per-platform GEO aggregates; Cloudflare total row kept out of channel shares',()=>{
  const s=initialState();s.imports=[{id:'b'}];
  const geo=normalizeRows(parseCSV('问题,回答,平台,采样时间,引用链接\nQ12345,推荐 DSH Desktop（官网 dshdesktop.com）,DeepSeek,2026-09-20,https://dshdesktop.com/zh/\nQ23456,没有目标品牌,Kimi,2026-09-21,\nQ34567,其他回答,Kimi,2026-09-22,\n'),mappingFor(['问题','回答','平台','采样时间','引用链接']),'geo','b');
  const traffic=normalizeRows([{日期:'2026-09-22',渠道:'Cloudflare 全站',访问量:100},{日期:'2026-09-22',渠道:'百度搜索',访问量:60},{日期:'2026-09-22',渠道:'doubao.com',访问量:40}],mappingFor(['日期','渠道','访问量']),'traffic','b');
  s.records=[...geo,...traffic];
  const a=analyse(s);
  const ds=a.geoChannels.find(c=>c.name==='DeepSeek'),km=a.geoChannels.find(c=>c.name==='Kimi');
  assert.equal(ds.total,1);assert.equal(ds.mentioned,1);assert.equal(ds.cited,1);assert.equal(ds.ours,1);
  assert.equal(km.total,2);assert.equal(km.mentioned,0);assert.equal(km.cited,0);
  assert.equal(a.geoChannels.find(c=>c.name==='ChatGPT').total,0,'已配置平台无样本也列出');
  assert.equal(a.geoChannels[0].name,'Kimi','按有效样本数降序');
  assert.equal(a.seoBoard.site.visits,100,'全站总量行单列');
  assert.deepEqual(a.seoBoard.channels.map(c=>c.name),['百度搜索','doubao.com'],'渠道明细不含全站行');
  assert.equal(a.seoBoard.channels[0].share,0.6,'占比以渠道合计为分母');
  assert.equal(a.seoBoard.aiReferrers.length,1,'doubao.com 识别为 AI 引荐');
  assert.equal(a.seoBoard.daily.find(d=>d.name==='2026-09-22').visits,100,'有全站行时按日趋势用全站口径');
  s.records=traffic.filter(r=>r.channel!=='Cloudflare 全站');
  const a2=analyse(s);
  assert.equal(a2.seoBoard.basis,'channels');
  assert.equal(a2.seoBoard.daily.find(d=>d.name==='2026-09-22').visits,100,'无全站行时退回渠道合计');
});
