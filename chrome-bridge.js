import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

// Product-local extension bridge. No browser profiles or cookies are accessed.
export class ChromeBridge {
 constructor({statePath}={}){this.pending=new Map();this.queue=[];this.lastSeen=0;this.origin='';this.clientVersion='';this.token='';this.port=0;this.statePath=statePath;this.server=null;this.starting=null;}
 connected(){return !!this.origin&&Date.now()-this.lastSeen<30000;}
 async persist(){if(!this.statePath)return;await mkdir(dirname(this.statePath),{recursive:true});await writeFile(this.statePath,JSON.stringify({port:this.port,token:this.token}));}
 async start(){
  if(this.starting)return this.starting;
  this.starting=(async()=>{let saved={};if(this.statePath)try{saved=JSON.parse(await readFile(this.statePath,'utf8'));}catch{}this.token=/^[a-f0-9]{64}$/.test(saved.token||'')?saved.token:randomBytes(32).toString('hex');this.server=createServer((req,res)=>this.handle(req,res));const listen=port=>new Promise((ok,bad)=>{const onError=e=>{this.server.off('listening',onListening);bad(e);},onListening=()=>{this.server.off('error',onError);ok();};this.server.once('error',onError);this.server.once('listening',onListening);this.server.listen(port,'127.0.0.1');});const preferred=Number.isInteger(saved.port)&&saved.port>1024&&saved.port<65536?saved.port:0;try{await listen(preferred);}catch(e){if(!preferred||e.code!=='EADDRINUSE')throw e;this.server=createServer((req,res)=>this.handle(req,res));await listen(0);}this.port=this.server.address().port;await this.persist();})();
  await this.starting;
 }
 async pairing(){await this.start();return {connection:JSON.stringify({endpoint:`http://127.0.0.1:${this.port}`,token:this.token}),connected:this.connected(),clientVersion:this.clientVersion||'旧版',requiresReload:this.connected()&&this.clientVersion!=='0.5.11'};}
  // 让已连接的旧版扩展就地重载（新代码已随项目目录更新）。重载后需扩展重新轮询才恢复连接。
  reloadExtension(){if(!this.connected())return Promise.reject(Error('扩展尚未连接'));return this.request('reload-extension');}
 async handle(req,res){
  const origin=req.headers.origin||'';
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...( /^chrome-extension:\/\/[a-p]{32}$/.test(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==`127.0.0.1:${this.port}`||req.socket.remoteAddress!=='127.0.0.1'||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return send(403,{error:'仅允许本机 Chrome 扩展'});
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});return res.end();}
   if(req.method!=='POST')return send(405,{error:'POST required'});
   let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('结果过大');text+=chunk;}
   const data=JSON.parse(text),given=Buffer.from(String(data.token||'')),expected=Buffer.from(this.token);
   if(given.length!==expected.length||!timingSafeEqual(given,expected)||this.origin&&origin!==this.origin)return send(403,{error:'连接码无效，请在工作台重新获取'});
   if(!['/poll','/result','/disconnect'].includes(req.url))return send(404,{error:'unknown operation'});
   this.origin=origin;this.clientVersion=String(data.clientVersion||'');this.lastSeen=Date.now();
   if(req.url==='/disconnect'){this.disconnect();return send(200,{ok:true});}
   if(req.url==='/result'){
    const p=this.pending.get(data.id);if(!p)return send(409,{error:'指令已过期'});
    clearTimeout(p.timer);this.pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.value);return send(200,{ok:true});
   }
   const until=Date.now()+18000;
   while(!this.queue.length&&Date.now()<until&&!res.destroyed)await new Promise(r=>setTimeout(r,200));
   if(!res.destroyed)send(200,{command:this.queue.shift()||null});
  }catch(e){if(!res.headersSent)send(400,{error:e.message});}
 }
 request(action,args={}){
  if(!this.connected())return Promise.reject(Error('请先在“我的 Chrome”连接扩展。已有登录状态会在连接后复用。'));
  const timeout=action==='collect'?210000:action==='open'?120000:action==='harvest-citations'?100000:45000,id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.queue=this.queue.filter(c=>c.id!==id);reject(Error('浏览器操作超时（'+action+'，等待 '+Math.round(timeout/1000)+' 秒），请检查扩展连接及目标标签页'));},timeout);this.pending.set(id,{resolve,reject,timer});this.queue.push({id,action,args,expiresAt:Date.now()+timeout-1000});});
 }
 clear(message='Chrome 连接已断开'){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.queue=[];this.lastSeen=0;this.origin='';this.clientVersion='';}
 disconnect(){this.clear();this.token=randomBytes(32).toString('hex');this.persist().catch(()=>{});}
 async close(){this.clear('DSH 正在重启');this.server?.closeAllConnections();if(this.server)await new Promise(r=>this.server.close(r));}
}

export class ChromePage {
 constructor(bridge,contextId='default'){this.bridge=bridge;this.contextId=contextId;this.currentUrl='';}
 async command(action,args={}){const result=await this.bridge.request(action,{...args,contextId:this.contextId});if(result?.url)this.currentUrl=result.url;return result;}
 async goto(url){return this.command('open',{url});}
 async collect(question,mode){return this.command('collect',{question,mode});}
 async submit(question){return this.command('submit',{question});}
 async extract(question){return this.command('extract',{question});}
 async harvestCitations(){return this.command('harvest-citations',{});}
 async close(){return this.command('close');}
 url(){return this.currentUrl;}
 locator(selector){return this.target({selector});}
 getByRole(role,{name}){return this.target({role,name});}
 target(target){return {click:()=>this.command('click',target),fill:text=>this.command('fill',{...target,text}),press:key=>this.command('press',{...target,key}),innerText:async()=>(await this.command('text',target)).text,ariaSnapshot:async()=>(await this.command('snapshot')).snapshot,evaluateAll:async()=>(await this.command('links',target)).links};}
 async screenshot({path}){const {writeFile}=await import('node:fs/promises');const result=await this.command('screenshot');if(!/^data:image\/png;base64,/.test(result.image))throw Error('截图格式无效');await writeFile(path,Buffer.from(result.image.split(',')[1],'base64'));}
 waitForTimeout(ms){return new Promise(r=>setTimeout(r,ms));}
}
