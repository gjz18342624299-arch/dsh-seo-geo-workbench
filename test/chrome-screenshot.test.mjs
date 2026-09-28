import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../chrome-extension/background.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function execute('),source.indexOf('async function loop('));
test('screenshot retries transient readback and refuses changed tab',async()=>{
 const tab={id:7,windowId:2,url:'https://gemini.google.com/app/fixture'};
 let captures=0,changed=false;const updates=[],delays=[];
 const chrome={windows:{get:async()=>({state:'minimized'}),update:async(id,v)=>updates.push(v)},tabs:{get:async()=>tab,update:async()=>{},query:async()=>[{...tab,id:changed?8:7}],captureVisibleTab:async()=>{if(++captures===1)throw Error('Failed to capture tab: image readback failed');return 'data:image/png;base64,fixture';}}};
 const ctx=vm.createContext({chrome,URL,contexts:new Map([['default',{tabId:7,allowedOrigin:'https://gemini.google.com'}]]),wait:async ms=>delays.push(ms)});
 vm.runInContext(fn,ctx);
 const command={action:'screenshot',args:{},expiresAt:Date.now()+10000};
 const result=await ctx.execute(command);
 assert.equal(captures,2);assert.equal(result.url,tab.url);assert.equal(updates[0].state,'normal');assert.ok(delays[0]>=700);
 changed=true;
 await assert.rejects(ctx.execute(command),/不在前台或已跳转/);
 assert.equal(captures,2);
});
