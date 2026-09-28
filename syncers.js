// API 自动同步：Bing 站长工具 / Cloudflare Analytics / Google Search Console。
// 只读拉取，落成资料库导入批次（可撤销、按内容去重），不回写任何外部系统。
import {createSign} from 'node:crypto';
const BING_API='https://ssl.bing.com/webmaster/api.svc/json';
const CF_API='https://api.cloudflare.com/client/v4';
const TIMEOUT=45000;

function num(v){if(v===undefined||v===null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;}
function isoDate(v){
  const m=/^\/?Date\((-?\d+)(?:[+-]\d{4})?\)\/?$/.exec(String(v??'')); // WCF 时间戳为毫秒，偏移不改变时间戳本身
  const d=m?new Date(Number(m[1])):new Date(String(v??''));
  return Number.isFinite(d.getTime())?d.toISOString():'';
}
async function fetchJson(url,init={},timeoutMs=TIMEOUT){
  const r=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
  const text=await r.text();
  let j=null;try{j=JSON.parse(text);}catch{throw Error(`接口返回非 JSON（HTTP ${r.status}）：${text.slice(0,120)}`);}
  return {status:r.status,ok:r.ok,json:j};
}

async function bingCall(endpoint,siteUrl,apiKey){
  const url=`${BING_API}/${endpoint}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(apiKey)}`;
  const {status,ok,json:j}=await fetchJson(url,{headers:{'User-Agent':'dsh-seo-geo-workbench'}});
  if(!ok)throw Error(`Bing ${endpoint} 失败（HTTP ${status}）：${j?.Message||j?.message||'请检查 API Key 与站点权限'}`);
  const list=Array.isArray(j)?j:(j?.d?.results||j?.d||j?.results||[]);
  if(!Array.isArray(list))throw Error(`Bing ${endpoint} 返回结构无法识别`);
  return list;
}
export async function syncBing(store){
  const s=await store.read();
  const key=s.credentials?.bingApiKey;
  if(!key)throw Error('请先在「品牌与数据源」保存 Bing API Key');
  const siteUrl=s.credentials?.bingSiteUrl||('https://'+(s.brand?.domain||'dshdesktop.com')+'/');
  const today=new Date().toISOString();
  // 三个接口独立容错：任一失败不拖垮其余；全部失败才整体报错。
  const [queries,pages,daily]=await Promise.all([
    bingCall('GetQueryStats',siteUrl,key).catch(e=>({error:e.message})),
    bingCall('GetPageStats',siteUrl,key).catch(e=>({error:e.message})),
    bingCall('GetRankAndTrafficStats',siteUrl,key).catch(e=>({error:e.message})),
  ]);
  const errors=[queries,pages,daily].filter(x=>!Array.isArray(x)).map(x=>x.error);
  if(errors.length===3)throw Error(errors[0]);
  const records=[];
  // 关键词与页面统计是近 3 个月的累计快照，日期记为同步当天，重复同步按内容去重。
  if(Array.isArray(queries))for(const q of queries){
    const keyword=String(q.Query??q.query??'').trim();if(!keyword)continue;
    records.push({kind:'seo',date:today,keyword,page:'',clicks:num(q.Clicks),impressions:num(q.Impressions),position:num(q.AvgImpressionPosition??q.AvgClickPosition),raw:q});
  }
  if(Array.isArray(pages))for(const p of pages){
    const page=String(p.Page??p.Url??p.url??'').trim();if(!page)continue;
    records.push({kind:'seo',date:today,keyword:'',page,clicks:num(p.Clicks),impressions:num(p.Impressions),position:num(p.AvgImpressionPosition??p.AvgClickPosition),raw:p});
  }
  // 整站每日序列：有真实日期，可直接进趋势对比。
  if(Array.isArray(daily))for(const d of daily){
    const date=isoDate(d.Date||d.date);if(!date)continue;
    records.push({kind:'seo',date,keyword:'（整站）',page:'',clicks:num(d.Clicks),impressions:num(d.Impressions),position:null,raw:d});
  }
  if(!records.length)throw Error('Bing 返回 0 条数据。站点刚验证时需要几天积累，请稍后再同步。');
  return store.addSyncBatch({kind:'seo',sourceLabel:'Bing Webmaster API 自动同步',site:siteUrl,records,note:errors.length?`部分接口失败：${errors.join('；')}`:''});
}

async function cfJson(path,token,init={}){
  const {status,ok,json:j}=await fetchJson(CF_API+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(init.headers||{})}});
  if(!ok||!j||j.success===false){
    const msg=(j?.errors||[]).map(e=>e.message).filter(Boolean).join('；');
    throw Error(`Cloudflare 请求失败（HTTP ${status}）：${msg||'请检查 Token 权限'}`);
  }
  // GraphQL 即使 HTTP 200 也会在 errors 数组里返回字段/权限错误（REST 成功时 errors 恒为空数组），不能静默吞掉。
  if(Array.isArray(j.errors)&&j.errors.length){
    const msg=j.errors.map(e=>e?.message).filter(Boolean).join('；');
    throw Error(`Cloudflare 查询失败：${msg||'GraphQL 返回错误'}`);
  }
  return j;
}
async function cfZone(store,s){
  const saved=s.credentials?.cfZoneId;
  if(saved){const zone=await cfJson('/zones/'+saved,s.credentials.cfToken).catch(()=>null);return {id:saved,name:zone?.result?.name||'',found:false};}
  const domain=String(s.brand?.domain||'dshdesktop.com').replace(/^www\./,'');
  const j=await cfJson(`/zones?name=${encodeURIComponent(domain)}`,s.credentials.cfToken);
  const id=j?.result?.[0]?.id;
  if(!id)throw Error(`未能用 Token 自动识别 ${domain} 的 Zone ID。请在 Cloudflare 控制台选择域名后，从右侧「API」区域复制 Zone ID 填进来`);
  await store.saveCreds({cfZoneId:id});
  return {id,name:j?.result?.[0]?.name||'',found:true};
}
// 渠道名归一：把 referer host 折叠成易读的平台名；空来源视为直接访问；本站域名算站内跳转。
function cfChannel(host,ownDomain=''){
  const h=String(host||'').toLowerCase().replace(/^www\./,'').trim();
  if(!h)return '直接访问 / 未知';
  const own=String(ownDomain||'').toLowerCase().replace(/^www\./,'');
  if(own&&(h===own||h.endsWith('.'+own)))return '站内跳转';
  if(/(^|\.)google\.[a-z.]+$/.test(h))return 'Google 搜索';
  if(/(^|\.)bing\.com$/.test(h))return 'Bing 搜索';
  if(/(^|\.)baidu\.com$/.test(h))return '百度搜索';
  if(/(^|\.)(t\.co|x\.com|twitter\.com)$/.test(h))return 'X / Twitter';
  if(/(^|\.)facebook\.com$/.test(h))return 'Facebook';
  if(/(^|\.)linkedin\.com$/.test(h))return 'LinkedIn';
  if(/(^|\.)reddit\.com$/.test(h))return 'Reddit';
  if(/(^|\.)youtube\.com$/.test(h))return 'YouTube';
  if(/(^|\.)zhihu\.com$/.test(h))return '知乎';
  if(/(^|\.)weixin\.qq\.com$/.test(h))return '微信';
  if(/(^|\.)github\.com$/.test(h))return 'GitHub';
  return h;
}
export async function syncCloudflare(store){
  const s=await store.read();
  const token=s.credentials?.cfToken;
  if(!token)throw Error('请先在「品牌与数据源」保存 Cloudflare API Token');
  const zone=await cfZone(store,s);
  const since=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  const dailyQuery='query($zone:String!,$since:String!){viewer{zones(filter:{zoneTag:$zone}){httpRequests1dGroups(limit:40,orderBy:[date_DESC],filter:{date_geq:$since}){dimensions{date} sum{requests pageViews threats cachedRequests bytes} uniq{uniques}}}}}';
  // 渠道拆分：Free 套餐的 zone 级分析没有 clientRefererHost 字段权限（authz），
  // 改用 Web Analytics 的 RUM 数据集（账户级、现有 Token 即可读），按 sum.visits 取占比，
  // 再按当天 1dGroups 的 pageViews 折算访问量，总访问口径保持不变。
  const rumQuery='query($account:String!,$since:Time!){viewer{accounts(filter:{accountTag:$account}){rumPageloadEventsAdaptiveGroups(limit:10000,orderBy:[count_DESC],filter:{datetime_geq:$since}){dimensions{date refererHost} count sum{visits}}}}}';
  // RUM 是账户级数据集：accountTag 优先用已保存凭证，否则从 Zone 详情反查并保存。
  const withRum=(async()=>{
    let account=s.credentials?.cfAccountId,zoneName='';
    if(!account){
      const zj=await cfJson('/zones/'+zone.id,token);
      account=zj?.result?.account?.id;zoneName=String(zj?.result?.name||'');
      if(!account)throw Error('无法从 Zone 读取所属账户 ID');
      await store.saveCreds({cfAccountId:account});
    }
    const j=await cfJson('/graphql',token,{method:'POST',body:JSON.stringify({query:rumQuery,variables:{account,since:since+'T00:00:00Z'}})});
    return {groups:j?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups||[],own:zoneName||String(s.brand?.domain||'')};
  })().catch(e=>({__error:e.message}));
  const [j,refs]=await Promise.all([
    cfJson('/graphql',token,{method:'POST',body:JSON.stringify({query:dailyQuery,variables:{zone:zone.id,since}})}),
    withRum,
  ]);
  const groups=j?.data?.viewer?.zones?.[0]?.httpRequests1dGroups||[];
  if(!groups.length)throw Error('Cloudflare 返回 0 天数据。请确认 Token 对该域名有 Analytics 读取权限。');
  const refGroups=refs.__error?[]:refs.groups,ownDomain=refs.__error?'':refs.own;
  // 同一天内归一后的渠道合并计数（权重 = RUM 访问量）。
  const byDay=new Map();
  for(const g of refGroups){
    const day=g?.dimensions?.date,visits=Number(g?.sum?.visits)||0;
    if(!day||visits<=0)continue;
    const channel=cfChannel(g?.dimensions?.refererHost,ownDomain);
    if(!byDay.has(day))byDay.set(day,new Map());
    byDay.get(day).set(channel,(byDay.get(day).get(channel)||0)+visits);
  }
  const records=[];
  for(const g of groups){
    const day=g?.dimensions?.date;if(!day)continue;
    const date=isoDate(day+'T00:00:00Z');
    const pv=num(g.sum?.pageViews);
    const raw={requests:num(g.sum?.requests),pageViews:pv,threats:num(g.sum?.threats),cachedRequests:num(g.sum?.cachedRequests),bytes:num(g.sum?.bytes),uniques:num(g.uniq?.uniques)};
    const refMap=byDay.get(day);
    const refTotal=refMap?[...refMap.values()].reduce((t,c)=>t+c,0):0;
    if(pv===null||pv===0||!refTotal){
      records.push({kind:'traffic',date,channel:'Cloudflare 全站',page:'',visits:pv,downloads:null,raw});
      continue;
    }
    // <0.5% 的长尾合并为「其他来源」，降低采样噪声（去重键含访问量，噪声会制造重复行）。
    const main=[],rest=[];for(const [channel,count] of refMap)(count/refTotal>=0.005?main:rest).push([channel,count]);
    const restCount=rest.reduce((t,[,c])=>t+c,0);
    if(restCount)main.push(['其他来源',restCount]);
    const rows=main.map(([channel,count])=>({channel,count,visits:Math.round(pv*count/refTotal)})).filter(r=>r.visits>0);
    // 取整误差由最大渠道吸收，保证各渠道之和严格等于当天 pageViews。
    const drift=pv-rows.reduce((t,r)=>t+r.visits,0);
    if(drift&&rows.length)rows.sort((a,b)=>b.visits-a.visits)[0].visits+=drift;
    for(const r of rows)records.push({kind:'traffic',date,channel:r.channel,page:'',visits:r.visits,downloads:null,raw:{...raw,rumVisits:r.count}});
  }
  if(!records.length)throw Error('Cloudflare 返回 0 天数据。请确认 Token 对该域名有 Analytics 读取权限。');
  const note=[zone.found?'已自动识别并保存 Zone ID':'',refs.__error?`渠道拆分查询失败，本批次为全站总量（${refs.__error}）`:(refGroups.length?'渠道按 Web Analytics 访问量占比折算；同日重复同步会自动替换旧行':'Web Analytics 无渠道数据（未开启或暂无流量），本批次为全站总量；如需渠道拆分，请在 Cloudflare 控制台为该站点开启 Web Analytics（免费）后重新同步')].filter(Boolean).join('；');
  return store.addSyncBatch({kind:'traffic',sourceLabel:'Cloudflare Analytics API 自动同步',site:zone.name,records,note});
}

