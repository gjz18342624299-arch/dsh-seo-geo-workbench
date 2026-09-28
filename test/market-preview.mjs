import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from '../vendor/node_modules/esbuild/lib/main.js';
import {Store} from '../store.js';
import {createHandler} from '../server.js';
const qa=new URL('../../qa-market-browser/',import.meta.url);await mkdir(qa,{recursive:true});
const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
const entry=`import React from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react/index.js',import.meta.url)))};import {createRoot} from ${JSON.stringify(fileURLToPath(new URL('../vendor/node_modules/react-dom/client.js',import.meta.url)))};
let registered,cleanup=[];const ctx={effect:fn=>cleanup.push(fn()),remote:{},sessions:{},workspaces:{},uiWorkspace:{},desktopWorkbenches:{register:(descriptor,Panel)=>{registered=Panel;return()=>{};},leave:()=>{}}};
window.__ModuleLoader__={load(m){m.factory(n=>React).apply(ctx);}};
${source}
function Harness(){const [chat,setChat]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('div',{style:{height:34,flex:'0 0 auto'}},'隔离验收环境 · 无真实账号或模型调用 ',React.createElement('button',{onClick:()=>{setPanel({chat:!chat});setChat(!chat);}},'验收：切换报告对话')),React.createElement(registered,{active:true,conversation:React.createElement('div',null,'宿主原生会话节点（验收占位）')}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));`;
// Expose only through the QA bundle, never the distributed client.
const exposed=entry.replace('function WorkbenchPanel(', 'window.qaSetPanel=setPanel;function WorkbenchPanel(').replace('setPanel({chat:!chat})','window.qaSetPanel({chat:!chat})');
await build({stdin:{contents:exposed,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,format:'iife',outfile:fileURLToPath(new URL('app.js',qa))});
await writeFile(new URL('index.html',qa),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GEO SEO 市场版隔离验收</title><style>html,body{margin:0;height:100%}#root{height:100%;display:flex;flex-direction:column;overflow:hidden}</style><div id="root"></div><script src="/app.js"></script></html>');
const handler=createHandler(new Store(fileURLToPath(qa)),{}, {'/':[fileURLToPath(new URL('index.html',qa)),'text/html; charset=utf-8'],'/app.js':[fileURLToPath(new URL('app.js',qa)),'text/javascript']},async()=>({groups:[]}));
const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));console.log('Preview: http://127.0.0.1:'+server.address().port);
