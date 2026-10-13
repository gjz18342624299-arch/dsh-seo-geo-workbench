import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBing} from '../syncers.js';
test('Bing WCF dates accept milliseconds and offsets, invalid dates do not crash sync',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>({ok:true,status:200,text:async()=>JSON.stringify({d:String(url).includes('GetRankAndTrafficStats')?[
  {Date:'/Date(1790553600000)/',Clicks:1},
  {Date:'/Date(1790553600000+0800)/',Clicks:2},
  {Date:'/Date(999999999999999999999)/'},
  {Date:'invalid'}]:[]})});
 try{const result=await syncBing({read:async()=>({credentials:{bingApiKey:'test'},brand:{domain:'example.com'}}),addSyncBatch:async batch=>batch});assert.equal(result.records.length,2);assert.equal(result.records[0].date,new Date(1790553600000).toISOString());assert.equal(result.records[1].date,result.records[0].date);}finally{globalThis.fetch=old;}
});

test('Bing page URLs in Query and source dates survive sync; invalid dates stay unknown',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>({ok:true,status:200,text:async()=>JSON.stringify({d:String(url).includes('GetPageQueryStats')?[]:String(url).includes('GetPageStats')?[{Query:'https://example.com/',Date:'/Date(1790294400000)/',Clicks:2,Impressions:20}]:String(url).includes('GetQueryStats')?[{Query:'same',Date:'2026-09-25T00:00:00Z'},{Query:'same',Date:'2026-10-02T00:00:00Z'},{Query:'unknown',Date:'invalid'}]:[]})});
 try{const result=await syncBing({read:async()=>({credentials:{bingApiKey:'test'},brand:{domain:'example.com'}}),addSyncBatch:async batch=>batch});
 assert.equal(result.records.length,4);assert.equal(result.records[3].page,'https://example.com/');assert.equal(result.records[0].date,'2026-09-25T00:00:00.000Z');assert.equal(result.records[1].date,'2026-10-02T00:00:00.000Z');assert.equal(result.records[2].date,'');assert.equal(result.records[3].dimension,'snapshot-page');assert.ok(result.note.includes('页面收到 1 行 / 接收 1 行'));
 }finally{globalThis.fetch=old;}
});

test('page query associations preserve the requested URL and partial failures',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async value=>{const u=new URL(value);calls.push(u);const endpoint=u.pathname.split('/').at(-1);
 if(endpoint==='GetPageQueryStats'&&u.searchParams.get('page').endsWith('/failed'))throw Error('fixture failure');
 const d=endpoint==='GetPageStats'?[{Query:'https://example.com/zh',Date:'2026-10-09'},{Query:'https://example.com/failed',Date:'2026-10-09'}]:endpoint==='GetPageQueryStats'?[{Query:'desktop',Date:'2026-10-09',Clicks:5,Impressions:10}]:[];
 return {ok:true,status:200,text:async()=>JSON.stringify({d})};};
 try{const result=await syncBing({read:async()=>({credentials:{bingApiKey:'test'},brand:{domain:'example.com'}}),addSyncBatch:async batch=>batch});const rows=result.records.filter(r=>r.dimension==='snapshot-query-page');assert.equal(rows.length,1);assert.equal(rows[0].keyword,'desktop');assert.equal(rows[0].page,'https://example.com/zh');assert.equal(rows[0].raw.associationEndpoint,'GetPageQueryStats');assert.ok(result.note.includes('失败 1 页'));assert.equal(calls.filter(u=>u.pathname.endsWith('/GetPageQueryStats')).length,2);}finally{globalThis.fetch=old;}
});
