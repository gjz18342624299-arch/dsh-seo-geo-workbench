import test from 'node:test';
import assert from 'node:assert/strict';
import {ChromeBridge,ChromePage} from '../chrome-bridge.js';
const origin='chrome-extension://'+'a'.repeat(32);
test('Chrome bridge rejects webpages and wrong tokens, pairs one extension, correlates results',async()=>{
 const b=new ChromeBridge();const {connection}=await b.pairing();const c=JSON.parse(connection);
 const post=(path,body,from=origin)=>fetch(c.endpoint+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:from},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/poll',{token:c.token},'https://example.com')).status,403);
  assert.equal((await post('/poll',{token:'incorrect'})).status,403);
  const poll=post('/poll',{token:c.token});
  for(let i=0;i<100&&!b.connected();i++)await new Promise(r=>setTimeout(r,5));assert.ok(b.connected());
  const page=new ChromePage(b),result=page.goto('https://chat.deepseek.com/');const command=(await (await poll).json()).command;
  assert.equal(command.action,'open');assert.equal(command.args.url,'https://chat.deepseek.com/');
  assert.equal((await post('/result',{token:c.token,id:command.id,value:{url:'https://chat.deepseek.com/'}})).status,200);
  await result;assert.equal(page.url(),'https://chat.deepseek.com/');
  assert.equal((await post('/poll',{token:c.token},'chrome-extension://'+'b'.repeat(32))).status,403);
  assert.equal((await post('/result',{token:c.token,id:'old'})).status,409);
  const pending=assert.rejects(b.request('snapshot'),/断开/);b.disconnect();await pending;assert.equal(b.connected(),false);
  assert.equal((await post('/poll',{token:c.token})).status,403);
 }finally{await b.close();}
});
test('Chrome disconnected collection never silently opens Edge',async()=>{
 const {Collector}=await import('../collector-chrome.js');
 const collector=new Collector({root:process.cwd()});
 await assert.rejects(collector.open({url:'https://chat.deepseek.com'},{automated:true}),/Chrome/);
 assert.equal(collector.page,null);await collector.close();
});
