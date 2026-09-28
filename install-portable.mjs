import {readFile,writeFile,mkdir,cp,access,rename,rm,symlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=dirname(fileURLToPath(import.meta.url));
const profile=process.env.DSH_PROFILE_DIR||join(process.env.APPDATA,'dsh-desktop/harness/profiles/web');
const modules=process.env.DSH_BUNDLED_MODULES||resolve(dirname(process.execPath),'../..');
const exists=p=>access(p).then(()=>true,()=>false);
async function move(from,to){for(let i=0;;i++){try{return await rename(from,to);}catch(e){if(i>=9||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,250));}}}
const pkgPath=join(profile,'package.json');
const pkg=JSON.parse((await readFile(pkgPath,'utf8')).replace(/^\uFEFF/,''));
if(!Array.isArray(pkg.dsh?.profile?.bundles))throw Error('请先启动 DSH Desktop，完成初始化后再安装。');
const dependencies=['schemastery','cordis','dsh-tools','dsh-settings','dsh-llm'];
for(const name of dependencies)if(!await exists(join(modules,'@deepseek-ai',name,'package.json')))throw Error('DSH 缺少必要组件：'+name+'。未修改安装。');
const stamp=Date.now().toString();
const backup=join(profile,'seo-geo-install-backups',stamp);
const target=join(profile,'node_modules/dsh-seo-geo-workbench');
const stage=join(profile,'node_modules/seo-geo-stage-'+stamp);
await mkdir(backup,{recursive:true});
await cp(pkgPath,join(backup,'package.json'));
let moved=false,installed=false;
try{
 await cp(join(source,'payload'),stage,{recursive:true});
 // Preserve this user's data location on upgrade; never distribute the author's deployment.json.
 if(await exists(join(target,'deployment.json')))await cp(join(target,'deployment.json'),join(stage,'deployment.json'));
 await mkdir(join(stage,'node_modules/@deepseek-ai'),{recursive:true});
 for(const name of dependencies)await symlink(join(modules,'@deepseek-ai',name),join(stage,'node_modules/@deepseek-ai',name),'junction');
 if(await exists(target)){await move(target,join(backup,'workbench'));moved=true;}
 await move(stage,target);installed=true;
 pkg.dependencies??={};pkg.dependencies['dsh-seo-geo-workbench']='file:'+target.replaceAll('\\','/');
 pkg.dsh.profile.bundles=[...new Set([...pkg.dsh.profile.bundles,'dsh-seo-geo-workbench'])];
 await writeFile(pkgPath,JSON.stringify(pkg,null,2)+'\n');
 console.log('安装完成。浏览器扩展目录：\n'+join(target,'chrome-extension')+'\n配置备份：'+backup+'\n现在可启动 DSH，在「浏览器与使用指南」中连接浏览器。');
}catch(e){
 if(installed)await rm(target,{recursive:true,force:true});
 if(moved)await move(join(backup,'workbench'),target);
 await cp(join(backup,'package.json'),pkgPath);
 await rm(stage,{recursive:true,force:true});
 throw e;
}
