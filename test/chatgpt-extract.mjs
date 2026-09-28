import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
const source=await readFile(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function shortPageOperation('),source.indexOf('async function harvestCitationsPage('));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 const q='DSH Desktop 是什么？';
 const answer=q+'这是一段足够长的测试回答，引用原题但仍属于本轮助手消息，需要保留全部正文。';
 await page.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<nav>${q}</nav><form><main class="sidebar-layout chat-history"><div data-message-author-role="assistant">旧回答内容足够长但不属于当前问题，不能采集这一段。</div><div data-message-author-role="user">${q}</div><div data-message-author-role="assistant"><div class="markdown">${answer}<a href="https://example.org/evidence">证据</a></div></div></main></form><div aria-live="polite">${q}</div><textarea></textarea>`}));
 await page.goto('https://chatgpt.com/c/fixture');
 await page.evaluate(code=>(0,eval)(code+'\nglobalThis.extractTest=shortPageOperation;'),fn);
 const extract=()=>page.evaluate(q=>globalThis.extractTest('extract',{question:q}),q);
 const result=await extract();
 assert.ok(result.answer.includes(answer),JSON.stringify(result));
 assert.ok(!result.answer.includes('旧回答'));
 assert.deepEqual(result.citations,['https://example.org/evidence']);
 await page.evaluate(()=>document.querySelectorAll('[data-message-author-role="assistant"]')[1].remove());
 assert.equal((await extract()).answer,'','must not collect old assistant turn');
 await page.evaluate(q=>document.querySelector('main').insertAdjacentHTML('beforeend',`<div data-message-author-role="user">另一个问题</div><div data-message-author-role="assistant">另一个问题的回答，虽然足够长也不能归入前面的采样问题。</div>`),q);
 assert.equal((await extract()).answer,'','must not collect next user turn answer');
 console.log('ChatGPT extraction: shell, quoted question, citations, old/next turn guards passed');
}finally{await browser.close();}
