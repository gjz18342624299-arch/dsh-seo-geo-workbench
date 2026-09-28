import {readFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';

// Preserve an existing user's explicitly configured data location on upgrade.
// New installations receive root through the host's dshHomePath patch, never the package directory.
export async function resolveDataRoot({directory,root,env=process.env}){
  let legacy={};
  try{legacy=JSON.parse(await readFile(join(directory,'deployment.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const selected=env.DSH_SEO_GEO_DATA_DIR||legacy.projectRoot||root;
  if(typeof selected!=='string'||!isAbsolute(selected))throw Error('工作台数据目录未配置：请通过 DSH 插件安装器加载随包的 cordis.patch.yml');
  if(resolve(selected)===resolve(directory)||resolve(selected).startsWith(resolve(directory)+(/\\/.test(resolve(directory))?'\\':'/')))throw Error('业务数据目录不能位于插件安装目录中');
  return resolve(selected);
}