// Google Search Console：服务账号 JSON 密钥（GSC 没有简单 API Key）。用户需把服务账号邮箱加为 GSC 媒体资源用户。
// 手动构造 RS256 JWT 换取 access_token，不引第三方依赖。
export function gscAssertion(sa,now=Math.floor(Date.now()/1000)){
  const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/webmasters.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const sign=createSign('RSA-SHA256');sign.update(unsigned);sign.end();
  return unsigned+'.'+sign.sign(sa.private_key,'base64url');
}
async function gscToken(sa){
  const {status,ok,json:j}=await fetchJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:gscAssertion(sa)}).toString()});
  if(!ok||!j?.access_token)throw Error(`GSC 授权失败（HTTP ${status}）：${j?.error_description||j?.error||'请检查服务账号 JSON 密钥'}`);
  return j.access_token;
}
async function gscQuery(siteUrl,token,dimensions,startDate,endDate){
  const {status,ok,json:j}=await fetchJson('https://searchconsole.googleapis.com/v1/sites/'+encodeURIComponent(siteUrl)+'/searchAnalytics/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({startDate,endDate,dimensions,rowLimit:25000})});
  if(!ok)throw Error(`GSC 查询失败（HTTP ${status}）：${j?.error?.message||'请确认服务账号已加为该媒体资源用户，且站点地址格式正确（如 sc-domain:example.com 或 https://example.com/）'}`);
  return j.rows||[];
}
export async function syncGsc(store){
  const s=await store.read();
  const raw=s.credentials?.gscJson;
  if(!raw)throw Error('请先在「品牌与数据源」保存 Google Search Console 服务账号 JSON 密钥');
  let sa;try{sa=JSON.parse(raw);}catch{throw Error('服务账号 JSON 无法解析：请粘贴密钥文件的完整内容（含 client_email 与 private_key）');}
  if(!sa.client_email||!sa.private_key)throw Error('服务账号 JSON 缺少 client_email 或 private_key 字段');
  const siteUrl=s.credentials?.gscSiteUrl||('sc-domain:'+String(s.brand?.domain||'dshdesktop.com').replace(/^www\./,''));
  const token=await gscToken(sa);
  // GSC 数据有约 2 天延迟；取近 88 天按日序列，与 Bing 近 3 个月口径对齐。
  const endDate=new Date(Date.now()-2*864e5).toISOString().slice(0,10);
  const startDate=new Date(Date.now()-88*864e5).toISOString().slice(0,10);
  const [queries,pages]=await Promise.all([
    gscQuery(siteUrl,token,['query','date'],startDate,endDate).catch(e=>({error:e.message})),
    gscQuery(siteUrl,token,['page','date'],startDate,endDate).catch(e=>({error:e.message})),
  ]);
  const errors=[queries,pages].filter(x=>!Array.isArray(x)).map(x=>x.error);
  if(errors.length===2)throw Error(errors[0]);
  const records=[];
  if(Array.isArray(queries))for(const r of queries){
    const keyword=String(r.keys?.[0]||'').trim(),day=String(r.keys?.[1]||'');
    if(!keyword||!day)continue;
    records.push({kind:'seo',date:isoDate(day+'T00:00:00Z'),keyword,page:'',clicks:num(r.clicks),impressions:num(r.impressions),position:num(r.position),raw:r});
  }
  if(Array.isArray(pages))for(const r of pages){
    const page=String(r.keys?.[0]||'').trim(),day=String(r.keys?.[1]||'');
    if(!page||!day)continue;
    records.push({kind:'seo',date:isoDate(day+'T00:00:00Z'),keyword:'',page,clicks:num(r.clicks),impressions:num(r.impressions),position:num(r.position),raw:r});
  }
  if(!records.length)throw Error('GSC 返回 0 条数据。站点刚验证或刚添加用户时需要几天积累，请稍后再同步。');
  return store.addSyncBatch({kind:'seo',sourceLabel:'Google Search Console API 自动同步',site:siteUrl,records,note:errors.length?`部分查询失败：${errors.join('；')}`:''});
}
