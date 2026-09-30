// 市场截图：用当前 client.js 与 fixture 数据渲染真实 UI（1440x1000，Playwright + Edge headless）。
// 产出 ../../qa-market-shots/collect.png 与 report-preview.png，复制到 docs/screenshots/ 后提交。
// 与已收录截图同源做法：不使用真实账号、模型调用或业务数据。
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {build} from '../vendor/node_modules/esbuild/lib/main.js';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
import {Store} from '../store.js';
import {createHandler} from '../server.js';
import {SeoJobs} from '../seo-jobs.js';
const qa=new URL('../../qa-market-shots/',import.meta.url);await fs.mkdir(qa,{recursive:true});
const source=(await fs.readFile(new URL('../client.js',import.meta.url),'utf8')).replace('return {App,call};','globalThis.qaApp=App; return {App,call};');
const entry=`import React from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react/index.js',import.meta.url)))};import {createRoot} from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react-dom/client.js',import.meta.url)))};
window.__ModuleLoader__={load(m){const p=m.factory(n=>React);p.apply({effect:()=>{},inject:()=>{},slots:{}});}};
${source}
createRoot(document.getElementById('root')).render(React.createElement(globalThis.qaApp,{runtime:null,onClose:()=>{}}));`;
await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,format:'iife',outfile:fileURLToPath(new URL('app.js',qa))});
await fs.writeFile(new URL('index.html',qa),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SEO/GEO 监测工作台</title><style>html,body{margin:0;height:100%}#root{height:100%;display:flex;flex-direction:column;overflow:hidden}</style><div id="root"></div><script src="/app.js"></script></html>');
const store=new Store(fileURLToPath(qa));
await store.mutate(s=>{s.reports=[];s.records=[];s.imports=[];s.brand.domain='example.com';});
await store.addSyncBatch({kind:'seo',sourceLabel:'Google Search Console',site:'example.com',records:[{date:'2026-09-01',keyword:'test',clicks:3,impressions:100},{date:'2026-09-02',keyword:'test',clicks:4,impressions:110}]});
const jobs=new SeoJobs(store,async prompt=>{assert.ok(prompt.includes('优先行动与复测'));return '## 核心结论\n测试模型分析已生成：按同来源复核查询词。';});
const handler=createHandler(store,{}, {'/':[fileURLToPath(new URL('index.html',qa)),'text/html; charset=utf-8'],'/app.js':[fileURLToPath(new URL('app.js',qa)),'text/javascript']},null,null,null,jobs);
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // 1) 采集页
  await page.getByRole('button',{name:'采集',exact:true}).click();
  await page.getByLabel('问题集',{exact:true}).fill('示例产品有什么特点？\n示例产品适合哪些用户？');
  await page.getByRole('heading',{name:'采集',exact:true}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL('collect.png',qa)),fullPage:true});
  // 2) 报告页：SEO 检测报告生成 + 历史预览
  await page.getByRole('button',{name:'报告',exact:true}).click();
  await page.getByLabel('报告类型',{exact:true}).selectOption('seo');
  await page.getByLabel('SEO报告网站',{exact:true}).selectOption('example.com');
  await page.getByLabel('SEO报告开始日期',{exact:true}).fill('2026-09-01');await page.getByLabel('SEO报告结束日期',{exact:true}).fill('2026-09-02');
  await page.getByRole('button',{name:'检查数据范围',exact:true}).click();
  await page.getByRole('button',{name:'确认范围并生成报告',exact:true}).click();
  await page.getByRole('button',{name:'预览',exact:true}).first().click();
  await page.getByRole('button',{name:'加载预览',exact:true}).click();
  const frame=page.frameLocator('iframe[title="SEO报告预览"]');
  await frame.getByRole('heading',{name:'SEO 分析报告',exact:true}).waitFor();
  assert.ok((await frame.locator('body').innerText()).includes('2 条数据记录'));
  await frame.locator('.callout').getByText('测试模型分析已生成',{exact:false}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL('report-preview.png',qa)),fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Market screenshots captured: collect.png, report-preview.png');
}catch(e){console.log('UI errors:',errors);console.log((await page.locator('body').innerText()).slice(-3500));throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
