import {readFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('.',import.meta.url));
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const output=resolve(root,'../../outputs/market-v'+version);await mkdir(output,{recursive:true});
const npmCli=process.env.npm_execpath||join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const result=spawnSync(process.execPath,[npmCli,'pack','--ignore-scripts','--json','--pack-destination',output],{cwd:root,encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr||result.stdout);
const [packed]=JSON.parse(result.stdout);const files=new Set(packed.files.map(f=>f.path));
for(const f of ['package.json','index.js','client.js','seo-report-reader.js','data-root.js','cordis.patch.yml','chrome-extension/background.js'])assert.ok(files.has(f),'missing '+f);
for(const f of files)assert.ok(!/(^|\/)(deployment\.json|state\.json|auth\.json|\.env|test|work|outputs|\.git)(\/|$)/i.test(f),'private/development file '+f);
for(const f of files){if(!/\.(?:js|mjs|json|yml|md)$/.test(f))continue;const text=await readFile(join(root,f),'utf8');assert.ok(!/[A-Z]:[\\/]Users[\\/]|D:[\\/]Cpan|D:[\\/]DSH[\\/]/i.test(text),'personal absolute path in '+f);}
const bytes=(await stat(join(output,packed.filename))).size;assert.ok(bytes<=8*1024*1024,'market package exceeds 8 MiB');
console.log(JSON.stringify({file:join(output,packed.filename),bytes,fileCount:files.size,requiredEntrypoints:true,privateFilesExcluded:true,licensePending:JSON.parse(await readFile(join(root,'package.json'))).license==='UNLICENSED'},null,2));
