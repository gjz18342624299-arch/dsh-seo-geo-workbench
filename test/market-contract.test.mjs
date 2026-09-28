import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
import {resolveDataRoot} from '../data-root.js';
const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
function harness({active=true,picked='/chosen',saved={},owned=[],navigate=false}={}){
 const values=new Map(Object.entries(saved)),ownedIds=new Set(owned),calls=[];
 const ctx={localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},window:{__ModuleLoader__:{load:m=>ctx.module=m}},console,Date,setTimeout,fetch:async()=>({ok:true,json:async()=>({exists:true})})};
 vm.createContext(ctx);vm.runInContext(source.replace('return {App,call};','globalThis.ensureOwned=ownedSession;return {App,call};'),ctx);
 ctx.module.factory(()=>({createElement(){}}));
 let current='personal';
 const runtime={sessions:{list:{getSnapshot:()=>({byId:Object.fromEntries([...ownedIds].map(id=>[id,{}]))})}},uiWorkspace:{selection:{getSnapshot:()=>({sessionId:current})},pickDirectory:async()=>{calls.push('pick');return picked;}},desktopWorkbenches:{isActive:()=>active,ownsSession:id=>ownedIds.has(id),ensureSession:async args=>{calls.push(args);const id=args.sessionId||'created';ownedIds.add(id);current=navigate?'other-session':id;return id;}}};
 return {ctx,runtime,calls,values};
}
test('directory cancellation creates no session, binding or saved path',async()=>{
 const h=harness({picked:null});await assert.rejects(h.ctx.ensureOwned(h.runtime,'report'),/取消/);assert.deepEqual(h.calls,['pick']);assert.equal(h.values.size,0);
});
test('existing unowned report session is never claimed',async()=>{
 const h=harness({saved:{'dsh.seo-geo.owned-sessions.v1':JSON.stringify({report:'personal'})}});
 assert.equal(await h.ctx.ensureOwned(h.runtime,'report'),'created');assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),['pick',{folder:'/chosen'}]);
});
test('owned report session restores without another directory request',async()=>{
 const h=harness({owned:['report-1'],saved:{'dsh.seo-geo.owned-sessions.v1':JSON.stringify({report:'report-1'})}});
 assert.equal(await h.ctx.ensureOwned(h.runtime,'report'),'report-1');assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{sessionId:'report-1'}]);
});
test('inactive owner and changed navigation prevent continuing to prompt',async()=>{
 const inactive=harness({active:false});await assert.rejects(inactive.ctx.ensureOwned(inactive.runtime,'report'),/打开/);assert.equal(inactive.calls.length,0);
 const moved=harness({navigate:true});await assert.rejects(moved.ctx.ensureOwned(moved.runtime,'report'),/尚未发送/);assert.equal(moved.values.size,0);
});
test('manifest declares official load order and no legacy UI hooks',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 assert.ok(pkg.dsh.client.inject.includes('dsh-desktop-workbenches'));assert.equal(pkg.repository.url,'https://github.com/gjz18342624299-arch/dsh-seo-geo-workbench.git');
 assert.ok(pkg.files.includes('seo-report-reader.js'));assert.doesNotMatch(source,/sidebar\.footer\.action|shell\.overlay|centre\.style|sessions\.create\(/);
});
test('data root preserves explicit legacy locations and rejects package-local fallback',async()=>{
 const qa=new URL('../../qa-market/',import.meta.url);await mkdir(qa,{recursive:true});const directory=await mkdtemp(new URL('data-root-',qa));
 const root=resolve(directory,'../user-data');assert.equal(await resolveDataRoot({directory,root,env:{}}),root);
 await assert.rejects(resolveDataRoot({directory,env:{}}),/未配置/);
 await assert.rejects(resolveDataRoot({directory,root:join(directory,'data'),env:{}}),/安装目录/);
 const legacy=resolve(directory,'../old-user-data');await writeFile(join(directory,'deployment.json'),JSON.stringify({projectRoot:legacy}));
 assert.equal(await resolveDataRoot({directory,root,env:{}}),legacy);
});
