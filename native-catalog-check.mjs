import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
// Local DSH application authentication stays in memory and is never printed or saved.
const log=await readFile(join(process.env.APPDATA,'dsh-desktop/logs/harness.log'),'utf8');
const matches=[...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)];const loginUrl=matches.at(-1)?.[1];if(!loginUrl)throw Error('DSH 未启动');
const base=new URL(loginUrl).origin,login=await fetch(loginUrl,{redirect:'manual'}),cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
async function rpc(method,args){const rpcId=randomUUID(),r=await fetch(`${base}/api/${method}`,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});const b=await r.json();if(!b.result?.ok)throw Error(b.result?.error?.message||'RPC failed');return b.result.value;}
const r=await fetch(base+'/api/seo-geo-v3/state',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-Monitor':'1',cookie},body:'{}'});const s=await r.json();console.log('Native state',r.status,s.version,s.platforms?.length);
const catalog=await rpc('session/modelCatalog',{});console.log(JSON.stringify({default:catalog.default,providers:catalog.groups}));
if(process.argv.includes('--configure')){
 const {sessionId}=await rpc('session/create',{request:{cwd:JSON.parse(await readFile(new URL('./deployment.json',import.meta.url),'utf8')).projectRoot}});
 const result=await fetch(base+'/api/seo-geo-v3/configure-session',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-Monitor':'1',cookie},body:JSON.stringify({sessionId,reasoningEffort:'off'})});console.log('Session configuration',result.status,await result.text());
}


