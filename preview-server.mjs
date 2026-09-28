import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {Store} from './store.js';
import {createHandler} from './server.js';
const root=dirname(fileURLToPath(import.meta.url));
// Dedicated QA data; never touches production records.
const store=new Store(join(root,'../qa-v3'));
const collector={open:async()=>{throw Error('浏览器执行请在 DSH 原生工作台验收');}};
const handler=createHandler(store,collector,{'/':[join(root,'preview.html'),'text/html; charset=utf-8'],'/app.css':[join(root,'app.css'),'text/css'],'/preview.js':[join(root,'preview.js'),'text/javascript']});
createServer(handler).listen(43123,'127.0.0.1',()=>console.log('QA preview http://127.0.0.1:43123'));
