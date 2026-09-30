import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {analyse,citationRanking,exampleState} from '../analysis.js';

const rec=(id,overrides={})=>({id,kind:'geo',source:'official_web',eligible:true,platform:'Gemini',question:'品牌是什么？',answer:'DSH Desktop',date:'2026-09-28T10:00:00Z',group:'品牌',mode:'联网搜索',locale:'zh',region:'CN',citations:[],...overrides});
test('citation ranking deduplicates per answer, unwraps redirects and keeps useful query parameters',()=>{
 const rows=[rec('1',{citations:['https://WWW.example.com/a?utm_source=foo#x','https://example.com/a','https://example.com/b','https://link.wtturl.cn/?target=https%3A%2F%2Fexample.com%2Fc']}),rec('2',{platform:'Kimi',question:'另一题',citations:['https://example.com/a','https://blog.example.com/a','https://example.com/a?id=2']}),rec('3')];
 const result=citationRanking(rows,exampleState().brand),d=result.domains[0];
 assert.equal(d.name,'example.com');assert.equal(d.total,2);assert.equal(d.rate,2/3);assert.equal(d.pageCount,4);assert.equal(d.questionCount,2);assert.deepEqual(d.ids,['1','2']);
 assert.equal(result.withCitations,2);assert.equal(result.domains.length,2);
 assert.equal(d.platforms.find(p=>p.name==='Gemini').denominator,2);
 assert.equal(d.platforms.find(p=>p.name==='Gemini').rate,.5);
});
test('invalid URLs, search-only links and known platform UI navigation are excluded without deleting source',()=>{
 const record=rec('1',{citations:['broken','javascript:alert(1)','https://user:pass@example.com','https://accounts.google.com/SignOutOptions','https://gemini.google.com/app','https://gemini.google.com/library','https://gemini.google.com/updates','https://deepseek.com/'],searchedSources:['https://search-only.example/'],answer:'https://body-only.example/'});
 const before=JSON.stringify(record),result=citationRanking([record],exampleState().brand);
 assert.equal(result.ignoredLinks,3);assert.equal(result.navigationLinks,3);assert.equal(result.domains.length,2);assert.equal(result.withCitations,1);assert.equal(JSON.stringify(record),before);
 assert.ok(result.domains.some(d=>d.name==='gemini.google.com'),'content updates must not be removed by a whole-domain blacklist');
});
test('ranking respects platform, question type, date and active import eligibility',()=>{
 const s=exampleState();s.imports=[{id:'on'},{id:'off',revoked:true}];
 s.records=[rec('ok',{citations:['https://example.com/a']}),rec('platform',{platform:'Kimi',citations:['https://example.com/a']}),rec('old',{date:'2026-08-01',citations:['https://example.com/a']}),rec('group',{group:'诊断'}),rec('pending',{eligible:false}),rec('invalid',{invalidatedAt:'now'}),rec('revoked',{source:'imported',batchId:'off'}),rec('import',{source:'imported',batchId:'on',citations:['https://example.com/b']})];
 const a=analyse(s,{platform:'Gemini',group:'品牌',from:'2026-09-01'});
 assert.equal(a.citationRanking.total,2);assert.deepEqual(a.domains[0].ids,['ok','import']);assert.equal(a.domains[0].rate,1);
});
test('ranking uses deterministic ties, handles no data and separates official pages from a shared domain',()=>{
 assert.deepEqual(citationRanking([],{}),{total:0,withCitations:0,ignoredLinks:0,navigationLinks:0,domains:[]});
 const r=citationRanking([rec('1',{citations:['https://z.example/a','https://a.example/b','https://github.com/dataelement/dsh-desktop','https://github.com/other/project']})],exampleState().brand);
 assert.deepEqual(r.domains.map(d=>d.name),['a.example','github.com','z.example']);assert.equal(r.domains[1].officialPages,1);assert.equal(r.domains[1].pageCount,2);
});

