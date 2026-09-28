import {readFileSync} from 'node:fs';
import {statSync} from 'node:fs';
const p='chrome-extension/background.js';
const t=readFileSync(p,'utf8');
console.log('mtime',statSync(p).mtime.toISOString(),'len',t.length);
const needle="if(!editor)throw Error('未找到可用输入框";
let i=-1,n=0;
while((i=t.indexOf(needle,i+1))>=0){n++;const lineStart=t.lastIndexOf('\n',i)+1;console.log(n,'at',i,'indent='+JSON.stringify(t.slice(lineStart,i)));}
