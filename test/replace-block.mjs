// Usage: node test/replace-block.mjs <file> <startAnchor> <endAnchor> <newContentFile>
// Replaces [startAnchor, endAnchor) with the new content. One-shot helper for long single-line blocks.
import {readFileSync,writeFileSync} from 'node:fs';
const [,,file,start,end,newFile]=process.argv;
const t=readFileSync(file,'utf8');
const i=t.indexOf(start),j=t.indexOf(end,i+start.length);
if(i<0||j<=i)throw Error(`anchors not found: start=${i} end=${j}`);
const nw=readFileSync(newFile,'utf8').replace(/\r\n/g,'\n').replace(/\n+$/,'');
writeFileSync(file,t.slice(0,i)+nw+t.slice(j));
console.log('replaced',j-i,'chars with',nw.length,'chars');
