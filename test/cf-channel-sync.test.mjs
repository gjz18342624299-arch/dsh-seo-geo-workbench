// 单元测试：Cloudflare 渠道拆分同步（RUM Web Analytics 数据集，mock fetch 与 store）。
import {syncCloudflare} from '../syncers.js';

const DAY1='2026-09-20',DAY2='2026-09-21';
function makeStore(){return {
  creds:{cfToken:'t',cfZoneId:'z'},
  savedCreds:null,
  async read(){return {credentials:this.creds,brand:{domain:'dshdesktop.com'}};},
  async saveCreds(a){this.savedCreds={...(this.savedCreds||{}),...a};},
  async addSyncBatch(b){this.batch=b;return b;},
};}

// 全局开关：__rumMode = 'ok' | 'graphql-errors' | 'no-account'
globalThis.__rumMode='ok';
globalThis.fetch=async(url,init)=>{
  const u=String(url);
  if(u.includes('/graphql')){
    const q=JSON.parse(init.body).query;
    if(q.includes('httpRequests1dGroups'))return ok({data:{viewer:{zones:[{httpRequests1dGroups:[
      {dimensions:{date:DAY1},sum:{requests:9000,pageViews:1000,threats:0,cachedRequests:1,bytes:2},uniq:{uniques:100}},
      {dimensions:{date:DAY2},sum:{requests:8000,pageViews:500,threats:0,cachedRequests:1,bytes:2},uniq:{uniques:90}},
    ]}]}}});
    if(q.includes('rumPageloadEventsAdaptiveGroups')){
      if(globalThis.__rumMode==='graphql-errors')return ok({data:null,errors:[{message:"zone 'x' does not have access to the field 'clientrefererhost'"}]});
      if(globalThis.__rumMode==='empty')return ok({data:{viewer:{accounts:[{rumPageloadEventsAdaptiveGroups:[]}]}}});
      return ok({data:{viewer:{accounts:[{rumPageloadEventsAdaptiveGroups:[
        {dimensions:{date:DAY1,refererHost:'www.google.com'},count:700,sum:{visits:600}},
        {dimensions:{date:DAY1,refererHost:''},count:300,sum:{visits:300}},
        {dimensions:{date:DAY1,refererHost:'cn.bing.com'},count:100,sum:{visits:95}},
        {dimensions:{date:DAY1,refererHost:'www.dshdesktop.com'},count:500,sum:{visits:200}}, // 本站自引用 → 站内跳转
        {dimensions:{date:DAY1,refererHost:'some.blog'},count:9,sum:{visits:4}},              // 0.33% < 0.5% → 其他来源
        {dimensions:{date:DAY1,refererHost:'bot.example'},count:50,sum:{visits:0}},           // visits=0 → 丢弃
      ]}]}}});
    }
    throw Error('unexpected graphql '+q.slice(0,80));
  }
  if(u.includes('/zones/z'))return ok(globalThis.__rumMode==='no-account'?{success:true,result:{name:'dshdesktop.com'}}:{success:true,result:{account:{id:'a1'},name:'dshdesktop.com'}});
  throw Error('unexpected url '+u);
};
function ok(body){return {ok:true,status:200,text:async()=>JSON.stringify(body)};}
function assert(cond,msg){if(!cond){console.error('FAIL:',msg);process.exitCode=1;}else console.log('ok:',msg);}

// 场景 A：RUM 拆分 + 占比折算 + 站内归一 + 长尾合并 + visits=0 丢弃 + 保存账户 ID
globalThis.__rumMode='ok';
const s1=makeStore();await syncCloudflare(s1);
const rows=s1.batch.records.filter(r=>r.date.startsWith(DAY1));
const d2=s1.batch.records.filter(r=>r.date.startsWith(DAY2));
assert(rows.length===5,`DAY1 拆成 5 个渠道，实际 ${rows.length}`);
assert(rows.reduce((t,r)=>t+r.visits,0)===1000,`DAY1 各渠道之和 = 1000（实际 ${rows.reduce((t,r)=>t+r.visits,0)}）`);
assert(rows.find(r=>r.channel==='Google 搜索')?.visits===501,'Google 501（占比折算 + 取整误差吸收）');
assert(rows.find(r=>r.channel==='直接访问 / 未知')?.visits===250,'直接访问 250');
assert(rows.find(r=>r.channel==='Bing 搜索')?.visits===79,'Bing 79');
assert(rows.find(r=>r.channel==='站内跳转')?.visits===167,'本站自引用归一为站内跳转 167');
assert(rows.find(r=>r.channel==='其他来源')?.visits===3,'其他来源 3（长尾合并）');
assert(!rows.some(r=>r.channel==='bot.example'),'visits=0 的来源被丢弃');
assert(d2.length===1&&d2[0].channel==='Cloudflare 全站'&&d2[0].visits===500,'DAY2 无 RUM 数据回退为全站单行');
assert(s1.savedCreds?.cfAccountId==='a1','账户 ID 反查后已保存');
assert(/Web Analytics/.test(s1.batch.note||''),'note 说明 RUM 折算口径');

// 场景 A2：RUM 查询成功但 0 组（未开启/暂无流量）——note 必须明示，不能静默回退
globalThis.__rumMode='empty';
const s1b=makeStore();await syncCloudflare(s1b);
assert(s1b.batch.records.every(r=>r.channel==='Cloudflare 全站'),'RUM 0 组时回退全站单行');
assert(/无渠道数据/.test(s1b.batch.note||'')&&/Web Analytics/.test(s1b.batch.note||''),'note 明示 Web Analytics 无数据，不是静默全站');
globalThis.__rumMode='ok';

// 场景 B：GraphQL HTTP 200 但 errors 数组（authz）——不能再静默吞掉
globalThis.__rumMode='graphql-errors';
const s2=makeStore();await syncCloudflare(s2);
assert(s2.batch.records.every(r=>r.channel==='Cloudflare 全站'),'errors 数组时全部回退全站单行');
assert(s2.batch.records.reduce((t,r)=>t+r.visits,0)===1500,'回退后总量不变');
assert(/渠道拆分查询失败/.test(s2.batch.note||'')&&/does not have access/.test(s2.batch.note||''),'note 暴露原始错误原因');

// 场景 C：Zone 反查不到账户 → 回退并报错原因
globalThis.__rumMode='no-account';
const s3=makeStore();await syncCloudflare(s3);
assert(s3.batch.records.every(r=>r.channel==='Cloudflare 全站'),'无账户时回退全站单行');
assert(/无法从 Zone 读取所属账户/.test(s3.batch.note||''),'note 说明账户反查失败');
console.log('ALL DONE');
