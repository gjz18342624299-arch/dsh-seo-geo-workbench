import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
const src=await readFile(process.env.GROK_TEST_SOURCE||new URL('../chrome-extension/background.js',import.meta.url),'utf8');
const fn=src.slice(src.indexOf('async function shortPageOperation('),src.indexOf('async function harvestCitationsPage('));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),q='DSH Desktop 是什么？';
 await page.route('https://grok.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<nav>${q}</nav><main><div class="message-bubble"><p>${q}</p></div><div class="response-content"><div class="markdown"><h2>${q}</h2><p>这是社区开发的桌面客户端。这里是足够长的回答正文，需要完整保存，而不能把标题当作新的用户问题。</p><a href="https://example.com/source">证据链接</a><p>${q}</p></div></div></main><div aria-live="polite">${q}</div><textarea></textarea>`}));
 await page.goto('https://grok.com/c/fixture');await page.evaluate(code=>(0,eval)(code+'\nglobalThis.extractTest=shortPageOperation;'),fn);
 const extract=()=>page.evaluate(q=>globalThis.extractTest('extract',{question:q}),q);
 const got=await extract();assert.ok(got.answer.includes('社区开发'),JSON.stringify(got));assert.ok(got.answer.includes(q));assert.deepEqual(got.citations,['https://example.com/source']);
 // Regression: actual Grok user turns share prose/markdown classes with answers.
 await page.evaluate(()=>{const user=document.querySelector('.message-bubble');user.className='message-bubble relative text-primary prose prose-chat';user.innerHTML='<div class="relative"><div class="relative response-content-markdown markdown chat-md"><p dir="auto" class="break-words" style="white-space:pre-wrap">'+user.textContent+'</p></div></div>';});
 const live=await extract();assert.equal(live.questionVisible,true,JSON.stringify(live));assert.equal(live.answer,got.answer);assert.deepEqual(live.citations,got.citations);
 await page.evaluate(()=>{const layout=document.createElement('div');layout.className='group/sidebar-wrapper flex min-h-screen';const main=document.querySelector('main');main.replaceWith(layout);layout.append(main);});
 const wrapped=await extract();assert.equal(wrapped.questionVisible,true,JSON.stringify(wrapped));assert.equal(wrapped.answer,got.answer);assert.deepEqual(wrapped.citations,got.citations);
 // A stable thinking status must never substitute for the answer.
 await page.evaluate(()=>{const status=document.createElement('div');status.className='thinking-content';status.textContent='执行了 3 次搜索 正在思考 Explaining what DSH Desktop is';document.querySelector('main').insertBefore(status,document.querySelector('main > .response-content'));});
 assert.equal((await extract()).answer,got.answer);
 await page.evaluate(()=>{document.querySelector('main > .response-content').style.display='none';});
 assert.equal((await extract()).answer,'','thinking-only page must wait for the final answer');
 await page.evaluate(()=>{const response=document.querySelector('main > .response-content');response.style.display='';const layout=document.createElement('div');layout.className='sidebar-offset';response.replaceWith(layout);layout.append(response);});
 assert.equal((await extract()).answer,got.answer,'response layout classes must not exclude final prose');
 await page.evaluate(()=>document.querySelector('.message-bubble').remove());assert.equal((await extract()).answer,'','answer or sidebar echo alone must not prove user submission');
 await page.evaluate(q=>{document.querySelector('.response-content').remove();document.querySelector('main').innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';},q);assert.equal((await extract()).answer,'');
 console.log('Grok: live user markdown/prose, repeated question, final echo, citations and no-user/no-answer guards passed');
}finally{await browser.close();}
