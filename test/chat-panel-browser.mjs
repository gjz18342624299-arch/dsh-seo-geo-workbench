import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {build} from '../vendor/node_modules/esbuild/lib/main.js';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
import {Store} from '../store.js';
import {createHandler} from '../server.js';
const qa=new URL('../../qa-chat-panel/',import.meta.url);await fs.mkdir(qa,{recursive:true});
const raw=await fs.readFile(process.env.CHAT_PANEL_SOURCE||new URL('../client.js',import.meta.url),'utf8');
const nativeFrame=raw.includes('function WorkbenchPanel(');
const source=raw.replace('function apply(ctx){','globalThis.qaPanel='+(nativeFrame?'WorkbenchPanel':'FloatPanel')+';globalThis.qaSetPanel=setPanel; function apply(ctx){');
const entry=`import React from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react/index.js',import.meta.url)))};import {createRoot} from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react-dom/client.js',import.meta.url)))};
window.__ModuleLoader__={load(m){m.factory(n=>React);}};
${source}
globalThis.qaSetPanel({open:true,chat:true});
createRoot(document.getElementById('root')).render(React.createElement(globalThis.qaPanel,{runtime:{},conversation:React.createElement('p',null,'Native conversation fixture')}));`;
await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,format:'iife',outfile:fileURLToPath(new URL('app.js',qa))});
await fs.writeFile(new URL('index.html',qa),'<html><meta charset="utf-8"><body class="dsh-desktop-windows-titlebar-layout" style="margin:0"><div id="root" style="height:100vh;display:flex"></div><script src="/app.js"></script></body></html>');
const store=new Store(fileURLToPath(qa));
const handler=createHandler(store,{}, {'/':[fileURLToPath(new URL('index.html',qa)),'text/html'],'/app.js':[fileURLToPath(new URL('app.js',qa)),'text/javascript']});
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const collapse=page.getByRole('button',{name:'收起对话，展开工作台',exact:true});
 await collapse.waitFor();
 assert.ok((await collapse.boundingBox()).y>=36,'button must clear the native 36px Windows drag strip');
 const panel=page.getByRole('region',{name:nativeFrame?'SEO GEO 工作台':'SEO GEO 工作台浮层',exact:true});
 const before=await panel.boundingBox();
 const nav=page.getByRole('navigation',{name:'工作台导航'});
 for(const label of ['SEO 分析','数据接入','GEO 分析','数据看板']){
  await nav.getByRole('button',{name:label,exact:true}).click();
  await page.getByRole('heading',{name:label,exact:true}).waitFor();
  assert.equal(await collapse.isVisible(),true,`${label} must preserve chat`);
 }
 await collapse.click();assert.equal(await collapse.count(),0);
 const nativeChat=page.getByLabel('报告原生对话');
 if(nativeFrame)assert.equal(await nativeChat.isVisible(),false,'collapsing must hide the native conversation pane');
 else assert.ok((await panel.boundingBox()).width>before.width,'collapsed workbench must actually expand');
 await nav.getByRole('button',{name:'SEO 分析',exact:true}).click();
 assert.equal(await collapse.count(),0,'navigation must respect manual collapse');
 await page.getByRole('button',{name:'展开对话',exact:true}).click();await collapse.waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: chat survives navigation across four pages, explicit collapse stays closed, chat can reopen.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
