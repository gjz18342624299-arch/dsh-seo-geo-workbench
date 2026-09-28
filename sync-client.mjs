// 把 analysis.js 的共享逻辑（去掉 export 关键字）同步进 client.js 的内嵌段。
// client.js 结构：factory opener → [analysis 逻辑] → const SG_CSS= → [UI 段] → footer。
// UI 段以 client.js 为准（app.js 已过时），本脚本只替换 analysis 段。
import {readFile,writeFile} from 'node:fs/promises';
const analysis=await readFile(new URL('./analysis.js',import.meta.url),'utf8');
const client=await readFile(new URL('./client.js',import.meta.url),'utf8');
const openMarker='factory(require){';
const start=client.indexOf(openMarker);
if(start<0)throw Error('client.js: factory opener not found');
const contentStart=start+openMarker.length;
const endMarker='const SG_CSS=';
const end=client.indexOf(endMarker);
if(end<0||end<contentStart)throw Error('client.js: UI section marker not found');
if(client.indexOf(endMarker,end+1)>=0)throw Error('client.js: UI section marker is not unique');
const logic=analysis.replace(/^export /gm,'');
const next=client.slice(0,contentStart)+'\n'+logic.trimEnd()+'\n\n'+client.slice(end);
await writeFile(new URL('./client.js',import.meta.url),next);
console.log(JSON.stringify({synced:true,logicChars:logic.length,clientChars:next.length}));
