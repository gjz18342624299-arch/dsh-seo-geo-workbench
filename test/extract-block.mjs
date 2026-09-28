// Usage: node test/extract-block.mjs <file> <startAnchor> <endAnchor> <out>
import {readFileSync,writeFileSync} from 'node:fs';
const [,,file,start,end,out]=process.argv;
const t=readFileSync(file,'utf8');
const i=t.indexOf(start),j=t.indexOf(end,i+start.length);
console.log('start',i,'end',j,'len',j-i);
if(i>=0&&j>i)writeFileSync(out,t.slice(i,j));
