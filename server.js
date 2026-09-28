import {readFile,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {analyse} from './analysis.js';
import {syncBing,syncCloudflare,syncGsc} from './syncers.js';
export function createHandler(store,collector,assets,configureSession,judge,questions,seoJobs){
 return async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   // Loopback-only plus non-simple header and strict Origin prevent browser CSRF and DNS rebinding.
   const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))return send(403,{error:'仅支持本机访问'});
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'仅支持本机访问'});
   if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(403,{error:'来源不匹配'});
   if(assets[pathname]&&req.method==='GET'){const [path,type]=assets[pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(await readFile(path));return;}
   if(req.method!=='POST'||req.headers['x-dsh-monitor']!=='1')return send(403,{error:'请求缺少本机工作台标识'});
   let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('请求过大');body+=chunk;}const a=JSON.parse(body||'{}');
   const op=pathname.split('/').at(-1);let value;
   if(op==='state'){const s=await store.read();s.credStatus={bingApiKey:!!s.credentials?.bingApiKey,bingSiteUrl:!!s.credentials?.bingSiteUrl,cfToken:!!s.credentials?.cfToken,cfZoneId:!!s.credentials?.cfZoneId,gscJson:!!s.credentials?.gscJson,gscSiteUrl:!!s.credentials?.gscSiteUrl};delete s.credentials;value=s;}
   else if(op==='workspace-directory'){value={exists:typeof a.path==='string'&&isAbsolute(a.path)&&await stat(a.path).then(x=>x.isDirectory(),()=>false)};}
   else if(op==='question-start'){if(!questions)throw Error('当前环境不支持后台生成');value=await questions.start(a);}
   else if(op==='configure-session'){if(!configureSession)throw Error('请在 DSH 内配置执行会话');value=await configureSession(a);}
   else if(op==='chrome-connection'){if(!collector.connection)throw Error('请在 DSH 原生工作台连接 Chrome');value=await collector.connection();}
   else if(op==='chrome-disconnect'){collector.bridge.disconnect();value={ok:true};}
   else if(op==='chrome-reload-extension')value=await collector.bridge.reloadExtension();
   else if(op==='batch-start')value=await collector.startBatch(a.id);
   else if(op==='batch-stop')value=await collector.stopBatch(a.id);
   else if(op==='schedule-run'){value=await store.launchSchedule(a.id);if(value.batchId)collector.startBatch(value.batchId).catch(async e=>{await store.mutate(v=>{const x=(v.schedules||[]).find(x=>x.id===a.id);if(x)x.lastError='启动采集失败：'+String(e.message||e).slice(0,200);}).catch(()=>{});});}
   else if(op==='runner-status')value=collector.status();
   else if(op==='creds-save')value=await store.saveCreds(a);
   else if(op==='bing-sync')value=await syncBing(store);
   else if(op==='cf-sync')value=await syncCloudflare(store);
    else if(op==='gsc-sync')value=await syncGsc(store);
    else if(op==='platform-test'){const s=await store.read();const p=s.platforms.find(p=>p.id===a.id);if(!p)throw Error('平台不存在');if(!p.enabled)throw Error('平台已停用，请先启用');if(collector.status().batchIds.length)throw Error('正在批量采集，请先停止后再自检');value=await collector.testPlatform(p);}
   else if(op==='action'){value=await store.action(a);if(/^sample\.(verify|verifyMany|entityAuto)$/.test(a?.type||''))judge?.kick();}
    else if(op==='entity-judge-status')value=judge?judge.status():{disabled:true};
    else if(op==='entity-judge-run'){if(!judge)throw Error('主体判定服务未启用');value=await judge.run();}
   else if(op==='preview')value=await store.preview(a);
   else if(op==='commit'){value=await store.commit(a);judge?.kick();}
   else if(op==='analysis')value=analyse(await store.read(),a);
   else if(op==='analysis-payload')value=await store.saveAnalysisPayload(a);
   else if(op==='report')value=await store.report(a);
   else if(op==='deep-status')value=await store.deepStatus(a);
    else if(op==='seo-analyze'){if(!seoJobs)throw Error('后台分析未加载，请重启工作台');value=await seoJobs.start(a);}
    else if(op==='seo-analysis-status'){if(!seoJobs)throw Error('后台分析未加载');value=await seoJobs.status(a.id);}
    else if(op==='seo-catalog')value=await store.seoCatalog();
    else if(op==='seo-scope')value=await store.seoScope(a);
    else if(op==='seo-snapshot')value=await store.seoSnapshot(a);
    else if(op==='seo-narrative')value=await store.seoNarrative(a);
    else if(op==='seo-saved')value=await store.seoSaved(a.id);
    else if(op==='seo-export')value=await store.seoExport(a);
    else if(op==='seo-report')value=await store.seoReport(a);
   else if(op==='original'){const data=await store.original(a.id);value={name:data.name,base64:data.bytes.toString('base64')};}
   else if(op==='screenshot'){const s=await store.read();const r=s.records.find(x=>x.id===a.id&&x.source==='official_web');if(!r?.screenshotPath)throw Error('找不到截图');value={base64:(await readFile(r.screenshotPath)).toString('base64')};}
   else if(op==='browser'){const s=await store.read();const p=s.platforms.find(p=>p.id===a.id&&p.enabled);if(!p)throw Error('平台不存在或已停用');if(collector.taskId&&s.tasks.some(t=>t.id===collector.taskId&&t.status==='running'))throw Error('采集中，请先暂停当前任务');value=await collector.open(p);}
   else return send(404,{error:'接口不存在'});
   send(200,value);
  }catch(e){send(400,{error:e.message});}
 };
}
