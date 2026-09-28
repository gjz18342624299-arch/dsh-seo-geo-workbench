import {readFileSync} from 'node:fs';
const t=readFileSync('client.js','utf8');
const i=t.indexOf('const SG_CSS2=');
const e=t.indexOf('";\n',i);
console.log(JSON.stringify(t.slice(e-180,e+3)));
