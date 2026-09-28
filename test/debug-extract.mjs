// 调试：打印 Gemini 夹具下每个候选元素的过滤情况 + chip 对话框事件触发
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
const Q='DSH Desktop 是 DeepSeek 官方产品吗？';
const html=`<!doctype html><html><body>
<chat-app><header><nav role="navigation"><a href="https://gemini.google.com/search">搜索</a></nav></header>
<main><infinite-scroller><div class="turn">
<div class="user-bubble">你说 ${Q}<div>${Q}</div></div>
<model-response><div>Gemini 说</div>
<div class="response-text">不是。DSH Desktop 是由开源社区维护的第三方开源项目，并非 DeepSeek 官方发布的独立产品。<button aria-label="查看来自GitHub的引用内容的来源详情。按 Enter 键打开来源对话框。">GitHub</button> 两者的具体关系与区别如下，内容需要足够长用于测试。</div>
</model-response></div></infinite-scroller>
<div class="composer"><textarea></textarea></div></main></chat-app></body></html>`;

const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
await page.setContent(html,{waitUntil:'domcontentloaded'});
const info=await page.evaluate(q=>{
  const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const els=[...document.querySelectorAll('model-response,[class*="response-text"],[class*="markdown"]')];
  return els.map(e=>({tag:e.tagName,cls:String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className),visible:visible(e),len:(e.innerText||'').trim().length,hasQ:(e.innerText||'').includes(q)}));
},Q);
console.log('candidates pool:',JSON.stringify(info,null,1));

// chip 对话框
await page.evaluate(()=>{
  document.querySelectorAll('button[aria-label*="来源详情"]').forEach(b=>{
    b.addEventListener('keydown',e=>{
      window.__fired=(window.__fired||0)+1;
      if(e.key!=='Enter')return;
      const d=document.createElement('div');d.setAttribute('role','dialog');d.style.position='fixed';
      d.innerHTML='<a href="https://github.com/bruc3van/dsh-desktop">x</a>';
      document.body.appendChild(d);
    });
  });
  const b=document.querySelector('button[aria-label*="来源详情"]');
  const code=13;
  for(const type of ['keydown','keypress','keyup'])b.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:code,which:code,bubbles:true,cancelable:true}));
});
const fired=await page.evaluate(()=>window.__fired||0);
const dlg=await page.evaluate(()=>document.querySelectorAll('dialog,[role="dialog"]').length);
console.log('chip keydown fired:',fired,'dialogs open:',dlg);
await browser.close();
