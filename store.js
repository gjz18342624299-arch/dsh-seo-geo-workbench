import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rename,stat,readdir,rm} from 'node:fs/promises';
import {join,basename,extname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {seoCatalog,seoScope,createSeoSnapshot,seoHtml,seoCsv,seoAnalysisPrompt,sourceOf,siteOf} from './seo-reports.js';
import {initialState,isOfficialCitation,publicUrl,mappingFor,parseCSV,normalizeRows,recordKey,analyse,isOursSignal,autoJudgeEntity,isRivalCitation,canonicalUrl,githubRepo,OFFICIAL_REPO_ORG,DEFAULT_ENTITY_RIVALS,activityFor} from './analysis.js';
// 深入分析选择（报告内嵌与 deep-status 共用同一套规则，输出规范 §5）：
// 只取"综合版"（kind='geo' 优先，老数据无 kind 时回退六章节格式），报告对话/SEO 分析不进；
// 范围匹配：分析覆盖记录至少一半落在报告范围内且至少 1 条；
// 多候选取 score=hit/max(覆盖数, 范围数) 最高，同分取最新。
export function pickDeep(s,selected){
  const deepRoots=(s.reports||[]).filter(r=>!r.parentId&&r.kind!=='seo'&&r.kind!=='report-qa');
  const isComprehensive=t=>/主要发现/.test(t||'')&&/行动与复测|复测总表/.test(t||'');
  const scopeIds=new Set((selected||[]).map(r=>r.id));
  const scopeHit=r=>(r.recordIds||[]).filter(id=>scopeIds.has(id)).length;
  const inScope=r=>{const ids=r.recordIds||[];const hit=scopeHit(r);return hit>0&&hit*2>=ids.length;};
  const scopeSize=scopeIds.size||1;
  const score=r=>scopeHit(r)/Math.max((r.recordIds||[]).length,scopeSize);
  const deepTagged=deepRoots.filter(r=>r.kind==='geo');
  const deepPool=(deepTagged.length?deepTagged:deepRoots.filter(r=>isComprehensive(r.text))).filter(inScope);
  const deep=deepPool.slice().sort((x,y)=>score(x)-score(y)||String(x.createdAt).localeCompare(String(y.createdAt))).slice(-1)[0];
  return {deep,hits:deep?scopeHit(deep):0,scopeSize:scopeIds.size};
}
// 定时采集：本地时间 HH:MM 的每天/每周触发；nextRunAt 存毫秒时间戳。
export function nextRunAtFor(sch,from=new Date()){
  const [hh,mm]=String(sch.time||'09:00').split(':').map(x=>Math.min(Math.max(parseInt(x,10)||0,0),x===undefined?0:59));
  const d=new Date(from);d.setSeconds(0,0);d.setHours(hh,mm,0,0);
  if(sch.freq==='weekly'){
    const target=Number.isInteger(sch.weekday)?sch.weekday:1;
    let delta=(target-d.getDay()+7)%7;
    if(delta===0&&d.getTime()<=from.getTime())delta=7;
    d.setDate(d.getDate()+delta);
  }else if(d.getTime()<=from.getTime())d.setDate(d.getDate()+1);
  return d.getTime();
}
// 采集批次规格校验（tasks.add 与定时任务共用）。
function batchSpec(s,a){
  const ps=s.platforms.filter(p=>p.enabled&&(a.platformIds||[]).includes(p.id));
  const questions=(Array.isArray(a.questions)?a.questions:String(a.question||'').split(/\r?\n/)).map(x=>String(x).trim()).filter(Boolean);
  if(!ps.length||!questions.length)throw Error('请选择平台并填写至少一个问题');
  if(questions.length>30)throw Error('一个采集任务最多 30 个问题');
  const count=Number(a.repeat);
  if(!Number.isInteger(count)||count<1||count>5)throw Error('重复次数应为 1-5');
  return {ps,questions,count};
}
function createBatch(s,a,label=''){
  const {ps,questions,count}=batchSpec(s,a);
  const batchId=randomUUID(),createdAt=Date.now();
  s.batches.push({id:batchId,name:(label+String(a.name||questions[0]).trim()).slice(0,80),questions,platformIds:ps.map(p=>p.id),group:a.group||'未分类',mode:a.mode||'unknown',repeat:count,createdAt});
  for(let q=0;q<questions.length;q++)for(const p of ps)for(let i=0;i<count;i++)s.tasks.push({id:randomUUID(),batchId,questionIndex:q+1,platformId:p.id,platformName:p.name,url:p.url,question:questions[q],group:a.group||'未分类',mode:a.mode||'unknown',repeatIndex:i+1,status:'queued',createdAt,steps:[]});
  return {batchId,tasks:questions.length*ps.length*count};
}
const hash=b=>createHash('sha256').update(b).digest('hex');
function mdToHtml(src){
 const esc=t=>String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const inline=t=>esc(t)
  .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/(^|[^0-9a-f])([0-9a-f]{8})(?![0-9a-f])/g,'$1<span class="id">$2</span>');
 const lineHtml=l=>{
  let m=l.match(/^\s*(事实|推断)[：:]\s*(.*)$/);
  if(m)return '<span class="tag '+(m[1]==='事实'?'fact':'infer')+'">'+m[1]+'</span>'+inline(m[2]);
  m=l.match(/^\s*(P[012])[ ·．.、]\s*(.*)$/);
  if(m)return '<span class="pri '+m[1].toLowerCase()+'">'+m[1]+'</span> '+inline(m[2]);
  return inline(l);
 };
 const lines=String(src||'').split(/\r?\n/);
 let out='',i=0,buf=[];
 const flushP=()=>{if(buf.length){out+='<p>'+buf.map(lineHtml).join('<br>')+'</p>';buf=[];}};
 while(i<lines.length){
  const L=lines[i];
  if(/^\s*\|.*\|\s*$/.test(L)){
   flushP();
   const rows=[];
   while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i])){rows.push(lines[i]);i++;}
   const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>inline(c.trim()));
   const body=rows.filter(r=>!/^\s*\|[\s:|-]+\|\s*$/.test(r));
   out+='<table>'+body.map((r,ri)=>'<tr>'+cells(r).map(c=>ri===0?'<th>'+c+'</th>':'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>';
   continue;
  }
  let hm=L.match(/^(#{1,4})\s+(.*)/);
  if(!hm&&/^\s*\d+[\.、]\s+(主要发现|品牌认知|竞品|引用来源|数据缺口|行动)/.test(L))hm=[null,'##',L.trim()];
  if(hm){flushP();out+=(hm[1].length<=2?'<h3 class="sec">':'<h4>')+inline(hm[2].replace(/^#+\s*/,''))+(hm[1].length<=2?'</h3>':'</h4>');i++;continue;}
  if(/^\s*发现\s*\d+\s*[｜|]/.test(L)){flushP();out+='<h4 class="find">'+inline(L.trim())+'</h4>';i++;continue;}
  if(/^\s*[-•]\s+/.test(L)){
   flushP();const items=[];
   while(i<lines.length&&/^\s*[-•]\s+/.test(lines[i])){items.push(lineHtml(lines[i].replace(/^\s*[-•]\s+/,'')));i++;}
   out+='<ul>'+items.map(x=>'<li>'+x+'</li>').join('')+'</ul>';continue;
  }
  if(!L.trim()){flushP();i++;continue;}
  buf.push(L);i++;
 }
 flushP();
 return out;
}

export class Store {
  async seoCatalog(){return seoCatalog(await this.read());}
  async seoScope(options){const r=seoScope(await this.read(),options);return {...r,records:undefined,comparisonRecords:undefined,snapshots:undefined,snapshotCount:r.snapshots.length};}
  async seoSnapshot(options){let report;await this.mutate(s=>{report=createSeoSnapshot(s,options);s.reports.push(report);return {id:report.id};});return {...report,html:seoHtml(report),analysisPrompt:seoAnalysisPrompt(report)};}
  async seoSaved(id){const r=(await this.read()).reports.find(r=>r.id===id&&r.kind==='seo-snapshot');if(!r)throw Error('找不到该SEO报告版本');return {...r,html:seoHtml(r),analysisPrompt:seoAnalysisPrompt(r)};}
  async seoNarrative({id,text}){if(typeof text!=='string'||!text.trim()||text.length>100000)throw Error('分析结果为空或过长');let report;await this.mutate(s=>{const base=s.reports.find(r=>r.id===id&&r.kind==='seo-snapshot');if(!base)throw Error('报告版本不存在');report={...structuredClone(base),id:randomUUID(),parentId:base.id,createdAt:new Date().toISOString(),narrative:text,analysisJob:{status:"completed"}};s.reports.push(report);return {id:report.id};});return {...report,html:seoHtml(report),analysisPrompt:seoAnalysisPrompt(report)};}
  async seoExport({id,format='html',source}){
   const r=await this.seoSaved(id),stem=('SEO报告_'+r.options.site+'_'+r.options.from+'至'+r.options.to+'_'+r.options.sources.join('+')+'_'+r.id.slice(0,8)).replace(/[<>:"/\\|?*]/g,'_');
   const dir=join(this.root,'outputs','monitor-v3');await mkdir(dir,{recursive:true});
   if(format==='html'){const name=stem+'.html';await writeFile(join(dir,name),r.html);return {name,text:r.html,path:join(dir,name)};}
   if(format==='csv'){const name=stem+'_'+source+'.csv',text=seoCsv(r,source);await writeFile(join(dir,name),text);return {name,text,path:join(dir,name)};}
   if(format!=='pdf')throw Error('不支持的导出格式');
   const {chromium}=await import('playwright-core');
   let browser;try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent(r.html,{waitUntil:'load'});const name=stem+'.pdf',path=join(dir,name);const data=await page.pdf({path,format:'A4',printBackground:true,margin:{top:'14mm',bottom:'14mm',left:'10mm',right:'10mm'}});return {name,base64:data.toString('base64'),path};}catch(e){throw Error('PDF 导出失败，请确认已安装 Edge；仍可导出 HTML。'+e.message);}finally{await browser?.close();}
  }
  constructor(root){this.root=resolve(root);this.file=join(this.root,'work','monitor-v3','state.json');this.tail=Promise.resolve();}
  async read(){try{const s=JSON.parse(await readFile(this.file,'utf8'));s.version=Math.max(Number(s.version)||0,4);s.brand||=initialState().brand;s.brand.officialUrl||=s.brand.domain?'https://'+s.brand.domain:'';s.batches||=[];s.credentials||={};s.syncs||=[];s.schedules||=[];s.actionStates||={};s.activities||=[];return s;}catch(e){if(e.code!=='ENOENT')throw e;return initialState();}}
  // 原子写带重试：Windows 上 rename 遇到目标被短暂占用（杀软扫描、上一个 DSH 实例未退净、并行会话句柄）会 EPERM/EBUSY，
  // 短暂退避重试可吸收瞬时占用；持续被锁才抛出（数据安全优先）。
  async writeAtomic(text){
    // Every writer owns its temp file; hot reloads must not overwrite one another's staging file.
    const tmp=this.file+'.'+process.pid+'.'+randomUUID()+'.tmp';
    try{
      await writeFile(tmp,text,{flag:'wx'});let last;
      for(let i=0;i<8;i++){
        try{await rename(tmp,this.file);return;}
        catch(e){last=e;if(!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;if(i<7)await new Promise(r=>setTimeout(r,150*(i+1)));}
      }
      throw last;
    }finally{await rm(tmp,{force:true}).catch(()=>{});}
  }

  mutate(fn){const work=this.tail.then(async()=>{const s=await this.read();const value=await fn(s);s.revision++;await mkdir(join(this.root,'work','monitor-v3'),{recursive:true});await this.writeAtomic(JSON.stringify(s,null,2));return value??s;});this.tail=work.catch(()=>{});return work;}
  async preview({name,base64,text,sheet}) {
    const bytes=base64?Buffer.from(base64,'base64'):Buffer.from(text||'');
    if(!bytes.length||bytes.length>8*1024*1024)throw Error('文件应为非空，单个不超过 8 MB');
    const filename=basename(name||'粘贴资料.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
    const ext=extname(filename).toLowerCase(); let rows=[],sheets=[];
    if(['.xlsx','.xls'].includes(ext)){
      const XLSX=(await import('xlsx/xlsx.mjs'));
      const book=XLSX.read(bytes,{type:'buffer',cellDates:true});sheets=book.SheetNames;
      sheet=sheets.includes(sheet)?sheet:sheets[0];
      rows=XLSX.utils.sheet_to_json(book.Sheets[sheet],{defval:'',raw:false});
    }else if(['.csv','.tsv'].includes(ext))rows=parseCSV(bytes.toString('utf8'));
    else if(ext==='.json'){const v=JSON.parse(bytes.toString('utf8'));rows=Array.isArray(v)?v:(v.records||v.rows||v.data);if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('JSON 需要对象数组，或 records/rows/data 数组');}
    else if(['.txt','.md'].includes(ext))rows=[{正文:bytes.toString('utf8')}];
    else throw Error('当前支持 Excel、CSV、TSV、JSON、TXT、Markdown；PDF/Word/图片解析尚未接入');
    if(!rows.length)throw Error('文件没有可读取的记录');
    if(rows.length>10000)throw Error('单次最多 10000 行，请拆分文件');
    const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const mapping=mappingFor(headers);const kind=mapping.question&&mapping.answer?'geo':mapping.clicks||mapping.impressions?'seo':mapping.visits||mapping.downloads?'traffic':'research';
    const id=randomUUID();const dir=join(this.root,'inputs','monitor-v3',id);await mkdir(dir,{recursive:true});
    await writeFile(join(dir,filename),bytes);
    const data={id,name:filename,hash:hash(bytes),sheet:sheet||'',sheets,rows,mapping,kind,createdAt:new Date().toISOString(),originalPath:join(dir,filename)};
    await mkdir(join(this.root,'work','monitor-v3','previews'),{recursive:true});
    await writeFile(join(this.root,'work','monitor-v3','previews',id+'.json'),JSON.stringify(data));
    return {...data,rows:rows.slice(0,5),totalRows:rows.length,originalPath:undefined};
  }
  async commit({id,mapping,kind,sourceLabel}) {
    this.validId(id);if(!['geo','seo','traffic','research'].includes(kind))throw Error('未知资料类型');
    const p=JSON.parse(await readFile(join(this.root,'work','monitor-v3','previews',id+'.json'),'utf8'));
    return this.mutate(s=>{
      const duplicate=s.imports.find(b=>!b.revoked&&b.hash===p.hash&&b.sheet===p.sheet);if(duplicate)throw Error(`已导入：${duplicate.name}。如需调整字段，请先撤销原批次。`);
      const records=normalizeRows(p.rows,mapping,kind,id,p.sheet);
      if(kind==='research')records.forEach((r,i)=>{r.answer=Object.values(p.rows[i]).map(String).join('\n');r.location=`${p.sheet?p.sheet+' / ':''}${['.txt','.md'].includes(extname(p.name))?'全文':'第 '+(i+2)+' 行'}`;});
      const active=new Set(s.imports.filter(b=>!b.revoked).map(b=>b.id));const seen=new Set(s.records.filter(r=>r.source!=='imported'||active.has(r.batchId)).map(recordKey));
      const accepted=[];for(const r of records){const key=recordKey(r);if(!seen.has(key)){seen.add(key);accepted.push(r);}}
      if(!accepted.length)throw Error('全部记录已存在，没有重复导入');
      const batch={id,name:p.name,hash:p.hash,sheet:p.sheet,kind,sourceLabel:String(sourceLabel||'用户上传'),createdAt:p.createdAt,originalPath:p.originalPath,mapping,count:accepted.length,duplicates:records.length-accepted.length,revoked:false};
      s.imports.push(batch);s.records.push(...accepted);return {batch,state:s};
    });
  }
  validId(id){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效记录标识');}
  async original(id){this.validId(id);const s=await this.read();const b=s.imports.find(x=>x.id===id);if(!b)throw Error('找不到原资料');if(!b.originalPath)throw Error('API 同步批次没有原始文件');return {bytes:await readFile(b.originalPath),name:b.name};}
  async saveCreds(a){
    return this.mutate(s=>{
      s.credentials||={};
      for(const k of ['bingApiKey','bingSiteUrl','cfToken','cfZoneId','gscJson','gscSiteUrl']){
        if(typeof a?.[k]==='string'&&a[k].trim())s.credentials[k]=a[k].trim();
      }
      for(const k of (Array.isArray(a?.clear)?a.clear:[]))delete s.credentials[k];
      return {saved:Object.keys(s.credentials)};
    });
  }
  async addSyncBatch({kind,sourceLabel,records,note,site='',provider=sourceOf(sourceLabel)}){
    if(!['seo','traffic'].includes(kind))throw Error('未知同步类型');
    if(!Array.isArray(records)||!records.length)throw Error('没有可入库的记录');
    return this.mutate(s=>{
      // API 同步是对同一时间窗的重拉：同一（类型, 日, 渠道, 关键词, 页面）只保留最新一次同步的行。
      // 此前按整条内容去重，同一天内指标增长会让重复行不断堆积（访问量被重复计数）。
      const dayKey=r=>[kind,String(r.date||'').slice(0,10),String(r.channel||''),String(r.keyword||''),String(r.page||'')].join('');
      const incoming=new Set(records.map(dayKey));
      const apiBatches=new Set(s.imports.filter(b=>b.api&&!b.revoked&&b.kind===kind&&(b.provider||sourceOf(b.sourceLabel))===provider&&siteOf(b.site)===siteOf(site)).map(b=>b.id));
      const before=s.records.length;
      s.records=s.records.filter(r=>!(r.source==='imported'&&apiBatches.has(r.batchId)&&incoming.has(dayKey(r))));
      const replaced=before-s.records.length;
      // 行被整批替换掉的旧 API 批次同步标记撤销，资料库不再虚报条数。
      for(const b of s.imports)if(apiBatches.has(b.id)&&!s.records.some(r=>r.batchId===b.id)){b.revoked=true;b.note=[b.note,'已被后续同日同步整批替换'].filter(Boolean).join('；');}
      const active=new Set(s.imports.filter(b=>!b.revoked).map(b=>b.id));
      const seen=new Set(s.records.filter(r=>(r.source!=='imported'||active.has(r.batchId))&&r.provider===provider&&siteOf(r.site)===siteOf(site)).map(recordKey));
      const id=randomUUID(),now=new Date().toISOString(),accepted=[];
      records.forEach((r,i)=>{
        const rec={id:`${id}-${i+1}`,batchId:id,location:sourceLabel,kind,source:'imported',date:r.date||now,platform:'',question:'',answer:'',group:'未分类',mode:'unknown',locale:'unknown',region:'unknown',sourceUrl:'',citations:[],raw:r.raw||{},keyword:String(r.keyword||''),page:String(r.page||''),channel:String(r.channel||''),clicks:r.clicks??null,impressions:r.impressions??null,visits:r.visits??null,downloads:r.downloads??null,position:r.position??null,eligible:false,issues:[]};
        rec.provider=provider;rec.site=siteOf(site);if(r.dimension)rec.dimension=r.dimension;
        const key=recordKey(rec);if(seen.has(key))return;seen.add(key);accepted.push(rec);
      });
      if(accepted.length){
        const batch={id,name:`${sourceLabel} ${now.slice(0,16).replace('T',' ')}`,hash:'',sheet:'',kind,sourceLabel,site:siteOf(site),provider,createdAt:now,originalPath:'',mapping:{},count:accepted.length,duplicates:records.length-accepted.length,revoked:false,api:true,note:String(note||'')};
        s.imports.push(batch);s.records.push(...accepted);
      }
      const fullNote=[note,replaced?`已替换同键旧同步行 ${replaced} 条`:null].filter(Boolean).join('；');
      s.syncs=(s.syncs||[]).concat([{id,source:sourceLabel,at:now,count:accepted.length,duplicates:records.length-accepted.length,note:fullNote}]).slice(-100);
      return {added:accepted.length,duplicates:records.length-accepted.length,replaced,note:fullNote};
    });
  }
  // 深入分析的资料落地：把所选记录 JSON 写到项目内文件，分析会话用 read 分块读取，
  // 避免把超长资料整体粘进对话（此前单次最多 8 万字符，超出直接报错）。
  async saveAnalysisPayload({body}){
    if(typeof body!=='string'||!body.trim())throw Error('没有可保存的分析资料');
    if(body.length>8*1024*1024)throw Error('分析资料超过 8 MB，请缩小范围');
    const dir=join(this.root,'work','monitor-v3','analysis-payloads');
    await mkdir(dir,{recursive:true});
    const file=join(dir,`analysis-payload-${Date.now()}.json`);
    await writeFile(file,body);
    const files=(await readdir(dir)).filter(f=>/^analysis-payload-\d+\.json$/.test(f)).sort();
    for(const f of files.slice(0,Math.max(0,files.length-20)))await rm(join(dir,f)).catch(()=>{});
    return {path:file,bytes:Buffer.byteLength(body),specPath:fileURLToPath(new URL('./docs/report-format.md',import.meta.url))};
  }
  async action(a){
    return this.mutate(async s=>{
      if(a.type==='platform.add'){
        const url=publicUrl(String(a.url||''));const name=String(a.name||'').trim();if(!name||name.length>60)throw Error('网站名称需要 1-60 个字符');
        if(s.platforms.some(p=>new URL(p.url).hostname===new URL(url).hostname))throw Error('此网站已在平台列表中');
        s.platforms.push({id:randomUUID(),name,url,enabled:true,status:'untested',preset:false});
      }else if(a.type==='platform.toggle'){const p=s.platforms.find(p=>p.id===a.id);if(!p)throw Error('平台不存在');p.enabled=!p.enabled;}
      else if(a.type==='import.revoke'){const b=s.imports.find(b=>b.id===a.id);if(!b)throw Error('批次不存在');b.revoked=true;b.revokedAt=new Date().toISOString();}
      else if(a.type==='brand.save'){
       const b=a.brand;if(!b?.name?.trim()||!b.aliases?.length||b.aliases.some(x=>!x.trim()))throw Error('请填写品牌名称和至少一个别名');
       const officialUrl=publicUrl(b.officialUrl||'https://'+b.domain),u=new URL(officialUrl);
       const domain=u.hostname.replace(/^www\./,'');
       if(s.brand.name&&(s.brand.domain?.replace(/^www\./,'')!==domain||s.brand.name.trim()!==b.name.trim())&&(s.records.length||s.tasks.length||s.reports.length))throw Error('此数据空间已有监测历史，不能改成另一个品牌；请使用独立数据空间，避免混用历史报告');
       const sources=(b.officialSources||[]).map(publicUrl);
       s.brand={name:b.name.trim(),aliases:b.aliases.map(x=>x.trim()),officialUrl,domain,competitors:b.competitors||[],entityRivals:b.entityRivals||[],organization:String(b.organization||'').trim(),officialSources:sources};
      }
      else if(a.type==='tasks.add'){
        createBatch(s,a);
      }else if(a.type==='schedule.save'){
        const {ps,questions,count}=batchSpec(s,a);
        if(!['daily','weekly'].includes(a.freq))throw Error('频率应为 daily 或 weekly');
        if(!/^\d{1,2}:\d{2}$/.test(String(a.time||'')))throw Error('时间格式应为 HH:MM');
        const weekday=Number.isInteger(Number(a.weekday))?Math.min(Math.max(Number(a.weekday),0),6):1;
        const sch={id:randomUUID(),name:String(a.name||questions[0]).trim().slice(0,60),questions,platformIds:ps.map(p=>p.id),group:a.group||'未分类',mode:a.mode||'unknown',repeat:count,freq:a.freq,time:String(a.time),weekday,enabled:true,createdAt:new Date().toISOString(),lastRunAt:'',lastBatchId:'',lastError:''};
        sch.nextRunAt=nextRunAtFor(sch);
        s.schedules.push(sch);
      }else if(a.type==='schedule.delete'){const i=s.schedules.findIndex(x=>x.id===a.id);if(i<0)throw Error('定时任务不存在');s.schedules.splice(i,1);}
      else if(a.type==='schedule.toggle'){const sch=s.schedules.find(x=>x.id===a.id);if(!sch)throw Error('定时任务不存在');sch.enabled=!sch.enabled;if(sch.enabled){sch.nextRunAt=nextRunAtFor(sch);sch.lastError='';}}
      else if(a.type==='task.pause'||a.type==='task.retry'||a.type==='task.fail'){const t=s.tasks.find(t=>t.id===a.id);if(!t)throw Error('任务不存在');if(t.status==='completed')throw Error('已完成任务不能重跑，请新建轮次');t.status=a.type==='task.pause'?'paused':a.type==='task.retry'?'queued':'failed';t.error=a.type==='task.fail'?String(a.error||'采集执行失败').slice(0,2000):'';if(a.type==='task.retry'){t.startedAt=null;t.finishedAt=null;t.steps=[];delete t.sampleId;}}
      else if(a.type==='batch.retry'){const items=s.tasks.filter(t=>t.batchId===a.id&&!['completed','needs_review','queued','running'].includes(t.status));if(!items.length)throw Error('此任务没有可重试的采样项');for(const t of items){t.status='queued';t.error='';t.startedAt=null;t.finishedAt=null;t.steps=[];delete t.sampleId;}}
      else if(a.type==='report.save'){if(!a.text?.trim())throw Error('没有分析结果');s.reports.push({id:randomUUID(),createdAt:new Date().toISOString(),question:a.question||'',text:a.text,recordIds:a.recordIds||[],sessionId:a.sessionId||'',kind:a.kind||'model',parentId:a.parentId||''});}
      else if(a.type==='sample.verify'){const r=s.records.find(r=>r.id===a.id&&r.source==='official_web');if(!r)throw Error('样本不存在');if(!r.answer?.trim()||!r.question||!r.date||!r.sourceUrl||!r.screenshotPath||(await stat(r.screenshotPath)).size===0)throw Error('证据不完整');r.eligible=true;r.reviewedAt=new Date().toISOString();const t=s.tasks.find(t=>t.id===r.taskId);if(t)t.status='completed';const p=s.platforms.find(p=>p.id===r.platformId);if(p){p.status='ready';p.lastCheckedAt=Date.now();}}
      else if(a.type==='sample.invalidate'){const ids=new Set(a.ids||[]),records=s.records.filter(r=>ids.has(r.id)&&r.source==='official_web');if(!records.length)throw Error('没有可标记的采集证据');for(const r of records){r.eligible=false;r.invalidatedAt=new Date().toISOString();r.issues=[...(r.issues||[]),String(a.reason||'证据复核未通过')];const t=s.tasks.find(t=>t.id===r.taskId);if(t){t.status='failed';t.error=String(a.reason||'证据复核未通过');delete t.sampleId;}}}
      else if(a.type==='sample.entity'){const r=s.records.find(r=>r.id===a.id&&r.kind==='geo');if(!r)throw Error('样本不存在');if(!['ours','rival','mixed','unknown'].includes(a.entity))throw Error('主体取值无效');r.entity=a.entity;r.entitySource='manual';r.metrics=r.metrics||{};r.metrics.entityConfirmed=a.entity==='ours';r.entityJudgedAt=new Date().toISOString();}
      else if(a.type==='sample.entityAuto'){
        const ids=a.ids?.length?new Set(a.ids):null;let judged=0,ours=0,rival=0,mixed=0,skipped=0;
        for(const r of s.records){
          if(r.kind!=='geo'||r.entity||r.invalidatedAt)continue;
          if(ids&&!ids.has(r.id))continue;
          const auto=autoJudgeEntity(r,s.brand);
          if(!auto.entity){skipped++;continue;}
          r.entity=auto.entity;r.entitySource='auto';r.entitySignals=auto.signals;r.entityJudgedAt=new Date().toISOString();
          r.metrics=r.metrics||{};r.metrics.entityConfirmed=auto.entity==='ours';
          judged++;if(auto.entity==='ours')ours++;else if(auto.entity==='rival')rival++;else mixed++;
        }
        return {judged,ours,rival,mixed,skipped};
      }
      else if(a.type==='sample.entityLlm'){
        // LLM 兜底判定落库：只写尚未固化判定的 geo 记录；人工与已采纳判定不被覆盖。
        const verdicts=Array.isArray(a.verdicts)?a.verdicts:[];let judged=0,ours=0,rival=0,mixed=0,unknown=0;
        for(const v of verdicts){
          const r=s.records.find(r=>r.id===v?.id&&r.kind==='geo'&&!r.entity);
          if(!r||!['ours','rival','mixed','unknown'].includes(v.entity))continue;
          r.entity=v.entity;r.entitySource='auto-llm';r.entitySignals=[String(v.evidence||'').slice(0,120)].filter(Boolean);r.entityJudgedAt=new Date().toISOString();
          r.metrics=r.metrics||{};r.metrics.entityConfirmed=v.entity==='ours';
          judged++;if(v.entity==='ours')ours++;else if(v.entity==='rival')rival++;else if(v.entity==='mixed')mixed++;else unknown++;
        }
        return {judged,ours,rival,mixed,unknown};
      }
      else if(a.type==='sample.verifyMany'){const ids=new Set(a.ids||[]);let done=0,skipped=0;for(const r of s.records){if(!ids.has(r.id)||r.source!=='official_web'||r.eligible)continue;let ok=!!(r.answer?.trim()&&r.question&&r.date&&r.sourceUrl&&r.screenshotPath);if(ok)try{ok=(await stat(r.screenshotPath)).size>0;}catch(e){ok=false;}if(!ok){skipped++;continue;}r.eligible=true;r.reviewedAt=new Date().toISOString();const t=s.tasks.find(t=>t.id===r.taskId);if(t)t.status='completed';const p=s.platforms.find(p=>p.id===r.platformId);if(p){p.status='ready';p.lastCheckedAt=Date.now();}done++;}return {done,skipped};}
      else if(a.type==='action.status'){
        const key=String(a.key||'');if(!/^[\w-]{1,60}$/.test(key))throw Error('行动标识无效');
        if(!['todo','done'].includes(a.status))throw Error('行动状态取值无效');
        s.actionStates[key]={status:a.status,doneAt:a.status==='done'?new Date().toISOString():''};
      }
      else if(a.type==='action.retest'){
        const key=String(a.key||'');if(!/^[\w-]{1,60}$/.test(key))throw Error('行动标识无效');
        const cancelled=new Set(Object.values(s.actionStates||{}).map(row=>row.cancelledRetestBatchId).filter(Boolean));
        const base=a.batchId?(s.batches||[]).find(b=>b.id===a.batchId&&!cancelled.has(b.id)):(s.batches||[]).slice().reverse().find(b=>!cancelled.has(b.id)&&(s.tasks||[]).some(t=>t.batchId===b.id));
        if(!base)throw Error('还没有可复测的采集批次');
        const r=createBatch(s,{name:base.name,questions:base.questions,platformIds:base.platformIds,group:base.group,mode:base.mode,repeat:base.repeat},'复测 · ');
        s.actionStates[key]={status:'retest',baseBatchId:base.id,retestBatchId:r.batchId,startedAt:new Date().toISOString()};
        return {batchId:r.batchId};
      }
      else if(a.type==='action.retest.cancel'){
        const key=String(a.key||'');const current=s.actionStates[key];
        if(!/^[\w-]{1,60}$/.test(key)||current?.status!=='retest'||!current.retestBatchId)throw Error('找不到进行中的复测');
        let paused=0;
        for(const task of s.tasks)if(task.batchId===current.retestBatchId&&['queued','running'].includes(task.status)){task.status='paused';paused++;}
        s.actionStates[key]={status:'todo',cancelledAt:new Date().toISOString(),cancelledRetestBatchId:current.retestBatchId};
        return {batchId:current.retestBatchId,paused};
      }
      else if(a.type==='activity.add'){
        const title=String(a.title||'').trim();if(!title||title.length>120)throw Error('标题需要 1-120 个字符');
        const type=String(a.category||'其他');if(!['帖子','视频','官网改动','仓库更新','其他'].includes(type))throw Error('动作类型无效');
        const url=String(a.url||'').trim();const checked=url?publicUrl(url):'';
        let date=String(a.date||'').trim();
        if(!date)date=new Date().toISOString().slice(0,10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('日期格式应为 YYYY-MM-DD');
        s.activities.unshift({id:randomUUID(),date,type,channel:String(a.channel||'').trim().slice(0,40),url:checked,title,note:String(a.note||'').trim().slice(0,500),actionKey:String(a.actionKey||''),createdAt:new Date().toISOString()});
      }
      else if(a.type==='activity.delete'){const i=(s.activities||[]).findIndex(x=>x.id===a.id);if(i<0)throw Error('动作记录不存在');s.activities.splice(i,1);}
      else throw Error('未知操作');
    });
  }
  htmlReport(s,a,filter){
    const esc=t=>String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const pct=(n,d)=>d?(100*n/d).toFixed(0)+'%':'—';
    const geo=a.geo,ent=a.entity||{ours:0,mixed:0,rival:0,unjudged:0};
    const platforms=[...new Set(geo.map(r=>r.platform))];
    const qs=[...new Set(geo.map(r=>r.question))];
    const domain=s.brand.domain||'';
    const aliases=s.brand.aliases||[];
    const rx=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const brandQ=new RegExp('('+aliases.concat([domain]).map(rx).join('|')+')','i');
    const branded=r=>brandQ.test(r.question||'');
    const nameHit=r=>aliases.some(al=>new RegExp('(^|[^a-zA-Z0-9])'+rx(al)+'($|[^a-zA-Z0-9])','i').test(r.answer||''));
    const citesOfficial=r=>(r.citations||[]).some(u=>isOfficialCitation(u,s.brand));
    const citesRival=r=>(r.citations||[]).some(u=>isRivalCitation(canonicalUrl(u),s.brand));
    const bQ=geo.filter(branded),sQ=geo.filter(r=>!branded(r));
    const bHit=bQ.filter(nameHit).length,sHit=sQ.filter(nameHit).length;
    // 可见性四卡口径（2026-09-24 修订）：以主体判定为准——只有判定为「我方」的样本才计入本品提及/上榜；
    // 同名竞品与未判定的名字命中一律不计入，混合样本不计入但在卡片注脚单列。
    // entityEffective 由 analyse() 写入：人工判定 > 已固化判定（auto/auto-llm）> 确定性信号即时判定。
    const effOf=r=>r.entityEffective||r.entity||'';
    const isOursE=r=>effOf(r)==='ours',isMixedE=r=>effOf(r)==='mixed';
    const bOwn=bQ.filter(isOursE).length,sOwn=sQ.filter(isOursE).length;
    const bMix=bQ.filter(isMixedE).length,sMix=sQ.filter(isMixedE).length;
    const withCit=geo.filter(r=>(r.citations||[]).length>0);
    const offCit=withCit.filter(citesOfficial).length,rivCit=withCit.filter(citesRival).length;
    const compAlias=(s.brand.competitors||[]).map(e=>{const as=String(e).split('|').map(x=>x.trim()).filter(Boolean);return {name:as[0],res:as.map(x=>new RegExp(rx(x),'i'))};});
    const firstIdxOf=(t,res)=>{let m=Infinity;for(const re of res){const x=t.search(re);if(x>=0&&x<m)m=x;}return m;};
    const aliasRes=aliases.map(al=>new RegExp('(^|[^a-zA-Z0-9])'+rx(al)+'($|[^a-zA-Z0-9])','i'));
    const rankOf=r=>{const t=r.answer||'';const bi=firstIdxOf(t,aliasRes);if(bi===Infinity)return null;let k=1;for(const c of compAlias){if(firstIdxOf(t,c.res)<bi)k++;}return k;};
    // 名次只在主体判定=我方的样本内计算：品牌名 vs 监控竞品的首次出现位次；分母保持全部有效样本（卡片注脚写明）。
    const ranks=geo.filter(isOursE).map(rankOf).filter(x=>x);
    const firstCnt=ranks.filter(x=>x===1).length,top3Cnt=ranks.filter(x=>x<=3).length;
    const intent=q=>{q=q||'';if(/替代/.test(q))return '替代品攻防';if(brandQ.test(q))return /区别|对比|还是|vs/i.test(q)?'竞品对比':'品牌认知';if(/推荐|有哪些/.test(q))return '品类推荐';return '品类场景';};
    const intentRows=[...new Set(geo.map(r=>intent(r.question)))].map(it=>{const g=geo.filter(r=>intent(r.question)===it);const h=g.filter(isOursE);const rk=h.map(rankOf).filter(x=>x);return '<tr><td>'+esc(it)+'</td><td class="n">'+g.length+'</td><td class="n">'+h.length+'</td><td class="n">'+pct(h.length,g.length)+'</td><td class="n">'+rk.filter(x=>x===1).length+'</td><td class="n">'+rk.filter(x=>x<=3).length+'</td><td class="n">'+g.filter(citesOfficial).length+'</td></tr>';}).join('');
    const ownHits=geo.filter(r=>isOursSignal(r,s.brand)).length;
    const rankBarsData=[[ (s.brand.name||'本品')+'（本品）',ownHits,1]].concat((a.competitors||[]).map(c=>[c.name,c.total,0])).sort((x,y)=>y[1]-x[1]);
    const maxBar=Math.max.apply(null,rankBarsData.map(b=>b[1]).concat([1]));
    const rankBars=rankBarsData.map(b=>'<tr><td class="rowlabel">'+(b[2]?'<b>'+esc(b[0])+'</b>':esc(b[0]))+'</td><td><div class="bar"><div class="fill'+(b[2]?' hl':'')+'" style="width:'+(100*b[1]/maxBar).toFixed(1)+'%"></div><span>'+b[1]+'</span></div></td></tr>').join('');
    const domMap=new Map();
    for(const r of geo)for(const u of r.citations||[]){let hn;try{hn=new URL(u).hostname.replace(/^www\./,'');}catch(e){continue;}if(!domMap.has(hn))domMap.set(hn,{arts:new Set(),recs:new Set(),own:new Set()});const d=domMap.get(hn);d.arts.add(String(u).split('#')[0]);d.recs.add(r.id);if(nameHit(r))d.own.add(r.id);}
    const srcRows=[...domMap].map(([hn,d])=>({hn,arts:d.arts.size,recs:d.recs.size,own:d.own.size})).sort((x,y)=>y.arts-x.arts).slice(0,12).map(d=>'<tr><td>'+esc(d.hn)+'</td><td class="n">'+d.arts+'</td><td class="n">'+d.recs+'</td><td class="n">'+d.own+'</td><td class="n">'+pct(d.own,d.recs)+'</td></tr>').join('');
    const removed=s.records.filter(r=>r.kind==='geo'&&r.invalidatedAt);
    const totalCollected=geo.length+removed.length;
    const perPlat=platforms.map(p=>p+' '+geo.filter(r=>r.platform===p).length).join(' / ');
    const dates=geo.map(r=>(r.date||'').slice(0,10)).filter(Boolean).sort();
    const dateStr=dates.length?(dates[0]===dates[dates.length-1]?dates[0]:dates[0]+' ~ '+dates[dates.length-1]):new Date().toISOString().slice(0,10);
    const batch=filter.cbatch?(s.batches||[]).find(b=>b.id===filter.cbatch):null;
    const cbatchNames=(Array.isArray(filter.cbatches)?filter.cbatches:[]).map(id=>((s.batches||[]).find(b=>b.id===id)||{}).name||id);
    // 深入分析只内嵌与所选范围匹配的"综合版"（范围不符宁可显示占位提示）——
    // 选择规则与 deep-status 完全同源（pickDeep），前端"是否已有匹配"判断和这里不会打架。
    const {deep,hits:deepHits}=pickDeep(s,a.selected);
    // 本周动作与归因：报告范围内日期 ≥ 最早样本日期 − 14 天的动作记录；被引用 = 范围内有效样本的正式引用（跳转解包后）按主机名+路径前缀命中动作链接。
    const actSection=(()=>{
      const cutoff=dates.length?new Date(new Date(dates[0]).getTime()-14*864e5).toISOString().slice(0,10):'';
      const list=(s.activities||[]).filter(x=>!cutoff||String(x.date||'')>=cutoff);
      if(!list.length)return '<section><h2>本周动作与归因</h2><p class="muted">本期没有记录动作。</p></section>';
      const rows=list.map(x=>{
        const hits=geo.filter(r=>(r.citations||[]).some(u=>activityFor(u,[x]))).map(r=>r.id);
        return '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.type)+'</td><td>'+esc(x.channel||'—')+'</td><td>'+(x.url?'<a href="'+esc(x.url)+'">'+esc(x.title)+'</a>':esc(x.title))+(x.note?'<br><small class="muted">'+esc(x.note)+'</small>':'')+'</td><td class="n">'+hits.length+'</td><td>'+hits.slice(0,12).map(id=>'<span class="id">'+esc(String(id).slice(0,8))+'</span>').join(' ')+(hits.length>12?' …':'')+'</td></tr>';
      }).join('');
      return '<section><h2>本周动作与归因</h2><p class="legend">列出报告范围内日期 ≥ 最早样本日期 − 14 天（'+esc(cutoff||'—')+' 起）的动作记录；「被引用」= 本报告范围内有效样本的正式引用（跳转链接解包后）按主机名 + 路径前缀命中动作链接的次数。</p><table><tr><th>日期</th><th>类型</th><th>渠道</th><th>动作</th><th class="n">被引用</th><th>引用样本</th></tr>'+rows+'</table></section>';
    })();
    const follows=deep?(s.reports||[]).filter(r=>r.parentId===deep.id):[];
    const one=(deep&&(deep.text.match(/一句话结论[：:]\s*([^\n]+)/)||[])[1])||'';
    const callout=one?esc(one):(ent.ours===0&&a.mentions>0?'名字提及 '+a.mentions+' 条但主体确认我方 '+ent.ours+' 条——品牌名心智被同名项目占据，优先夺回实体归属。':'本期共 '+geo.length+' 条有效样本；先完成主体判定与深入分析，再据此排布行动。');
    const grade=(v,good,warn)=>v>=good?'good':v>=warn?'warn':'bad';
    const bRate=bQ.length?100*bOwn/bQ.length:0,sRate=sQ.length?100*sOwn/sQ.length:0,aRate=a.mentions?100*ent.ours/a.mentions:0,oRate=withCit.length?100*offCit/withCit.length:0,rRate=withCit.length?100*rivCit/withCit.length:0;
    const cards=[
      ['品牌词提及率',pct(bOwn,bQ.length),'确认我方 '+bOwn+' / '+bQ.length+'（问句含品牌名/域名；同名命中与混合 '+bMix+' 条不计入）',grade(bRate,50,25)],
      ['场景覆盖率',pct(sOwn,sQ.length),'确认我方 '+sOwn+' / '+sQ.length+'（按需求找工具类问句；同名命中与混合 '+sMix+' 条不计入）',grade(sRate,15,5)],
      ['首位提及率',pct(firstCnt,geo.length),'确认我方的样本中本品排第一（对监控竞品首次出现位次），共 '+firstCnt+' 次，分母为全部 '+geo.length+' 条有效样本',grade(geo.length?100*firstCnt/geo.length:0,20,8)],
      ['前三提及率',pct(top3Cnt,geo.length),'确认我方的样本中本品进入前三，共 '+top3Cnt+' 次，分母为全部 '+geo.length+' 条有效样本',grade(geo.length?100*top3Cnt/geo.length:0,30,10)],
      ['归属正确率',pct(ent.ours,a.mentions),'确认我方 '+ent.ours+' / 名字提及 '+a.mentions+'，混合 '+ent.mixed+'，待判定 '+ent.unjudged+'（其中提及品牌 '+(ent.unjudgedMentioned||0)+' 条）',grade(aRate,80,40)],
      ['官网引用率',pct(offCit,withCit.length),'直引 '+domain+' '+offCit+' / 有引用 '+withCit.length+' 条',grade(oRate,35,15)],
      ['竞品域名混入率',pct(rivCit,withCit.length),'引用含非官方同名产品站点/仓库（dshdesktop.cn、anywhere-labs、同名 fork 等）'+rivCit+' 条',rRate<=5?'good':rRate<=10?'warn':'bad'],
      ['找到未引用',String(a.foundNotCited?.total||0),'检索来源或正文触及官网/官方仓库但正式引用没有我们（检索列表证据 '+(a.foundNotCited?.fromSearchedList||0)+' 条）',(a.foundNotCited?.total||0)===0?'good':(a.foundNotCited?.total||0)<=3?'warn':'bad']
    ];
    const sym=r=>{if(!r)return '<td class="c dim">·</td>';const star=citesOfficial(r)?'<span class="star">★</span>':'';const eff=r.entityEffective||r.entity;const m={ours:['c ok','✓ 我方'],mixed:['c mid','△ 混合'],rival:['c bad','✗ 竞品']}[eff];const src=r.entitySource==='auto'?'<span class="dim">·自动</span>':r.entitySource==='auto-llm'?'<span class="dim">·LLM</span>':'';if(m)return '<td class="'+m[0]+'">'+m[1]+src+star+'</td>';return nameHit(r)?'<td class="c mid">？待判定'+star+'</td>':'<td class="c dim">— 未提及'+star+'</td>';};
    const matrix=qs.map(q=>'<tr><td class="q">'+esc(q)+'</td>'+platforms.map(p=>{const rs=geo.filter(r=>r.question===q&&r.platform===p);return sym(rs[rs.length-1]);}).join('')+'</tr>').join('');
    const compRows=(a.competitors||[]).map(c=>'<tr><td>'+esc(c.name)+'</td><td class="n">'+c.total+'</td></tr>').join('');
    const domRows=(a.domains||[]).slice(0,10).map(d=>'<tr><td>'+esc(d.name??d[0])+'</td><td class="n">'+(d.total??d[1]??'')+'</td></tr>').join('');
    const samples=geo.slice(0,80).map(r=>{const eff=r.entityEffective||r.entity;const srcTag=r.entitySource==='auto'?(r.entity?'（自动·已采纳）':'（自动）'):r.entitySource==='auto-llm'?'（LLM 判定）':'';return '<tr><td>'+esc(r.platform)+'</td><td>'+esc((r.question||'').slice(0,24))+'</td><td>'+esc(({ours:'我方',mixed:'混合',rival:'竞品'}[eff]||'待判定')+srcTag)+'</td><td class="n">'+(r.answer||'').length+'</td><td class="n">'+(r.citations||[]).length+(citesOfficial(r)?'★':'')+'</td><td class="muted">'+esc((r.answer||'').slice(0,90))+'…</td></tr>';}).join('');
    const fncSet=new Set(a.foundNotCited?.ids||[]);
    const fncRows=geo.filter(r=>fncSet.has(r.id)).slice(0,40).map(r=>'<tr><td>'+esc(r.platform)+'</td><td>'+esc((r.question||'').slice(0,30))+'</td><td>'+(Array.isArray(r.searchedSources)?'检索列表':'正文信号')+'</td><td class="n">'+(r.citations||[]).length+'</td><td class="muted"><span class="id">'+esc(String(r.id).slice(0,8))+'</span></td></tr>').join('');
    const deepBody=deep?('<section class="deep-md"><div class="eyebrow">DSH 深入分析 · '+esc(deep.createdAt.slice(0,16))+' · 覆盖记录 '+(deep.recordIds||[]).length+' 条 · 落在本报告范围 '+deepHits+' 条</div>'+mdToHtml(deep.text)
      +follows.map(f=>'<div class="deep-follow"><p class="legend">追问 '+esc(f.createdAt.slice(0,16))+'：'+esc(f.question)+'</p>'+mdToHtml(f.text)+'</div>').join('')+'</section>')
      :'<section><h2>深入分析</h2><p class="muted">当前报告范围还没有匹配的深入分析：已有分析覆盖的记录与本报告范围不重叠，直接内嵌会让结论与数据对不上。请先对当前范围运行 DSH 深入分析（「GEO 分析」页，或「报告与行动」页的「对所选范围生成深入分析」按钮），再导出报告。</p></section>';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.brand.name)} GEO 检测报告 · ${esc(dateStr)}</title><style>
:root{--ink:#171721;--muted:#686674;--purple:#6f3cff;--deep:#3d216e;--pale:#f3efff;--line:#e6e1ef;--green:#16865a;--orange:#d66b18;--red:#c2372f;--paper:#fff;--bg:#f5f4f8}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.72}
a{color:var(--purple)}
.shell{max-width:1180px;margin:auto;background:var(--paper);box-shadow:0 20px 70px rgba(40,25,70,.08)}
.hero{min-height:480px;padding:72px 7vw 52px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(circle at 80% 10%,#ede7ff 0,transparent 32%),linear-gradient(140deg,#fff 55%,#faf8ff)}
.eyebrow{color:var(--purple);font-size:13px;font-weight:800;letter-spacing:.12em}
.hero h1{font-size:clamp(40px,6vw,74px);line-height:1.04;letter-spacing:-.05em;margin:22px 0 16px;max-width:900px}
.subtitle{font-size:clamp(15px,2vw,18px);color:var(--muted);max-width:860px}
.meta{display:flex;gap:26px;flex-wrap:wrap;margin-top:34px;color:var(--muted);font-size:14px}
.meta b{display:block;color:var(--ink);font-size:20px}
section{padding:44px 7vw;border-top:1px solid var(--line)}
h2{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}
h3{font-size:22px;margin:34px 0 8px;letter-spacing:-.01em}
h4{font-size:17px;margin:24px 0 6px;color:var(--deep)}
h4.find{border-left:4px solid var(--purple);padding-left:10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:14px;margin:20px 0}
.card{background:var(--pale);border-radius:14px;padding:16px 18px}
.card small{color:var(--muted);display:block}.card b{display:block;font-size:30px;margin:2px 0;letter-spacing:-.02em}
.card.bad b{color:var(--red)}.card.warn b{color:var(--orange)}.card.good b{color:var(--green)}
.callout{background:linear-gradient(135deg,#3d216e,#6f3cff);color:#fff;border-radius:16px;padding:22px 26px;font-size:17px;line-height:1.8;margin:22px 0}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
th{background:var(--pale);font-weight:700}
.n{text-align:right;white-space:nowrap}.c{text-align:center;white-space:nowrap}.q{max-width:300px}
.ok{color:var(--green);font-weight:700}.bad{color:var(--red);font-weight:700}.mid{color:var(--orange);font-weight:700}.dim{color:#b9b6c4}
.star{color:var(--purple)}\n.bar{display:flex;align-items:center;gap:8px}.bar .fill{height:14px;border-radius:7px;background:#cfc3f5;min-width:2px}.bar .hl{background:var(--purple)}.bar span{font-size:13px;color:var(--muted)}.rowlabel{width:220px}
.id{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--pale);border-radius:5px;padding:1px 6px;color:var(--deep);white-space:nowrap}
.tag{display:inline-block;font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px;margin-right:6px}
.tag.fact{background:#e3f4ec;color:var(--green)}.tag.infer{background:#fdeede;color:var(--orange)}
.pri{display:inline-block;font-size:12px;font-weight:800;color:#fff;border-radius:6px;padding:2px 8px;margin-right:6px}
.pri.p0{background:var(--purple)}.pri.p1{background:var(--orange)}.pri.p2{background:var(--muted)}
.deep-md{font-size:14.5px}.deep-md p{margin:8px 0}.deep-md ul{margin:6px 0;padding-left:22px}.deep-md li{margin:3px 0}
.deep-md code{background:var(--pale);border-radius:5px;padding:1px 6px;font-size:13px}.deep-md table{font-size:13.5px}
.deep-follow{border-left:3px solid var(--purple);margin:18px 0 0 6px;padding:6px 18px}
.muted{color:var(--muted)}.legend{font-size:13px;color:var(--muted)}
footer{padding:30px 7vw;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}
@media print{body{background:#fff}.shell{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><div class="shell">
<div class="hero"><div>
<div class="eyebrow">GEO EVIDENCE ANALYSIS · ${esc((s.brand.name||'').toUpperCase())}</div>
<h1>${esc(s.brand.name)}<br>GEO 检测报告</h1>
<p class="subtitle">${batch?'采集批次：'+esc(batch.name)+'。':''}${cbatchNames.length?'采集批次：'+cbatchNames.length+' 个批次合并（'+esc(cbatchNames.join('、').slice(0,80))+'）。':''}资料范围：${esc(dateStr)} 采集的 ${totalCollected} 条 AI 问答记录（${esc(perPlat)}），全部来自各平台官方网页联网模式真实回答。未接入流量数据——本文全部比率为记录计数比，不是流量占比。</p>
</div>
<div class="meta">
<div><b>${geo.length} / ${totalCollected}</b>有效样本</div>
<div><b>${platforms.length}</b>覆盖平台</div>
<div><b>${qs.length}</b>检测问句</div>
<div><b>${esc(dateStr)}</b>采样日期</div>
${removed.length?'<div><b>'+removed.length+' 条剔除</b>'+removed.slice(0,4).map(r=>'<span class="id">'+esc(String(r.id).slice(0,8))+'</span>').join(' ')+' '+esc(String((removed[0].issues||[])[0]||'').slice(0,12))+'</div>':''}
</div></div>
<section><h2>执行摘要</h2>
<div class="callout">${callout}</div>
<div class="cards">${cards.map(c=>'<div class="card '+c[3]+'"><small>'+c[0]+'</small><b>'+c[1]+'</b><small>'+esc(c[2])+'</small></div>').join('')}</div>
<p class="legend">主体判定分布：我方 ${ent.ours} · 混合 ${ent.mixed} · 竞品 ${ent.rival} · 待判定 ${ent.unjudged}（其中提及品牌而未判定 ${ent.unjudgedMentioned||0} 条，其余多为未提及品牌）。判定来源：确定性信号规则自动 ${ent.auto||0} 条 · LLM 兜底自动 ${ent.llm||0} 条 · 人工 ${ent.manual||0} 条。人工判定优先于一切自动判定；名字出现为文本匹配（同名项目会命中）。品牌词提及率、场景覆盖率、首位/前三提及率均以主体判定=我方计数，同名命中、混合与待判定样本不计入。</p>
</section>
${actSection}
${deepBody}
<section><h2>每题 × 平台检测矩阵</h2><p class="legend">✓ 主体确认我方 · △ 混合 · ✗ 主体为竞品 · ？名字出现但待判定 · — 未提及品牌名 · ★ 正式引用官网</p>
<table><tr><th>问题</th>${platforms.map(p=>'<th class="c">'+esc(p)+'</th>').join('')}</tr>${matrix}</table></section>
<section><h2>数据排名分析</h2><p class="legend">本品只统计可确认归属我方的样本：引用 ${esc(domain)}、引用已配置的官方来源、正文提供品牌归属证据，或人工主体判定为我方；竞品按名字/域名出现计数。出现不等于推荐。按意图分类诊断表的「提及 / 首位 / 前三」与执行摘要同口径（主体判定=我方）。</p><table>${rankBars}</table>\n<h3>按意图分类诊断</h3><table><tr><th>意图</th><th class="n">样本</th><th class="n">提及</th><th class="n">提及率</th><th class="n">首位</th><th class="n">前三</th><th class="n">官网引用</th></tr>${intentRows}</table></section>
<section><h2>高引信源平台明细</h2><p class="legend">被大模型引用作为信息来源的平台；本品引用占比 = 提及本品的被引样本 / 该域名被引样本，反映声量份额。</p><table><tr><th>信源域名</th><th class="n">引用文章数</th><th class="n">被引样本</th><th class="n">提及本品</th><th class="n">本品引用占比</th></tr>${srcRows||'<tr><td colspan="5" class="muted">本轮无正式引用</td></tr>'}</table></section>
<section><h2>官网被检索到但未被引用</h2><p class="legend">「找到了却不引用」缺口清单：检索来源列表或回答正文触及了官网/官方仓库，但正式引用（跳转链接解包后）没有我们。检索列表证据来自扩展 best-effort 提取，覆盖 ${a.foundNotCited?.searchedCoverage.known||0}/${a.foundNotCited?.searchedCoverage.total||0} 条样本；正文信号 = 回答写明官网域名或官方仓库地址（问句自带域名的复读不计）。逐条排查：页面标题与摘要是否匹配问句意图、同名竞品页面是否排在前面、正文是否缺少可直接引用的结论句。</p>${fncRows?'<table><tr><th>平台</th><th>问题</th><th>证据来源</th><th class="n">引用数</th><th>记录</th></tr>'+fncRows+'</table>':'<p class="muted">本期没有发现此类缺口样本。</p>'}</section>
<section><h2>判断口径</h2><p class="legend">品牌：${esc(s.brand.name)}；官网：${esc(domain)}。按当前品牌档案中的官网、官方来源及同名实体识别归属。名字出现不等于推荐；我方、混合、同名实体、未判定分开统计。人工核验优先；模型判断保留依据。报告中的我方提及与首位/前三计数仅纳入可确认归属我方的样本，名字文本命中另列。未采集或未审核不算品牌未出现。事实来自有效样本，推断需经复测；按记录 ID 回看原文和截图。品牌配置改变后的结果不得与旧口径直接比较。</p></section>
<section><h2>样本明细（前 80 条）</h2><table><tr><th>平台</th><th>问题</th><th>主体</th><th class="n">字数</th><th class="n">引用</th><th>回答摘要</th></tr>${samples}</table></section>
<footer>由 DSH SEO/GEO 工作台自动生成 · ${esc(s.brand.name)} · ${new Date().toISOString().slice(0,10)}${deep?' · 深入分析引擎生成时间 '+esc(deep.createdAt.slice(0,16)):''}</footer>
</div></body></html>`;
  }
  // SEO 侧分析报告：确定性聚合（搜索词/页面/渠道/按日），结构与 GEO 报告一致；嵌入最新 kind='seo' 的 DSH 分析。
  seoHtmlReport(s,a,filter){
    const esc=t=>String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const ag=a.seoAgg||{totals:{},keywords:[],pages:[],channels:[],trafficPages:[],daily:[],range:{}};
    const t=ag.totals;
    const num=n=>n===null||n===undefined?'—':String(n);
    const pct1=v=>v===null||v===undefined?'—':(100*v).toFixed(1)+'%';
    const trend=v=>v===null||v===undefined?'<td class="n dim">—</td>':'<td class="n '+(v>=0.05?'ok':v<=-0.05?'bad':'')+'">'+(v>=0?'↑':'↓')+Math.abs(100*v).toFixed(0)+'%</td>';
    const range=ag.range||{};
    const dateStr=range.from?(range.from===range.to?range.from:range.from+' ~ '+range.to):'暂无数据';
    const deep=(s.reports||[]).filter(r=>r.kind==='seo'&&!r.parentId).slice(-1)[0];
    const follows=deep?(s.reports||[]).filter(r=>r.parentId===deep.id):[];
    const one=(deep&&(deep.text.match(/一句话结论[：:]\s*([^\n]+)/)||[])[1])||'';
    const callout=one?esc(one):(a.seo.length||a.traffic.length?'本期汇总 '+a.seo.length+' 条搜索词记录、'+a.traffic.length+' 条流量记录。先跑「DSH SEO 分析」再导出，报告将自动包含叙事结论与行动复测。':'当前筛选下没有 SEO 数据：先同步 Bing / Cloudflare 或到资料库导入。');
    const grade=(v,good,warn,invert)=>{if(v===null||v===undefined)return 'warn';const x=100*v;return (invert?x<=good:x>=good)?'good':(invert?x<=warn:x>=warn)?'warn':'bad';};
    const cards=[
      ['总点击',num(t.clicks),'搜索词记录 '+a.seo.length+' 条汇总','good'],
      ['总曝光',num(t.impressions),'同期曝光总量','good'],
      ['平均 CTR',pct1(t.ctr),'点击 / 曝光',grade(t.ctr,4,2)],
      ['加权平均排名',t.position===null||t.position===undefined?'—':t.position.toFixed(1),'按曝光加权；— = 无排名数据',t.position===null||t.position===undefined?'warn':t.position<=5?'good':t.position<=10?'warn':'bad'],
      ['总访问',num(t.visits),'流量记录 '+a.traffic.length+' 条汇总','good'],
      ['总下载',num(t.downloads),'同期下载量','good'],
      ['待复核机会页',String(a.opportunities.length),'曝光 ≥100 且 CTR <2%（规则筛选）',a.opportunities.length===0?'good':a.opportunities.length<=3?'warn':'bad']
    ];
    const kwRows=ag.keywords.slice(0,30).map(k=>'<tr><td>'+esc(k.name)+'</td><td class="n">'+k.clicks+'</td><td class="n">'+k.impressions+'</td><td class="n">'+pct1(k.ctr)+'</td><td class="n">'+(k.position===null?'—':k.position.toFixed(1))+'</td>'+trend(k.trend)+'</tr>').join('');
    const pgRows=ag.pages.slice(0,20).map(k=>'<tr><td>'+esc(k.name)+'</td><td class="n">'+k.clicks+'</td><td class="n">'+k.impressions+'</td><td class="n">'+pct1(k.ctr)+'</td><td class="n">'+(k.position===null?'—':k.position.toFixed(1))+'</td></tr>').join('');
    const chRows=ag.channels.map(k=>'<tr><td>'+esc(k.name)+'</td><td class="n">'+k.visits+'</td><td class="n">'+k.downloads+'</td>'+trend(k.visitTrend)+'</tr>').join('');
    const tpRows=ag.trafficPages.slice(0,20).map(k=>'<tr><td>'+esc(k.name)+'</td><td class="n">'+k.visits+'</td><td class="n">'+k.downloads+'</td>'+trend(k.visitTrend)+'</tr>').join('');
    const dayRows=ag.daily.slice(-30).map(k=>'<tr><td>'+esc(k.name)+'</td><td class="n">'+(k.clicks||'—')+'</td><td class="n">'+(k.impressions||'—')+'</td><td class="n">'+(k.visits||'—')+'</td><td class="n">'+(k.downloads||'—')+'</td></tr>').join('');
    const oppRows=a.opportunities.slice(0,20).map(r=>'<tr><td>'+esc(r.keyword||r.page||'—')+'</td><td class="n">'+r.impressions+'</td><td class="n">'+r.clicks+'</td><td class="n">'+((100*(r.clicks||0)/r.impressions).toFixed(1))+'%</td><td class="n">'+(r.position===null?'—':r.position)+'</td></tr>').join('');
    const actRows=(a.seoActions||[]).map(x=>'<li><b>'+esc(x.title)+'</b> — '+esc(x.detail)+'</li>').join('');
    const deepBody=deep?('<section class="deep-md"><div class="eyebrow">DSH SEO 分析 · '+esc(deep.createdAt.slice(0,16))+'</div>'+mdToHtml(deep.text)
      +follows.map(f=>'<div class="deep-follow"><p class="legend">追问 '+esc(f.createdAt.slice(0,16))+'：'+esc(f.question)+'</p>'+mdToHtml(f.text)+'</div>').join('')+'</section>')
      :'<section><h2>DSH SEO 分析</h2><p class="muted">本报告为指标快照。到「SEO 概览 → DSH 分析与报告」生成完整叙事分析后再导出，报告将自动包含主要发现与行动复测。</p></section>';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.brand.name)} SEO 数据报告 · ${esc(dateStr)}</title><style>
:root{--ink:#171721;--muted:#686674;--purple:#6f3cff;--deep:#3d216e;--pale:#f3efff;--line:#e6e1ef;--green:#16865a;--orange:#d66b18;--red:#c2372f;--paper:#fff;--bg:#f5f4f8}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.72}
.shell{max-width:1180px;margin:auto;background:var(--paper);box-shadow:0 20px 70px rgba(40,25,70,.08)}
.hero{min-height:380px;padding:64px 7vw 48px;display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(circle at 80% 10%,#ede7ff 0,transparent 32%),linear-gradient(140deg,#fff 55%,#faf8ff)}
.eyebrow{color:var(--purple);font-size:13px;font-weight:800;letter-spacing:.12em}
.hero h1{font-size:clamp(36px,5vw,60px);line-height:1.04;letter-spacing:-.05em;margin:22px 0 16px;max-width:900px}
.subtitle{font-size:clamp(15px,2vw,18px);color:var(--muted);max-width:860px}
.meta{display:flex;gap:26px;flex-wrap:wrap;margin-top:34px;color:var(--muted);font-size:14px}
.meta b{display:block;color:var(--ink);font-size:20px}
section{padding:44px 7vw;border-top:1px solid var(--line)}
h2{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:14px;margin:20px 0}
.card{background:var(--pale);border-radius:14px;padding:16px 18px}
.card small{color:var(--muted);display:block}.card b{display:block;font-size:30px;margin:2px 0;letter-spacing:-.02em}
.card.bad b{color:var(--red)}.card.warn b{color:var(--orange)}.card.good b{color:var(--green)}
.callout{background:linear-gradient(135deg,#3d216e,#6f3cff);color:#fff;border-radius:16px;padding:22px 26px;font-size:17px;line-height:1.8;margin:22px 0}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
th{background:var(--pale);font-weight:700}
.n{text-align:right;white-space:nowrap}
.ok{color:var(--green);font-weight:700}.bad{color:var(--red);font-weight:700}.dim{color:#b9b6c4}
.deep-md{font-size:14.5px}.deep-md p{margin:8px 0}.deep-md ul{margin:6px 0;padding-left:22px}.deep-md li{margin:3px 0}
.deep-md code{background:var(--pale);border-radius:5px;padding:1px 6px;font-size:13px}.deep-md table{font-size:13.5px}
.deep-follow{border-left:3px solid var(--purple);margin:18px 0 0 6px;padding:6px 18px}
.muted{color:var(--muted)}.legend{font-size:13px;color:var(--muted)}
footer{padding:30px 7vw;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}
@media print{body{background:#fff}.shell{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><div class="shell">
<div class="hero"><div>
<div class="eyebrow">SEO DATA REPORT · ${esc((s.brand.name||'').toUpperCase())}</div>
<h1>${esc(s.brand.name)}<br>SEO 数据报告</h1>
<p class="subtitle">数据区间 ${esc(dateStr)}。搜索词数据来自 Bing 站长 API 或手动导入（GSC CSV）；访问与下载来自 Cloudflare 或手动导入。全部为确定性计数与比率；趋势按区间日期中位数分前后两段比较。</p>
</div>
<div class="meta">
<div><b>${a.seo.length}</b>搜索词记录</div>
<div><b>${a.traffic.length}</b>流量记录</div>
<div><b>${range.days||0}</b>覆盖天数</div>
<div><b>${esc(dateStr)}</b>数据区间</div>
</div></div>
<section><h2>执行摘要</h2>
<div class="callout">${callout}</div>
<div class="cards">${cards.map(c=>'<div class="card '+c[3]+'"><small>'+c[0]+'</small><b>'+c[1]+'</b><small>'+esc(c[2])+'</small></div>').join('')}</div>
${actRows?'<h2 style="margin-top:26px">行动建议</h2><ul>'+actRows+'</ul>':''}
</section>
${deepBody}
<section><h2>搜索词表现（前 30）</h2><p class="legend">按点击排序。环比 = 区间后半段 vs 前半段点击量（中位日 ${esc(range.mid||'—')} 计入后段），前半段为 0 时不显示。</p>${kwRows?'<table><tr><th>搜索词</th><th class="n">点击</th><th class="n">曝光</th><th class="n">CTR</th><th class="n">排名</th><th class="n">环比</th></tr>'+kwRows+'</table>':'<p class="muted">暂无搜索词数据：同步 Bing 或导入 GSC CSV。</p>'}</section>
<section><h2>页面表现（搜索侧，前 20）</h2>${pgRows?'<table><tr><th>页面</th><th class="n">点击</th><th class="n">曝光</th><th class="n">CTR</th><th class="n">排名</th></tr>'+pgRows+'</table>':'<p class="muted">暂无按页面的搜索数据。</p>'}</section>
<section><h2>流量趋势</h2><p class="legend">按日汇总（最近 30 天）；渠道环比口径同上。</p>${dayRows?'<table><tr><th>日期</th><th class="n">点击</th><th class="n">曝光</th><th class="n">访问</th><th class="n">下载</th></tr>'+dayRows+'</table>':'<p class="muted">暂无流量数据：同步 Cloudflare 或导入访问记录。</p>'}<h2 style="margin-top:26px">渠道</h2>${chRows?'<table><tr><th>渠道</th><th class="n">访问</th><th class="n">下载</th><th class="n">环比</th></tr>'+chRows+'</table>':'<p class="muted">暂无渠道数据。</p>'}<h2 style="margin-top:26px">页面（流量侧，前 20）</h2>${tpRows?'<table><tr><th>页面</th><th class="n">访问</th><th class="n">下载</th><th class="n">环比</th></tr>'+tpRows+'</table>':'<p class="muted">暂无按页面的流量数据。</p>'}</section>
<section><h2>待复核机会页</h2><p class="legend">规则筛选：曝光 ≥100 且 CTR <2%，需人工结合排名与查询意图复核。</p>${oppRows?'<table><tr><th>搜索词 / 页面</th><th class="n">曝光</th><th class="n">点击</th><th class="n">CTR</th><th class="n">排名</th></tr>'+oppRows+'</table>':'<p class="muted">当前筛选下没有命中的机会页。</p>'}</section>
<section><h2>判断口径</h2><p class="legend">CTR = 点击 / 曝光；加权平均排名按曝光加权；趋势按选中区间的日期中位数（${esc(range.mid||'—')}）分前后两段比较。待复核机会页为规则筛选（曝光 ≥100 且 CTR <2%），不是异常判定，需人工复核。本报告只呈现数据与规则结论，语义判断见内嵌的 DSH SEO 分析。</p></section>
<footer>由 DSH SEO/GEO 工作台自动生成 · ${esc(s.brand.name)} · ${new Date().toISOString().slice(0,10)}${deep?' · SEO 分析生成时间 '+esc(deep.createdAt.slice(0,16)):''}</footer>
</div></body></html>`;
  }
  async seoReport(filter){const s=await this.read(),a=analyse(s,filter);const text=this.seoHtmlReport(s,a,filter);
    await mkdir(join(this.root,'outputs','monitor-v3'),{recursive:true});const file=join(this.root,'outputs','monitor-v3',`SEO数据报告-${new Date().toISOString().slice(0,10)}-${Date.now()%100000}.html`);await writeFile(file,text);return {text,path:file};}
  // 定时任务到点（或手动“立即运行”）：按保存的规格创建批次并推进下次运行时间；失败原因写回 schedule.lastError。
  async launchSchedule(id){
    return this.mutate(s=>{
      const sch=(s.schedules||[]).find(x=>x.id===id);
      if(!sch)throw Error('定时任务不存在');
      try{
        const r=createBatch(s,{name:sch.name,questions:sch.questions,platformIds:sch.platformIds,group:sch.group,mode:sch.mode,repeat:sch.repeat},'定时 · ');
        sch.lastRunAt=new Date().toISOString();sch.lastBatchId=r.batchId;sch.lastError='';sch.nextRunAt=nextRunAtFor(sch);
        return r;
      }catch(e){
        sch.lastError=String(e.message||e).slice(0,300);sch.nextRunAt=nextRunAtFor(sch);
        return {error:sch.lastError};
      }
    });
  }
  // 前端"是否已有匹配深入分析"的查询口：与报告内嵌同源（pickDeep），matched=false 时客户端才触发后台生成。
  async deepStatus(filter){const s=await this.read(),a=analyse(s,filter);const {deep,hits,scopeSize}=pickDeep(s,a.selected);return {matched:!!deep,id:deep?.id||'',createdAt:deep?.createdAt||'',cover:(deep?.recordIds||[]).length,hits,scope:scopeSize};}
  async report(filter){const s=await this.read(),a=analyse(s,filter);
    const mdActivities=(()=>{const dates=a.geo.map(r=>(r.date||'').slice(0,10)).filter(Boolean).sort();const cutoff=dates.length?new Date(new Date(dates[0]).getTime()-14*864e5).toISOString().slice(0,10):'';const list=(s.activities||[]).filter(x=>!cutoff||String(x.date||'')>=cutoff);if(!list.length)return '本期没有记录动作。';return list.map(x=>{const hits=a.geo.filter(r=>(r.citations||[]).some(u=>activityFor(u,[x]))).map(r=>r.id);return `- ${x.date} · ${x.type} · ${x.channel||'—'} · ${x.title}${x.url?'（'+x.url+'）':''} · 被引用 ${hits.length} 次${hits.length?'：'+hits.join(', '):''}`;}).join('\n');})();
    const text=filter.format==='html'?this.htmlReport(s,a,filter):`# ${s.brand.name} SEO/GEO 监测报告\n\n生成时间：${new Date().toISOString()}\n筛选：${JSON.stringify(filter)}\n\n有效 GEO 样本 ${a.geo.length}；品牌出现 ${a.mentions}；正式引用官网 ${a.cited}。\n出现统计不等于准确理解或推荐，语义判断请运行 DSH 分析。\n\n## 本周动作与归因\n${mdActivities}\n\n## 平台与题型\n${a.byPlatform.map(p=>`- ${p.name}：${p.mentioned}/${p.total}`).join('\n')}\n\n## 行动建议\n${a.actions.map(x=>`- ${x.title}：${x.detail}${x.do?'\n  做法：'+x.do:''}\n  证据：${x.ids.join(', ')}`).join('\n')||'当前没有足够证据生成行动项。'}\n\n## 样本索引\n${a.selected.map(r=>`- [${r.id}] ${r.platform||r.kind} ${r.date||'采样日期未知'} ${r.location}`).join('\n')}\n`;
    await mkdir(join(this.root,'outputs','monitor-v3'),{recursive:true});const file=join(this.root,'outputs','monitor-v3',`${filter.format==='html'?'GEO检测报告':'report'}-${new Date().toISOString().slice(0,10)}-${Date.now()%100000}.${filter.format==='html'?'html':'md'}`);await writeFile(file,text);return {text,path:file};}
}
