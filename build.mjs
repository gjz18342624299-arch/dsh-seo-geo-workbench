import {fileURLToPath} from 'node:url';
import {readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
for(const file of (await readdir(new URL('.',import.meta.url))).filter(f=>/\.(js|mjs)$/.test(f))){const r=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,import.meta.url))],{encoding:'utf8'});if(r.status!==0)throw Error(file+'\n'+r.stderr);}
console.log('Source syntax checks passed. This plugin ships source modules; no bundle required.');

