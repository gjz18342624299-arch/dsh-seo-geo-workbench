import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const source=dirname(fileURLToPath(import.meta.url)),project=resolve(source,'../..');
const profile=process.env.DSH_PROFILE_DIR||join(process.env.DSH_HOME||join(process.env.APPDATA||join(process.env.HOME||'','.config'),'dsh-desktop/harness'),'profiles/web'),target=join(profile,'node_modules/dsh-seo-geo-workbench');
const exists=p=>access(p).then(()=>true,()=>false);
const backup=join(project,'work','install-v3-backup-'+Date.now());await mkdir(backup,{recursive:true});
if(await exists(target))await cp(target,join(backup,'installed-workbench'),{recursive:true,filter:sourcePath=>sourcePath!==join(target,'node_modules')});
await cp(join(profile,'package.json'),join(backup,'profile-package.json'));
// 部署前语法自检：任何关键文件不通过 node --check 就中止，避免把损坏的包装进 DSH。
const {spawnSync}=await import('node:child_process');
for(const file of ['index.js','client.js','store.js','analysis.js','server.js','syncers.js','collector.js','chrome-bridge.js','entity-judge.js','question-jobs.js','core.js']){
  const r=spawnSync(process.execPath,['--check',join(source,file)],{encoding:'utf8'});
  if(r.status!==0)throw Error(`语法检查未通过，已中止部署：${file}\n${r.stderr||r.stdout}`);
}
// Copy only this plugin. Never run the profile package manager or change other bundles.
await mkdir(target,{recursive:true});
for(const file of ['index.js','core.js','analysis.js','entity-judge.js','store.js','syncers.js','collector.js','chrome-bridge.js','server.js','client.js','package.json','cordis.patch.yml','deployment.json','question-jobs.js'])await cp(join(source,file),join(target,file));
await cp(join(source,'chrome-extension'),join(target,'chrome-extension'),{recursive:true});
await mkdir(join(target,'vendor/node_modules'),{recursive:true});
for(const dependency of ['xlsx','playwright-core'])await cp(join(source,'vendor/node_modules',dependency),join(target,'vendor/node_modules',dependency),{recursive:true});
const {symlink}=await import('node:fs/promises');await mkdir(join(target,'node_modules/@deepseek-ai'),{recursive:true});
for(const dependency of ['schemastery','cordis','dsh-tools','dsh-settings','dsh-llm']){const dest=join(target,'node_modules/@deepseek-ai',dependency);if(!await exists(dest))await symlink(join(resolve(dirname(process.execPath),'../..'),'@deepseek-ai',dependency),dest,'junction');}
const p=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));p.dependencies['dsh-seo-geo-workbench']='file:'+source.replaceAll('\\','/');p.dsh.profile.bundles=[...new Set([...p.dsh.profile.bundles,'dsh-seo-geo-workbench'])];await writeFile(join(profile,'package.json'),JSON.stringify(p,null,2)+'\n');
for(const file of ['index.js','client.js','store.js','syncers.js','server.js','collector.js','chrome-bridge.js'])if((await readFile(join(source,file))).compare(await readFile(join(target,file)))!==0)throw Error('Install mismatch: '+file);
const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
console.log(JSON.stringify({installed:true,version:pkg.version,target,backup,requiresHarnessRestart:true}));