const original=await readFile(new URL('../client.js',import.meta.url),'utf8');
function render(view,state,replacements=[]){
 let source=original.replace('return {App,call};','globalThis.testApp=App; return {App,call};')
 .replace('[state,setState]=useState(null)','[state,setState]=useState(globalThis.fixture)')
 .replace("[view,setView]=useState('action')",`[view,setView]=useState('${view}')`)
 .replace('[brand,setBrand]=useState(null)','[brand,setBrand]=useState(globalThis.fixture.brand)')
 .replace("[boardRange,setBoardRange]=useState('30')","[boardRange,setBoardRange]=useState('all')");
 for(const [from,to] of replacements){assert.ok(source.includes(from),from);source=source.replace(from,to);}
 const React={createElement:(type,props,...children)=>({type,props,children}),Fragment:'fragment',useState:x=>[typeof x==='function'?x():x,()=>{}],useEffect:()=>{},useRef:x=>({current:x})};
 const ctx={fixture:state,localStorage:{getItem:()=>null},window:{__ModuleLoader__:{load:m=>{ctx.mod=m;}}},console,URL,Date,setTimeout,clearTimeout,AbortController};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.mod.factory(()=>React);return ctx.testApp({runtime:null,onClose:()=>{}});
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.children)];}
function textOf(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(textOf).join(' ');return textOf(tree.children);}
const fixture=()=>{const s=exampleState();s.credStatus={};s.records=[rec('r1',{citations:['https://docs.example.org/page']}),rec('r2',{platform:'Kimi',citations:['https://dshdesktop.com/zh/'],entity:'ours'})];return s;};
test('populated evidence overview and grouped trends show valid counts without render exceptions',()=>{
 const overview=render('evidence',fixture(),[["[analysisTab,setAnalysisTab]=useState('records')","[analysisTab,setAnalysisTab]=useState('overview')"]]);
 assert.match(textOf(overview),/docs.example.org/);assert.match(textOf(overview),/50.0%/);
 const trends=render('evidence',fixture(),[["[analysisTab,setAnalysisTab]=useState('records')","[analysisTab,setAnalysisTab]=useState('trends')"]]);
 assert.match(textOf(trends),/2026-09-28/);assert.match(textOf(trends),/Gemini/);
});
test('evidence overview honors drilldown, and record list is bounded with full count',()=>{
 const s=fixture();s.records=Array.from({length:85},(_,i)=>rec('r'+i,{citations:['https://docs.example.org/'+i]}));
 const tree=render('evidence',s);assert.equal(nodes(tree).filter(n=>typeof n.type==='function'&&n.type.name==='RecCard').length,40);assert.match(textOf(tree),/共 85 条/);
 const scoped=render('evidence',fixture(),[["[analysisTab,setAnalysisTab]=useState('records')","[analysisTab,setAnalysisTab]=useState('overview')"],["[lastEvidence,setLastEvidence]=useState([])","[lastEvidence,setLastEvidence]=useState(['r1'])"]]);
 assert.match(textOf(scoped),/100.0%/);assert.doesNotMatch(textOf(scoped),/dshdesktop.com/);
});
test('collection retains all three steps, import controls and scheduled tasks',()=>{
 const tree=render('collect',fixture());const t=textOf(tree);
 for(const label of ['问题集','平台','运行','开始采集','已导入批次','粘贴文本导入','定时任务'])assert.ok(t.includes(label),label);
 assert.ok(nodes(tree).some(n=>n.type==='button'&&textOf(n)==='开始采集'));
});
test('saved and generated report previews retain content, export and follow-up controls',()=>{
 const s=fixture();s.reports=[{id:'report1',kind:'geo',text:'SAVED_REPORT_BODY',createdAt:'2026-09-28T10:00:00Z',recordIds:['r1']}];
 const tree=render('reports',s,[["[openHist,setOpenHist]=useState(null)","[openHist,setOpenHist]=useState('report1')"],["[reportPreview,setReportPreview]=useState('')","[reportPreview,setReportPreview]=useState('<h1>Report</h1>')"]]);
 assert.match(textOf(tree),/SAVED_REPORT_BODY/);assert.match(textOf(tree),/追问这份分析/);assert.match(textOf(tree),/就这份报告追问/);
 assert.ok(nodes(tree).some(n=>n.type==='iframe'&&n.props.title==='GEO报告预览'));
});
test('board platform filters preserve SEO traffic and rates use the same denominator',()=>{
 const s=fixture();s.records.push({id:'traffic1',kind:'traffic',source:'api',date:'2026-09-28',channel:'Traffic witness',visits:87654,downloads:0});
 const tree=render('board',s,[["[boardPlatform,setBoardPlatform]=useState('')","[boardPlatform,setBoardPlatform]=useState('Gemini')"]]);
 const t=textOf(tree);assert.match(t,/AI 常引用的网站/);assert.match(t,/Traffic witness/);assert.match(t,/87654 次/);assert.match(t,/不构成转化漏斗/);assert.doesNotMatch(t,/164%/);
 assert.ok(t.indexOf('AI 常引用的网站')>t.indexOf('Bing 可冲刺词'),'citation ranking belongs below the SEO section');
});

