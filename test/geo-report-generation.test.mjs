import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

for (const variant of ['../client.js','../../chat-collapse-live/client.js']) {
 const source=await readFile(new URL(variant,import.meta.url),'utf8');
 const parser=source.slice(source.indexOf(' function textFromSession('),source.indexOf(' async function ',source.indexOf(' function textFromSession(')));
 const start=source.indexOf(' async function runNative(');
 const runner=source.slice(start,source.indexOf('\n //',start));
 const load=new Function('call','ownedSession',parser+'\n'+runner+'\nreturn runNative;');
 test(variant+': background generation is not archived before the model runs',async()=>{
  let archived=false,released=false,entries=[];
  const session={open:async()=>{},prompt:async()=>{entries=archived?[{type:'turn/end',data:{reason:{kind:'blocked'}}}]:[{type:'assistant/message',data:{message:{content:[{type:'text',text:'REPORT'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}}];return {ok:true};},resync:async()=>{},getSnapshot:()=>({running:false}),eventSource:{getSnapshot:()=>({entries})}};
  const runtime={sessions:{create:async()=>'test',retain:()=>({ready:Promise.resolve(),binding:{session},release:()=>{released=true;}})},workspaces:{archiveSession:async()=>{archived=true;}}};
  const result=await load(async()=>{},async()=>'test')(runtime,'prompt',()=>{},new AbortController().signal,null,{archive:true});
  assert.equal(result.text,'REPORT');assert.equal(released,true);assert.equal(archived,false);
 });
 test(variant+': blocked turn surfaces its actual reason',async()=>{
  const parse=new Function(parser+';return textFromSession;')();
  const result=parse({eventSource:{getSnapshot:()=>({entries:[{type:'turn/end',data:{reason:{kind:'blocked'}}}]})}});
  assert.match(result.failure,/阻止.*未归档/);
 });
 test(variant+': preview shows an estimate, saves analysis, then opens HTML',async()=>{
  const begin=source.indexOf('  const ensureDeepAnalysis=');
  const end=source.indexOf('  const deepTotal=',begin);
  const jobs=[],calls=[],messages=[];let preview=null,saved=false;
  const reportJob={current:null};
  const run=new Function('reportJob','call','reportFilter','setMessage','estimateMinutes','setReportJob','analyzeVisible','setReportPreview','elapsedMin','download',source.slice(begin,end)+'return runReport;')(
   reportJob,async(op)=>{calls.push(op);if(op==='deep-status')return {scope:150};if(op==='analysis')return {selected:[{id:'sample'}]};if(op==='report'){assert.equal(saved,true);return {text:'<html>REPORT</html>'};}throw Error(op);},format=>({cbatches:['selected-batch'],format}),m=>messages.push(m),scope=>({lo:15,hi:25}),j=>{reportJob.current=j;jobs.push(j);},async()=>{assert.equal(jobs.at(-1).done,false);saved=true;},html=>{preview=html;},()=>0,()=>{});
  await run('preview');
  assert.match(messages.join('\n'),/15~25 分钟/);assert.deepEqual(calls,['deep-status','analysis','report']);assert.equal(jobs.at(-1).done,true);assert.equal(preview,'<html>REPORT</html>');
 });
}

// 2026-09-28 回归：makePayloadPrompt 曾在 0.12.0 被 sync-client.mjs 抹掉（只存在于 client.js 内嵌段、不在 analysis.js），
// 调用方 try/catch 静默退回内联 8 万字符提示，kimi-k3 单步生成超过 8 分钟即被看门狗掐断，报告永远生成不出来。
test('deep analysis payload prompt exists in analysis.js and client.js and points at absolute files',async()=>{
 const analysis=await readFile(new URL('../analysis.js',import.meta.url),'utf8');
 const client=await readFile(new URL('../client.js',import.meta.url),'utf8');
 assert.match(analysis,/^export function makePayloadPrompt\(/m);
 assert.match(client,/^function makePayloadPrompt\(/m);
 const begin=client.indexOf('const ANALYSIS_RULES='),end=client.indexOf('\n}\n',client.indexOf('function makePayloadPrompt('))+3;
 const make=new Function(client.slice(begin,end)+'return makePayloadPrompt;')();
 const prompt=make({brand:{name:'X'}},{path:'D:/data/payload.json',specPath:'D:/spec.md'},202,'',' NOTE');
 assert.match(prompt,/202 条记录/);assert.match(prompt,/D:\/data\/payload\.json/);assert.match(prompt,/D:\/spec\.md/);
 assert.doesNotMatch(prompt,/outputs\/32-GEO/);assert.match(prompt,/除用 read 读取下面指定的两个文件外/);
 assert.match(client,/catch\(e\)\{console\.warn\('\[seo-geo\] 分析资料落盘失败/);
 assert.doesNotMatch(client,/idleLimit=running\?480000/);
});
test('watchdog counts new session events as progress and salvages text after cancel',async()=>{
 const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
 const parser=source.slice(source.indexOf(' function textFromSession('),source.indexOf(' async function ',source.indexOf(' function textFromSession(')));
 const start=source.indexOf(' async function runNative(');
 const runner=source.slice(start,source.indexOf('\n //',start)).replace('setTimeout(r,1800)','setTimeout(r,1)').replace('setTimeout(r,1500)','setTimeout(r,1)');
 const load=new Function('call','ownedSession',parser+'\n'+runner+'\nreturn runNative;');
 let entries=[],cancelled=false,tick=0;
 const session={open:async()=>{},prompt:async()=>({ok:true}),resync:async()=>{tick++;if(tick<4)entries=[...entries,{type:'tool/call',data:{}}];if(cancelled)entries=[...entries,{type:'assistant/message',data:{message:{content:[{type:'text',text:'SG-ANALYSIS-BEGIN partial'}]}}}];},getSnapshot:()=>({running:true}),cancel:async()=>{cancelled=true;},eventSource:{getSnapshot:()=>({entries})}};
 const runtime={sessions:{create:async()=>'t',retain:()=>({ready:Promise.resolve(),binding:{session},release:()=>{}})}};
 const controller=new AbortController();
 const run=load(async()=>{},async()=>'t')(runtime,'p',()=>{},controller.signal,null,{});
 await new Promise(r=>setTimeout(r,30));controller.abort();
 await assert.rejects(run,e=>{assert.equal(cancelled,true);assert.match(e.message,/已停止等待/);assert.match(e.partial,/SG-ANALYSIS-BEGIN partial/);return true;});
});
