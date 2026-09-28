import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '../vendor/node_modules/playwright-core/index.mjs';
const source=await readFile(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function shortPageOperation('),source.indexOf('async function harvestCitationsPage('));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 const q='DSH Desktop 是 DeepSeek 官方产品吗？';
 const answer='不是。'+q+'这是一份测试回答，用于确认重复问题文字不会使真实回答被排除。请核对官方网站和产品出品方。';
 await page.route('https://gemini.google.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<style>user-query,model-response{display:block;padding:20px}</style><nav>${q}</nav><main class="chat-history"><user-query>${q}</user-query><model-response><div class="response-text">${answer}<a href="https://example.org/evidence">证据</a></div></model-response></main><div aria-live="polite">你说 ${q}</div><textarea></textarea>`}));
 await page.goto('https://gemini.google.com/app');
 await page.evaluate(code=>(0,eval)(code+'\nglobalThis.extractTest=shortPageOperation;'),fn);
 const result=await page.evaluate(q=>globalThis.extractTest('extract',{question:q}),q);
 assert.ok(result.answer.includes(answer),JSON.stringify(result));
 assert.deepEqual(result.citations,['https://example.org/evidence']);
 // A form suppresses generic anchors; the history shell then rejects all generic answers.
 await page.evaluate(()=>{const main=document.querySelector('main');const form=document.createElement('form');main.before(form);form.append(main);});
 const fallback=await page.evaluate(q=>globalThis.extractTest('extract',{question:q}),q);
 assert.ok(fallback.answer.includes(answer),JSON.stringify(fallback));
 assert.deepEqual(fallback.citations,['https://example.org/evidence']);
 await page.evaluate(()=>document.querySelector('model-response').remove());
 const empty=await page.evaluate(q=>globalThis.extractTest('extract',{question:q}),q);
 assert.equal(empty.answer,'');
 console.log('Gemini fixture: quoted question, chat-history, aria-live echo and no-answer checks passed');
}finally{await browser.close();}
