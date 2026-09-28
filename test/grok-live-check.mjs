import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const log=await readFile(join(process.env.APPDATA,'dsh-desktop/logs/harness.log'),'utf8');
const loginUrl=[...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)].at(-1)?.[1];
if(!loginUrl)throw Error('DSH 未启动');
const login=await fetch(loginUrl,{redirect:'manual'}),cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
const [op='status',raw='{}']=process.argv.slice(2);
async function api(op,data={}){
 const r=await fetch(new URL('/api/seo-geo-v3/'+op,loginUrl),{method:'POST',headers:{'Content-Type':'application/json','X-DSH-Monitor':'1',cookie},body:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw Error(value.error||String(r.status));return value;
}
if(op==='status'){
 const s=await api('state');
 console.log(JSON.stringify({runners:await api('runner-status'),grok:s.tasks.filter(t=>t.platformId==='grok'&&t.batchId==='b957e923-c924-4e16-a6ae-1ad8f12b361a').map(t=>({id:t.id,question:t.question,status:t.status,error:t.error,sampleId:t.sampleId,steps:t.steps})),connection:await api('chrome-connection').then(x=>({connected:x.connected,version:x.clientVersion}))},null,2));
}else if(['batch-stop','batch-start','action','chrome-reload-extension'].includes(op)){
 const value=await api(op,JSON.parse(raw));
 console.log(JSON.stringify(op==='action'?{ok:true,revision:value.revision}:value));
}
else throw Error('不支持的检查操作');
