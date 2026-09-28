// Usage: node test/find-anchor.mjs <file> <anchor> [context]
import {readFileSync} from 'node:fs';
const [,,file,anchor,ctx='60']=process.argv;
const t=readFileSync(file,'utf8');
let i=-1,n=0;
while((i=t.indexOf(anchor,i+1))>=0&&n<10){console.log('index:',i,JSON.stringify(t.slice(Math.max(0,i-Number(ctx)),i+anchor.length+Number(ctx))));n++;}
if(!n)console.log('index: -1');
