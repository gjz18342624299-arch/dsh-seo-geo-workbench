// extract 回归测试：用系统 Chrome（headless）+ 路由伪造成真实站点域名，验证修复后的提取算法。
// 覆盖：1) Gemini 外壳不可赢（历史 bug：答案=整壳、引用=导航链接）2) 引用 chip 对话框收割
//       3) DeepSeek 多块拼接 4) ChatGPT 叶子+引用范围 5) 空回答不误判
// 运行：node test/extract-regression.mjs
import {readFile} from 'node:fs/promises';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';

const bg=await readFile(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
function cut(startMarker,endMarker){
  const a=bg.indexOf(startMarker);if(a<0)throw Error('找不到 '+startMarker);
  const b=bg.indexOf(endMarker,a);if(b<0)throw Error('找不到 '+endMarker);
  return bg.slice(a,b);
}
const shortFn=cut('async function shortPageOperation(','// Gemini 等平台的正式引用');
const harvestFn=cut('async function harvestCitationsPage','async function execute(');

const Q='DSH Desktop 是 DeepSeek 官方产品吗？';
const geminiFixture=`<!doctype html><html><body>
<chat-app>
 <header>
  <a href="https://gemini.google.com/app">升级</a>
  <nav role="navigation"><a href="https://gemini.google.com/search">搜索</a><a href="https://gemini.google.com/students">学生</a><a href="https://gemini.google.com/library">库</a><a href="https://accounts.google.com/SignOutOptions?continue=https://gemini.google.com">账号</a></nav>
 </header>
 <main>
  <infinite-scroller>
   <div class="turn">
    <div class="user-bubble">你说 ${Q}<div>${Q}</div></div>
    <model-response>
     <div>Gemini 说</div>
     <div class="response-text">不是。DSH Desktop 是由开源社区维护的第三方开源项目，并非 DeepSeek（深度求索）官方发布的独立产品。两者的具体关系与区别如下：上游官方项目是 DeepSeek Harness，社区项目是 DSH Desktop。在使用 DSH Desktop 时如果遇到代码报错或客户端 Bug，应优先提交至对应的开源仓库解决，而非联系 DeepSeek 官方客服。
      <button aria-label="查看来自“GitHub”的引用内容的来源详情。按 Enter 键打开来源对话框。">GitHub</button>
      <button aria-label="查看来自“SegmentFault 思否”的引用内容的来源详情。按 Enter 键打开来源对话框。">SegmentFault 思否</button>
     </div>
    </model-response>
   </div>
  </infinite-scroller>
  <div class="composer"><textarea placeholder="为 Gemini 输入提示"></textarea></div>
  <div>Flash</div><div>Gemini 是一款 AI 工具，其回答未必正确无误。</div>
 </main>
</chat-app>
<div id="dlg-host"></div>
<script>
  const LINKS={'GitHub':'https://github.com/bruc3van/dsh-desktop?utm_source=gemini','SegmentFault 思否':'https://segmentfault.com/a/11900000'};
  document.querySelectorAll('button[aria-label*="来源详情"]').forEach(function(b){
    b.addEventListener('keydown',function(e){
      if(e.key!=='Enter')return;
      const host=document.getElementById('dlg-host');
      host.innerHTML='<div role="dialog" style="position:fixed;left:0;top:0;width:300px;height:100px;background:#fff"><a href="'+LINKS[b.innerText]+'">'+b.innerText+' 来源</a><button aria-label="关闭">x</button></div>';
      host.querySelector('button[aria-label="关闭"]').addEventListener('click',function(){host.innerHTML='';});
    });
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('dlg-host').innerHTML='';});
</script></body></html>`;

const deepseekFixture=`<!doctype html><html><body>
<nav><a href="https://chat.deepseek.com/">首页</a></nav>
<div class="chat">
 <div class="user">${Q}</div>
 <div class="ds-markdown">第一段回答：DSH Desktop 是社区维护的开源项目，并非官方产品。<a href="https://github.com/anywhere-labs/dsh-desktop">仓库</a></div>
 <div class="ds-markdown">第二段回答：它封装了官方运行时并提供桌面图形界面，方便非命令行用户使用。<a href="https://dshdesktop.com/">官网</a></div>
</div>
<textarea placeholder="输入"></textarea>
</body></html>`;

const chatgptFixture=`<!doctype html><html><body>
<main>
 <div data-message-author-role="user">${Q}</div>
 <div data-message-author-role="assistant">
  <div class="markdown">不是官方产品。DSH Desktop 由社区维护，官方并未发布同名桌面客户端。<a href="https://github.com/qufei1993/dsh-desktop?utm_source=chatgpt.com">GitHub</a></div>
  <div class="sources"><a href="https://dshdesktop.com/?utm_source=chatgpt.com">官网来源</a></div>
 </div>
 <div class="composer"><textarea></textarea></div>
</main></body></html>`;

const emptyFixture=`<!doctype html><html><body>
<chat-app><header><a href="https://gemini.google.com/app">升级</a><nav role="navigation"><a href="https://gemini.google.com/search">搜索</a></nav></header>
<main><div class="turn"><div class="user-bubble">你说 ${Q}<div>${Q}</div></div><div>Gemini 说</div></div>
<div>Flash</div><div>Gemini 是一款 AI 工具，其回答未必正确无误。</div></main>
<div class="composer"><textarea></textarea></div>
</chat-app></body></html>`;

// 延迟渲染夹具：response-text 的 innerText 恒为空（模拟 content-visibility 跳过渲染），
// extract 必须经 textContent 兜底拿到回答
const geminiLazyFixture=geminiFixture.replace('</body></html>',`<script>
  (function(){
    const d=document.querySelector('.response-text');
    Object.defineProperty(d,'innerText',{configurable:true,get(){return '';}});
  })();
</script></body></html>`);

// 历史容器回归：Gemini 会话滚动容器 class 含 "history"（线上 bug：badZone 把整条回答误杀 → 发送后未检测到回答）。
// 锚点感知外壳判定必须放行包含问题锚点的对话容器。
const geminiHistoryFixture=geminiFixture.replace('<infinite-scroller>','<infinite-scroller class="chat-history">');
// 无障碍回声回归：文档末尾的 aria-live/visually-hidden 区域复读“你说 …”，不得抢占问题锚点。
const geminiAriaFixture=geminiFixture.replace('</body></html>',`<div aria-live="polite" class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden">你说 ${Q}</div></body></html>`);

const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
// 路由伪造：让页面跑在真实域名下（extract 按 location.hostname 选平台选择器）
for(const [url,html] of [['https://gemini.google.com/app/test',geminiFixture],['https://chat.deepseek.com/test',deepseekFixture],['https://chatgpt.com/test',chatgptFixture],['https://gemini.google.com/app/empty',emptyFixture],['https://gemini.google.com/app/lazy',geminiLazyFixture],['https://gemini.google.com/app/history',geminiHistoryFixture],['https://gemini.google.com/app/aria',geminiAriaFixture]]){
  await page.route(url,r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
}
let pass=0,fail=0;
const check=(name,cond,extra='')=>{if(cond){pass++;console.log('PASS',name);}else{fail++;console.log('FAIL',name,extra);}};

async function extractOn(url,question){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{(0,eval)(s);},shortFn);
  return page.evaluate(q=>shortPageOperation('extract',{question:q}),question);
}

// 1. Gemini：回答必须干净（无“升级/与 Gemini 对话/你说/Gemini 说”），引用不得含导航链接
let r=await extractOn('https://gemini.google.com/app/test',Q);
check('gemini 回答不含页面外壳',!r.answer.includes('升级')&&!r.answer.includes('与 Gemini 对话')&&!r.answer.includes('你说'),JSON.stringify(r.answer).slice(0,120));
check('gemini 回答不含原题',!r.answer.includes(Q));
check('gemini 回答以正文开头',r.answer.startsWith('不是。DSH Desktop'),JSON.stringify(r.answer).slice(0,80));
check('gemini 引用不含导航链接',(r.citations||[]).every(u=>!/gemini\.google\.com|accounts\.google\.com/.test(u)),JSON.stringify(r.citations));

// 2. Gemini 引用 chip 对话框收割
await page.goto('https://gemini.google.com/app/test',{waitUntil:'domcontentloaded'});
await page.evaluate(s=>{(0,eval)(s);},harvestFn);
const h=await page.evaluate(()=>harvestCitationsPage({}));
check('chip 对话框收割到真实引用',h.citations.includes('https://github.com/bruc3van/dsh-desktop?utm_source=gemini')&&h.citations.includes('https://segmentfault.com/a/11900000'),JSON.stringify(h));
check('chip 数量识别正确',h.chips===2,JSON.stringify({chips:h.chips}));
const dlgLeft=await page.evaluate(()=>[...document.querySelectorAll('dialog,[role="dialog"]')].some(d=>d.getClientRects().length));
check('收割后对话框已关闭',!dlgLeft);

// 3. DeepSeek 多块拼接
r=await extractOn('https://chat.deepseek.com/test',Q);
check('deepseek 多块拼接',r.answer.includes('第一段回答')&&r.answer.includes('第二段回答'),JSON.stringify(r.answer).slice(0,120));
check('deepseek 引用来自回答块',r.citations.includes('https://github.com/anywhere-labs/dsh-desktop')&&r.citations.includes('https://dshdesktop.com/'),JSON.stringify(r.citations));

// 4. ChatGPT 叶子正文 + 引用范围含来源区
r=await extractOn('https://chatgpt.com/test',Q);
check('chatgpt 回答为正文叶子',r.answer.includes('不是官方产品')&&!r.answer.includes(Q),JSON.stringify(r.answer).slice(0,120));
check('chatgpt 引用含来源链接',r.citations.some(u=>u.includes('dshdesktop.com')),JSON.stringify(r.citations));

// 5. 空回答（Gemini 未生成）：不得把外壳当回答
r=await extractOn('https://gemini.google.com/app/empty',Q);
check('空回答不误判',r.answer==='',JSON.stringify(r.answer).slice(0,120));

// 6. 延迟渲染兜底：innerText 读不到时经 textContent 拿到回答
r=await extractOn('https://gemini.google.com/app/lazy',Q);
check('延迟渲染兜底拿到回答',r.answer.includes('不是。DSH Desktop')&&!r.answer.includes('升级')&&!r.answer.includes(Q),JSON.stringify(r.answer).slice(0,120));
check('dom 遥测字段存在',!!(r.dom&&r.dom.modelResponse&&r.dom.modelResponse.tc>0),JSON.stringify(r.dom));

// 7. 对话容器 class 含 "history"（线上 bug 场景）：锚点感知外壳判定不得误杀回答
r=await extractOn('https://gemini.google.com/app/history',Q);
check('history 容器内回答可提取',r.answer.startsWith('不是。DSH Desktop')&&!r.answer.includes(Q)&&!r.answer.includes('升级'),JSON.stringify(r.answer).slice(0,120));
check('history 容器内 dom 遥测正常',!!(r.dom&&r.dom.modelResponse&&r.dom.modelResponse.tc>0),JSON.stringify(r.dom));

// 8. 末尾 aria-live 复读（“你说 …”）不得抢占锚点
r=await extractOn('https://gemini.google.com/app/aria',Q);
check('aria 回声不抢占锚点',r.answer.startsWith('不是。DSH Desktop')&&!r.answer.includes(Q),JSON.stringify(r.answer).slice(0,120));

await browser.close();
console.log(JSON.stringify({pass,fail}));
process.exit(fail?1:0);
