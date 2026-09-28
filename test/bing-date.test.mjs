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
