import {readFile} from 'node:fs/promises';
const log=await readFile(new URL('../../qa-market-host-boot.log',import.meta.url),'utf8');
const url=log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];
if(!url)throw Error('Isolated host has not announced its local endpoint');
const base=new URL(url).origin;
const login=await fetch(url,{redirect:'manual'});const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const response=await fetch(base+'/api/seo-geo-v3/state',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-Monitor':'1',cookie},body:'{}'});
const text=await response.text();let state;try{state=JSON.parse(text);}catch{}
console.log(JSON.stringify({status:response.status,version:state?.version,brand:state?.brand?.name,platforms:state?.platforms?.length,error:state?.error||(!state?text.slice(0,180):undefined)}));
if(response.status!==200||!state?.platforms)process.exitCode=1;
