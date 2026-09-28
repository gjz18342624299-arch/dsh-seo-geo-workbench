// Align the HMR regression test with the real cordis contracts:
// - tools.register / webServer.register return disposers and MUST be wrapped in ctx.effect (duplicate registration crashes HMR reload otherwise).
// - settings.register returns a handle object (NOT a disposer) and manages its own lifecycle internally — wrapping it kills boot.
import {readFileSync,writeFileSync} from 'node:fs';
const p='test/analysis.test.mjs';
let t=readFileSync(p,'utf8');
const marker="test('all plugin registrations dispose";
const i=t.indexOf(marker);
if(i>=0){const ls=t.lastIndexOf('\n',i)+1;t=t.slice(0,ls);}
const marker2="test('plugin registrations follow cordis";
const j=t.indexOf(marker2);
if(j>=0){const ls2=t.lastIndexOf('\n',j)+1;t=t.slice(0,ls2);}
t+=[
"test('plugin registrations follow cordis disposal contracts (HMR/boot-safe)',async()=>{",
"  const src=await readFile(new URL('../index.js',import.meta.url),'utf8');",
"  assert.ok(src.includes('ctx.effect(()=>ctx.tools.register('),'tools.register returns a disposer and must be wrapped in ctx.effect (HMR duplicate registration crash otherwise)');",
"  assert.ok(src.includes('ctx.effect(()=>ctx.webServer.register('),'webServer.register must stay wrapped in ctx.effect');",
"  assert.ok(!src.includes('ctx.effect(()=>ctx.settings.register'),'settings.register returns a handle object, not a disposer; wrapping it in ctx.effect fails boot');",
"});",
''].join('\n');
writeFileSync(p,t);
console.log('rewritten');
