import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,cp,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectExtension,Collector} from '../collector.js';
const qa=new URL('../../qa-v0155/unit/',import.meta.url);await mkdir(qa,{recursive:true});
test('extension package is complete and connection returns a verified exact folder',async()=>{
 const info=await inspectExtension();assert.equal(info.extensionAvailable,true);assert.match(info.extensionPath,/chrome-extension$/);assert.equal(info.extensionVersion,'0.5.11');
 const c=new Collector({root:await mkdtemp(new URL('connection-',qa))});
 try{const paired=await c.connection();assert.equal(paired.extensionAvailable,true);assert.equal(paired.extensionPath,info.extensionPath);assert.equal(paired.connected,false);assert.ok(JSON.parse(paired.connection).endpoint.startsWith('http://127.0.0.1:'));}finally{await c.close();}
});
test('extension validation survives hidden generation folders, spaces and non-ASCII paths',async()=>{
 const root=await mkdtemp(new URL('path-',qa)),dest=join(root,'Library','Application Support','.generations','品牌+0.15.5','chrome-extension');
 await cp(fileURLToPath(new URL('../chrome-extension',import.meta.url)),dest,{recursive:true});
 assert.equal((await inspectExtension(dest)).extensionAvailable,true);
 await unlink(join(dest,'popup.js'));const broken=await inspectExtension(dest);assert.equal(broken.extensionAvailable,false);assert.match(broken.extensionError,/缺少必需文件/);
});
test('missing or invalid manifest and empty entry files are reported as install failures',async()=>{
 const root=await mkdtemp(new URL('broken-',qa));assert.equal((await inspectExtension(root)).extensionAvailable,false);
 await writeFile(join(root,'manifest.json'),'{');assert.equal((await inspectExtension(root)).extensionAvailable,false);
 await cp(fileURLToPath(new URL('../chrome-extension',import.meta.url)),root,{recursive:true});await writeFile(join(root,'background.js'),'');
 const info=await inspectExtension(root);assert.equal(info.extensionAvailable,false);assert.match(info.extensionError,/background.js.*为空/);
});
