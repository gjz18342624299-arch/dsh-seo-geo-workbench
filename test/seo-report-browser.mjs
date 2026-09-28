import {SeoJobs} from '../seo-jobs.js';
import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {build} from '../vendor/node_modules/esbuild/lib/main.js';import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
import {Store} from '../store.js';import {createHandler} from '../server.js';
const qa=new URL('../../qa-seo-report-ui/',import.meta.url);await fs.mkdir(qa,{recursive:true});
const source=(await fs.readFile(new URL('../client.js',import.meta.url),'utf8')).replace('return {App,call};','globalThis.qaApp=App; return {App,call};');
const entry=`import React from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react/index.js',import.meta.url)))};import {createRoot} from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react-dom/client.js',import.meta.url)))};
window.__ModuleLoader__={load(m){const p=m.factory(n=>React);p.apply({effect:()=>{},inject:()=>{},slots:{}});}};
${source}
const qaSession={open:async()=>{},prompt:async(parts)=>{window.qaPrompt=parts[0].text;if(window.qaFail)throw Error('测试模型不可用');return {ok:true};},resync:async()=>{},getSnapshot:()=>({running:false}),eventSource:{getSnapshot:()=>({entries:[{type:'assistant/message',data:{text:'## 核心结论\\n测试模型分析已生成：按同来源复核查询词。'}},{type:'turn/end'}]})}};
const qaRuntime={sessions:{create:async()=> 'qa-session',binding:()=>({session:qaSession})},workspaces:{archiveSession:async()=>{window.qaArchived=true;}}};
createRoot(document.getElementById('root')).render(React.createElement(globalThis.qaApp,{runtime:qaRuntime,onClose:()=>{}}));`;
await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,format:'iife',outfile:fileURLToPath(new URL('app.js',qa))});
await fs.writeFile(new URL('index.html',qa),'<html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');
const store=new Store(fileURLToPath(qa));
await store.mutate(s=>{s.reports=[];s.records=[];s.imports=[];s.brand.domain='example.com';});
await store.addSyncBatch({kind:'seo',sourceLabel:'Google Search Console',site:'example.com',records:[{date:'2026-09-01',keyword:'test',clicks:3,impressions:100},{date:'2026-09-02',keyword:'test',clicks:4,impressions:110}]});
let qaFail=false;const jobs=new SeoJobs(store,async prompt=>{assert.ok(prompt.includes("优先行动与复测"));if(qaFail)throw Error("测试模型不可用");return "## 核心结论\n测试模型分析已生成：按同来源复核查询词。";});
const handler=createHandler(store,{}, {'/':[fileURLToPath(new URL('index.html',qa)),'text/html'],'/app.js':[fileURLToPath(new URL('app.js',qa)),'text/javascript']},null,null,null,jobs);
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'SEO 分析',exact:true}).click();
 await page.getByLabel('SEO报告网站',{exact:true}).selectOption('example.com');
 await page.getByLabel('SEO报告开始日期',{exact:true}).fill('2026-09-01');await page.getByLabel('SEO报告结束日期',{exact:true}).fill('2026-09-02');
 assert.equal(await page.getByLabel('Cloudflare',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('Bing 站长',{exact:true}).isChecked(),false);
 await page.getByRole('button',{name:'检查本次数据范围',exact:true}).click();
 await page.getByRole('button',{name:'确认范围并生成报告',exact:true}).click();
 const frame=page.frameLocator('iframe[title="SEO报告预览"]');await frame.getByRole('heading',{name:'SEO 分析报告',exact:true}).waitFor();
 assert.ok((await frame.locator('body').innerText()).includes('2 条数据记录'));
 await frame.locator('.conclusions').getByText('测试模型分析已生成：按同来源复核查询词。',{exact:true}).waitFor();


 await page.screenshot({path:fileURLToPath(new URL('report-preview.png',qa)),fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 HTML',exact:true}).click();const d=await download;assert.ok(d.suggestedFilename().endsWith('.html'));
 await page.getByText('已导出当前预览版本，并保存到项目 outputs/monitor-v3。',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('SEO报告网站',{exact:true}).count(),0);
 await page.getByRole('button',{name:'调整范围生成新版本',exact:true}).dispatchEvent('click');
 await page.getByLabel('SEO报告结束日期',{exact:true}).fill('2026-09-03');assert.equal(await page.getByRole('button',{name:'确认范围并生成报告',exact:true}).count(),0);
 assert.equal(await page.locator('iframe[title="SEO报告预览"]').count(),0);
 await page.reload();await page.getByRole('button',{name:'报告与行动',exact:true}).nth(1).click();await page.getByRole('button',{name:'预览',exact:true}).first().click();await page.frameLocator('iframe[title="SEO报告预览"]').getByRole('heading',{name:'SEO 分析报告',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('SEO UI verified: scope selection, confirmation, snapshot preview, export, stale scope invalidation, history reload.');
}catch(e){console.log('UI errors:',errors);console.log((await page.locator('body').innerText()).slice(-3500));throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

