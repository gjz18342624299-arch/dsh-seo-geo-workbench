// Restore the 0.8.0 custom report chat in client.js (undo the native-dock experiment).
import {readFileSync,writeFileSync} from 'node:fs';
const p=JSON.parse(readFileSync('test/old-chat-parts.json','utf8'));
let t=readFileSync('client.js','utf8');
const swap=(start,end,repl,label)=>{const i=t.indexOf(start);if(i<0)throw Error('missing start: '+label);const j=t.indexOf(end,i);if(j<0)throw Error('missing end: '+label);t=t.slice(0,i)+repl+t.slice(j);console.log('swapped',label);};

// 1) hooks: convDocked -> reportChat hooks + reportQ
swap('const [convDocked,setConvDocked]=useState(false);',';',
     p.hooks+'\n   '+p.reportQ,'hooks');
// 2) dock functions -> old openReportConversation
swap('  // 原生对话停靠','const demandForm=',
     '  '+p.openConv+'\n  ','dock functions');
// 3) control-strip panel -> old chat panel
swap('const reportChatPanel=h','let content;',
     p.chatBlock+'\n  ','chat panel');
// 4) mount effect: restore always-cover; drop dock effect
swap('useEffect(()=>{mounted.current=true;refresh().catch(e=>setMessage(e.message));return()=>{mounted.current=false;};},[]);',
     ',[]);',
     "useEffect(()=>{mounted.current=true;runtime?.workbenches?.coverConversation('seo-geo',true);refresh().catch(e=>setMessage(e.message));return()=>{mounted.current=false;runtime?.workbenches?.coverConversation('seo-geo',false);};},[]);",
     'mount effect');
const dockFx=t.indexOf('// 停靠原生对话');
if(dockFx>=0){const end=t.indexOf('},[convDocked,view]);',dockFx);if(end<0)throw Error('dock effect end missing');t=t.slice(0,dockFx)+t.slice(end+'},[convDocked,view]);'.length).replace(/   \n   \n/g,'   \n');console.log('removed dock effect');}
// 5) root className
t=t.replace("className:'sg-app'+(convDocked&&view==='reports'?' sg-dock':'')","className:'sg-app'");
// 6) preview button: no dock calls
t=t.replace("if(reportPreview){setReportPreview('');setConvDocked(false);return;}perform(async()=>{const r=await call('report',{...filter,format:'html'});setReportPreview(r.text);await dockConversation(r.text);});",
            "if(reportPreview){setReportPreview('');return;}perform(async()=>{const r=await call('report',{...filter,format:'html'});setReportPreview(r.text);});");
// 7) CSS cleanup
t=t.replace('.sg-app.sg-dock{right:460px}.sg-conv-docked{padding-left:calc(100% - 460px)!important}','');
if(t.includes('convDocked')||t.includes('dockConversation')||t.includes('sg-conv-docked')||t.includes('sg-dock'))throw Error('leftover dock references');
writeFileSync('client.js',t);
console.log('restore complete');