test('action page follows latest report, renumbers open work and retains completed work',()=>{
 const s=fixture();
 s.reports=[{id:'geo-latest',kind:'geo',createdAt:'2026-09-29T10:00:00Z',recordIds:['r1','r2'],text:'## 1. 主要发现\n事实\n## 6. 行动与复测\nP0｜统一实体归属：修改首页；复测：官网引用达到 10 条。\nP1｜发布场景教程：补齐案例；复测：场景提及达到 3 条。\n复测总表：'}];
 let tree=render('action',s),t=textOf(tree);
 assert.match(t,/依据最新已完成 GEO \/ SEO 报告/);assert.match(t,/统一实体归属/);assert.match(t,/场景提及达到 3 条/);assert.match(t,/数据范围： 2 条记录/);
 const rows=nodes(tree).filter(n=>n.props?.className==='sg-act');
 assert.equal(rows.length,2);
 const firstKey=rows[0].props.key;s.actionStates[firstKey]={status:'done',doneAt:'2026-09-29T12:00:00Z'};
 tree=render('action',s);t=textOf(tree);
 assert.match(t,/已完成 1 项/);
 const active=nodes(tree).find(n=>n.props?.className==='sg-act');
 assert.equal(textOf(active.children[0]),'1');
});

test('loading a saved SEO report preview shows the narrative document for its base row',()=>{
 const s=fixture();
 const base={id:'seo-base',kind:'seo-snapshot',createdAt:'2026-09-29T09:00:00Z',recordIds:[],options:{site:'example.com',from:'2026-09-01',to:'2026-09-02'},html:'<h1>BASE</h1>'};
 const narrative={...structuredClone(base),id:'seo-narr',parentId:'seo-base',createdAt:'2026-09-29T09:05:00Z',narrative:'## done'};
 s.reports=[base,narrative];s._seoDoc=narrative;
 const stale=render('reports',s,[["[openHist,setOpenHist]=useState(null)","[openHist,setOpenHist]=useState('seo-base')"],["[seoDocument,setSeoDocument]=useState(null)","[seoDocument,setSeoDocument]=useState(globalThis.fixture._seoDoc)"]]);
 assert.ok(nodes(stale).some(n=>n.type==='iframe'&&n.props.title==='SEO报告预览'),'narrative loaded for base row must render the preview iframe');
 assert.match(textOf(stale),/深入分析已完成/);
 s._seoDoc=base;
 const fresh=render('reports',s,[["[openHist,setOpenHist]=useState(null)","[openHist,setOpenHist]=useState('seo-base')"],["[seoDocument,setSeoDocument]=useState(null)","[seoDocument,setSeoDocument]=useState(globalThis.fixture._seoDoc)"]]);
 assert.ok(nodes(fresh).some(n=>n.type==='iframe'&&n.props.title==='SEO报告预览'),'base document itself must also render');
 s._seoDoc={...structuredClone(narrative),id:'other-narr',parentId:'other-base'};
 const closed=render('reports',s,[["[openHist,setOpenHist]=useState(null)","[openHist,setOpenHist]=useState('seo-base')"],["[seoDocument,setSeoDocument]=useState(null)","[seoDocument,setSeoDocument]=useState(globalThis.fixture._seoDoc)"]]);
 assert.ok(!nodes(closed).some(n=>n.type==='iframe'&&n.props.title==='SEO报告预览'),'a narrative of another report must not leak into this row');
});
