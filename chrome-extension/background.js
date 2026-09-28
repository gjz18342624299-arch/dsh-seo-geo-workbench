let running=false,epoch=0;const contexts=new Map();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function status(text){await chrome.storage.local.set({status:text});await chrome.action.setBadgeText({text:text==='已连接'?'ON':'!'});}
async function post(c,path,data){const r=await fetch(c.endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:c.token,clientVersion:'0.5.11',...data}),signal:AbortSignal.timeout(23000)});const result=await r.json();if(!r.ok)throw Error(result.error||'连接失败');return result;}

// Fixed operations only, in the isolated world of the one managed tab.
function pageOperation(action,args){
 if(location.origin!==args.allowedOrigin)throw Error('采集页已跳转其他站点，请返回 AI 网站后重试');
 const visible=e=>!!(e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 const role=e=>e.getAttribute('role')||({BUTTON:'button',A:'link',TEXTAREA:'textbox',SELECT:'combobox',INPUT:e.type==='checkbox'?'checkbox':'textbox'}[e.tagName]||'');
 const name=e=>e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.innerText?.trim()||'';
 if(action==='snapshot'){
  const nodes=[...document.querySelectorAll('button,a,input,textarea,select,[role],[contenteditable="true"],main,article,[class*="markdown"],[class*="message"],[class*="answer"]')].filter(visible).slice(0,400);
  for(let i=0;i<nodes.length;i++)nodes[i].setAttribute('data-dsh-ref',String(i));
  const controls=nodes.map((e,i)=>`[data-dsh-ref="${i}"] ${role(e)||e.tagName.toLowerCase()} ${name(e).slice(0,400)}`).join('\n');
  return {url:location.href,snapshot:('页面正文：\n'+document.body.innerText.slice(0,16000)+'\n可用区域/控件（selector）：\n'+controls).slice(0,26000)};
 }
 const matches=args.selector?[...document.querySelectorAll(args.selector)]:[...document.querySelectorAll('button,a,input,textarea,select,[role],[contenteditable="true"]')].filter(e=>role(e)===args.role&&name(e)===args.name&&visible(e));
 if(action==='links')return {url:location.href,links:matches.map(e=>e.href).filter(u=>/^https?:\/\//.test(u||''))};
 if(matches.length!==1)throw Error(`定位到 ${matches.length} 个元素，请重新 snapshot 并提供唯一 selector`);
 const el=matches[0];
 if(action==='text')return {url:location.href,text:el.innerText||''};
 if(!visible(el))throw Error('元素不可见');
 if(action==='click'){el.scrollIntoView({block:'center'});el.click();}
 else if(action==='fill'){
  if(el.type==='password')throw Error('登录密码需用户自己输入');
  el.focus();
  if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,args.text);}
  else if(el.isContentEditable){const range=document.createRange();range.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);let ok=false;try{ok=document.execCommand('insertText',false,args.text);}catch(e){}if(!ok)el.textContent=args.text;}else throw Error('该元素不是输入区域');
  el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:args.text}));el.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(action==='press'){
  if(!['Enter','Shift+Enter','Escape','Tab'].includes(args.key))throw Error('不支持的按键');el.focus();
  const key=args.key==='Shift+Enter'?'Enter':args.key;
  for(const type of ['keydown','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key,code:key,keyCode:key==='Enter'?13:key==='Escape'?27:9,which:key==='Enter'?13:key==='Escape'?27:9,shiftKey:args.key==='Shift+Enter',bubbles:true,cancelable:true}));
 }else throw Error('未知页面操作');
 return {url:location.href};
}
async function collectPage(args){
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 const readText=e=>{let t=(e.innerText||'').trim();const tc=(e.textContent||'').replace(/\s+/g,' ').trim();if(t.length<20&&tc.length>t.length){try{e.scrollIntoView({block:'nearest'});}catch(_){}t=(e.innerText||'').trim();if(t.length<tc.length)t=tc;}return t;};
 // best-effort 检索来源提取：回答区域之外的“参考资料/来源/搜索结果”容器里的链接；未展开的检索面板拿不到，拿不到就是无数据，不能据此断言检索未命中
 const findSearchedSources=answerEl=>{
  const sel='[class*="reference"],[class*="sources"],[class*="source-list"],[class*="citation"],[class*="search-result"],[class*="search_result"],[class*="retrieval"],[class*="footnote"],[class*="ref-list"],[data-testid*="source"]';
  const skip=e=>e.closest('nav,header,footer,[role="navigation"],[role="banner"],[class*="sidebar"],[class*="history"],[class*="composer"],[class*="editor"],[class*="menu"]');
  const out=new Set();
  for(const c of document.querySelectorAll(sel)){
   if(answerEl&&(answerEl===c||answerEl.contains(c)))continue;
   if(skip(c)||!c.getClientRects().length)continue;
   for(const a of c.querySelectorAll('a[href]'))if(/^https?:\/\//.test(a.href))out.add(a.href);
  }
  return [...out];
 };
 const editorSelectors=['#prompt-textarea','textarea[placeholder]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'];
 let editor;for(const selector of editorSelectors){editor=[...document.querySelectorAll(selector)].find(visible);if(editor)break;}
 if(!editor)throw Error('未找到可用输入框，可能需要登录或页面结构已变化');
 const answerSelector='[data-message-author-role="assistant"],[class*="markdown"],[class*="answer"],[class*="assistant"],article';
 const before=new Set([...document.querySelectorAll(answerSelector)].map(e=>(e.innerText||'').trim()).filter(t=>t.length>20));
 editor.focus();
 if(editor instanceof HTMLInputElement||editor instanceof HTMLTextAreaElement){const proto=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(editor,args.question);}
 else editor.textContent=args.question;
 editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:args.question}));editor.dispatchEvent(new Event('change',{bubbles:true}));await wait(500);
 const sendNames=/^(发送|Send|提交|Submit|Ask|提问)|发送消息|send message/i;
 const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
 let send=buttons.find(e=>sendNames.test((e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim()));
 if(!send)send=buttons.find(e=>{const label=(e.getAttribute('aria-label')||'').toLowerCase();return /send|发送/.test(label)&&!e.disabled;});
 if(send&&!send.disabled)send.click();else for(const type of ['keydown','keypress','keyup'])editor.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
 const started=Date.now();let stable='',stableCount=0,answerEl=null;
 while(Date.now()-started<180000){
  await wait(2000);
  const candidates=[...document.querySelectorAll(answerSelector)].filter(visible).filter(e=>{const t=readText(e);return t.length>20&&!before.has(t)&&t!==args.question;});
  answerEl=candidates.at(-1)||answerEl;const text=answerEl?readText(answerEl):'';
  if(text&&text===stable)stableCount++;else{stable=text;stableCount=0;}
  const busy=[...document.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/(停止生成|Stop generating|停止回答)/i.test((e.getAttribute('aria-label')||e.innerText||'').trim()));
  if(text.length>20&&stableCount>=3&&!busy){const citations=[...answerEl.querySelectorAll('a[href]')].map(a=>a.href).filter(u=>/^https?:\/\//.test(u));return {url:location.href,answer:text,citations:[...new Set(citations)],searchedSources:findSearchedSources(answerEl),observedMode:args.mode||'unknown',modelLabel:'页面当前模型'};}
 }
 throw Error(stable?'回答在 3 分钟内未稳定，未保存不完整结果':'发送后 3 分钟内未检测到回答');
}
async function shortPageOperation(action,args){
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 // Gemini 对回答区域做延迟渲染（content-visibility 等）：innerText 可能读到空，DOM 文本却还在。
 // innerText 明显短于 textContent 时先滚入视口强制渲染再读一次，仍短则用 textContent 兜底。
 const readText=e=>{let t=(e.innerText||'').trim();const tc=(e.textContent||'').replace(/\s+/g,' ').trim();if(t.length<20&&tc.length>t.length){try{e.scrollIntoView({block:'nearest'});}catch(_){}t=(e.innerText||'').trim();if(t.length<tc.length)t=tc;}return t;};
 // best-effort 检索来源提取：回答区域之外的“参考资料/来源/搜索结果”容器里的链接；未展开的检索面板拿不到，拿不到就是无数据，不能据此断言检索未命中
 const findSearchedSources=answerEl=>{
  const sel='[class*="reference"],[class*="sources"],[class*="source-list"],[class*="citation"],[class*="search-result"],[class*="search_result"],[class*="retrieval"],[class*="footnote"],[class*="ref-list"],[data-testid*="source"]';
  const skip=e=>e.closest('nav,header,footer,[role="navigation"],[role="banner"],[class*="sidebar"],[class*="history"],[class*="composer"],[class*="editor"],[class*="menu"]');
  const out=new Set();
  for(const c of document.querySelectorAll(sel)){
   if(answerEl&&(answerEl===c||answerEl.contains(c)))continue;
   if(skip(c)||!c.getClientRects().length)continue;
   for(const a of c.querySelectorAll('a[href]'))if(/^https?:\/\//.test(a.href))out.add(a.href);
  }
  return [...out];
 };
 if(action==='submit'){
  const selectors=['#prompt-textarea','textarea[placeholder]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'];let editor;
  for(const selector of selectors){editor=[...document.querySelectorAll(selector)].find(visible);if(editor)break;}
  // 未登录识别：找不到输入框时若页面有登录入口（Gemini 落地页：登录链接 + 推广内容），返回 loginRequired
  // 让采集器立刻置为 needs_login，而不是空转三分钟后报模糊的"提交失败"。
  if(!editor){const bodyText=(document.body?.innerText||'').slice(0,4000);const loginGate=document.querySelector('a[href*="accounts.google.com"],a[href*="/login"],a[href*="signin"],a[href*="ServiceLogin"]')||/登录|sign in|log in/i.test(bodyText);if(loginGate)return {url:location.href,loginRequired:true,submitted:false,filled:false,attempts:'none',editorValue:''};throw Error('未找到可用输入框，可能需要登录或页面结构已变化');}
  editor.focus();
  if(editor instanceof HTMLInputElement||editor instanceof HTMLTextAreaElement){
   const proto=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,'value').set.call(editor,args.question);
   editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:args.question}));
   editor.dispatchEvent(new Event('change',{bubbles:true}));
  }else{
   // Rich editors (Lexical/ProseMirror/Slate) ignore textContent writes; execCommand goes through beforeinput.
   const range=document.createRange();range.selectNodeContents(editor);
   const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
   let ok=false;try{ok=document.execCommand('insertText',false,args.question);}catch(e){}
   if(!ok){editor.textContent=args.question;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:args.question}));}
  }
  const value=()=>((editor.value??editor.innerText??editor.textContent)||'').trim();
  const q=args.question.trim();
  for(let i=0;i<10&&!value().includes(q.slice(0,20));i++)await wait(200);
  const hadQuestion=value().includes(q.slice(0,20));
  await wait(600);
  // Doubao mirrors the editor into a sidebar draft entry, so a body-wide text search
  // false-positives before anything is sent. Only trust: editor cleared, or a new answer bubble.
  const answerSel='[data-message-author-role="assistant"],[class*="ds-markdown"],[class*="flow-markdown"],[class*="message-content"],[class*="markdown"],[class*="answer"]';
  const answerCount=()=>[...document.querySelectorAll(answerSel)].filter(visible).length;
  const baseAnswers=answerCount();
  const sent=()=>(hadQuestion&&value()==='')||answerCount()>baseAnswers;
  const buttons=()=>[...document.querySelectorAll('button,[role="button"]')].filter(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  const labeled=()=>buttons().find(e=>/发送|send|submit|提交|ask|提问/i.test((e.getAttribute('aria-label')||e.getAttribute('title')||e.getAttribute('data-testid')||e.innerText||'').trim()));
  const positional=()=>{const er=editor.getBoundingClientRect();const near=buttons().filter(e=>{const r=e.getBoundingClientRect(),label=(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim();return r.left>er.left+er.width*.55&&r.top<er.bottom+80&&r.bottom>er.top-20&&!/(附件|上传|模型|模式|语音|图片|录音|麦克|深度|思考|联网|搜索|more|更多|mic|voice|attach|upload)/i.test(label);});return near.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left)[0];};
  const pressEnter=()=>{editor.focus();for(const type of ['keydown','keypress','keyup'])editor.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));};
  const attempts=[];
  const strategies=[['button',()=>{const b=labeled();if(!b)return false;b.click();return true;}],['enter',()=>{pressEnter();return true;}],['side-button',()=>{const b=positional();if(!b)return false;b.click();return true;}],['enter2',()=>{pressEnter();return true;}]];
  for(const [name,fire] of strategies){
   if(sent())break;
   if(!fire())continue;
   attempts.push(name);
   for(let i=0;i<6&&!sent();i++)await wait(400);
  }
  return {url:location.href,submitted:sent(),filled:hadQuestion,editorValue:value().slice(0,120),attempts:attempts.join('+')||'none'};
 }
 const host=location.hostname,platformSelectors=host.includes('chatgpt.com')?['[data-message-author-role="assistant"]']:host.includes('deepseek.com')?['.ds-markdown','[class*="ds-markdown"]','[class*="markdown"]']:host.includes('kimi.com')?['[class*="segment-content"]','[class*="markdown"]','[class*="message-content"]']:host.includes('doubao.com')?['[data-testid*="message"] [class*="content"]','[class*="flow-markdown"]','[class*="message-content"]','[class*="markdown"]']:host.includes('grok.com')?['[class*="response-content"]','[class*="message-bubble"] [class*="markdown"]','[class*="markdown"]','[class*="prose"]']:host.includes('gemini.google.com')?['model-response','[class*="response-text"]','[class*="markdown"]']:[];
 const selectors=[...platformSelectors,'[data-message-author-role="assistant"]','[class*="answer"]','[class*="assistant-message"]','[class*="markdown"]','[class*="prose"]','[class*="message-content"]','model-response','model-response-text'];
 const q=args.question.trim();
 // 外壳防线：含导航、输入区或完整原题的容器绝不可能是回答正文（Gemini 曾整壳被抓，引用全是导航链接）
 const SHELL='nav,aside,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[class*="sidebar"],[class*="sidenav"],[class*="history"],[class*="composer"],[class*="editor"],form';
 // 锚点外壳：用于锚点选择。历史侧栏里的当前会话标题也含问题文本，绝不能当锚点；
 // 但不含 [class*="history"]——问题气泡本身就在会话容器（如 Gemini 的 chat-history 滚动区）里，
 // 把它算外壳会连锚点一起排除，回答随后被全部误杀。
 const ANCHOR_SHELL='nav,aside,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[class*="sidebar"],[class*="sidenav"],[class*="composer"],[class*="editor"],form';
 const strictShell=e=>e.closest(ANCHOR_SHELL);
 // 锚点感知外壳判定：命中的外壳祖先若同时包含问题锚点，说明它是对话容器本身
 // （Gemini 的会话滚动容器 class 含 "history"，整条回答曾因此被误杀），不能视为外壳；
 // 真正的历史/侧栏面板不会包含当前问题气泡。锚点未知时退化为严格判定。
 const badZone=e=>{const z=e.closest(SHELL);return z&&!(anchor&&(z.contains(anchor)||anchor.contains(z)));};
 const shellish=e=>!!e.querySelector('nav,header,[role="navigation"],[role="banner"],textarea,[contenteditable="true"]');
 // 实心可见：排除无障碍专用的 1px 裁剪元素（visually-hidden/aria-live 也有 client rects）。
 const solid=e=>{const r=e.getBoundingClientRect();return r.width>4&&r.height>4;};
 // 原题锚点：最后一个“像用户气泡”的元素（含原题且短）；只有它之后的块才可能是本轮回答
 // 排除无障碍回声区（aria-live/visually-hidden/sr-only）：它们在文档末尾复读“你说 …”，会把锚点推到回答之后。
 let anchor=null;const qWalker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let n;(n=qWalker.nextNode());){if(n.nodeValue&&n.nodeValue.includes(q.slice(0,24))){const el=n.parentElement;if(el&&visible(el)&&solid(el)&&!strictShell(el)&&!el.closest('[aria-hidden="true"],[aria-live],[class*="visually-hidden"],[class*="sr-only"],[class*="screen-reader"]')&&!el.closest('model-response,model-response-text,[data-message-author-role="assistant"]')&&!el.closest('textarea,[contenteditable="true"],input')&&(el.innerText||'').trim().length<q.length*2+200)anchor=el;}}
 const afterAnchor=e=>!anchor||!!(anchor.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING);
 // Grok has no stable assistant role on every response. An answer that repeats
 // the question must not replace the actual user bubble as the turn anchor.
 const grok=host==='grok.com',grokBody='[class*="response-content"],[class*="markdown"],[class*="prose"]';
 if(grok){
  const normalize=t=>String(t||'').replace(/\s+/g,' ').trim();
  // Live Grok renders BOTH user and assistant turns as markdown/prose.
  // Match the whole user bubble, not a quoted paragraph inside an answer.
  const users=[...document.querySelectorAll('[class*="message-bubble"]')].filter(e=>visible(e)&&solid(e)&&normalize(e.textContent)===normalize(q)&&!e.closest('nav,aside,header,[role="navigation"],[data-sidebar="sidebar"],textarea,[contenteditable="true"],[aria-live],[aria-hidden="true"],[class*="sr-only"]'));
  anchor=users.at(-1)||null;
 }
 // Gemini 的回答可能复述原题；明确的 model-response 允许包含问题文本。
 const geminiResponse=e=>host==='gemini.google.com'&&!!e.closest('model-response')||grok&&!!anchor&&!!e.closest(grokBody);
 let candidates=[...new Set(document.querySelectorAll(selectors.join(',')))].filter(visible).map(e=>({e,text:readText(e)}))
  .filter(x=>x.text.length>20&&x.text!==q&&(!x.text.includes(q)||geminiResponse(x.e))&&x.text.length<50000&&!badZone(x.e)&&!shellish(x.e)&&afterAnchor(x.e));
 // 只保留叶子候选：包含其他候选的容器一律视为外壳；多块并列（如 DeepSeek 分段）按文档顺序拼接
 candidates=candidates.filter(x=>!candidates.some(o=>o!==x&&x.e.contains(o.e)));
 candidates.sort((a,b)=>{const p=a.e.compareDocumentPosition(b.e);return p&Node.DOCUMENT_POSITION_FOLLOWING?-1:p&Node.DOCUMENT_POSITION_PRECEDING?1:0;});
 // 引用链接必须是回答范围内的真实出站链接：同站导航与账户链接（Gemini 的 /app、/search、SignOut）不算引用
 const linkOk=u=>{try{const U=new URL(u);if(!/^https?:$/.test(U.protocol))return false;if(U.host===location.host&&!/redirect|target=|url=|\/link/i.test(U.pathname+U.search))return false;if(/^accounts\.google\.com$/.test(U.host))return false;return true;}catch{return false;}};
  // Platform-agnostic fallback: anchor on the newest question bubble in document
  // order, then score following content blocks. Works on sites with no selectors.
  const genericAnswer=()=>{
   const gBadZone=e=>{const z=e.closest('nav,aside,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[class*="sidebar"],[class*="sidenav"],[class*="history"],[class*="menu"],[class*="composer"],[class*="editor"],[class*="toolbar"]');return z&&!(anchor&&(z.contains(anchor)||anchor.contains(z)));};
   const all=[...document.querySelectorAll('div,section,article,p,pre,blockquote,li,model-response,model-response-text,[data-message-author-role]')];
   const scope=anchor?all.filter(e=>e!==anchor&&!anchor.contains(e)&&(anchor.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)):all;
   const kw=/(markdown|prose|message|response|answer|bubble|reply|content|result)/i,list=[];
   for(const e of scope){
    if(!visible(e)||gBadZone(e)||shellish(e)||e.querySelector('textarea,input,[contenteditable="true"]'))continue;
    let t=readText(e);
    if(t.startsWith(q))t=t.slice(q.length).trim();
    if(t.length<40||t.length>50000||(t.includes(q)&&!geminiResponse(e)))continue;
    list.push({e,text:t});
   }
   for(const c of list){const cls=String(c.e.className&&c.e.className.baseVal!==undefined?c.e.className.baseVal:c.e.className);c.score=(kw.test(cls)||c.e.matches('[data-message-author-role],model-response,model-response-text,article')?3:0)+(c.e.closest('article,main,[role="main"]')?2:0)+(c.text.length>=200&&c.text.length<=8000?1:0)-(list.some(o=>o.e!==c.e&&c.e.contains(o.e))?3:0);}
   list.sort((a,b)=>b.score-a.score||b.text.length-a.text.length);
   return list[0]||null;
  };
 let answer='',scopeEl=null;
 if(candidates.length){
  // 多块并列回答（如 DeepSeek 分段）：按文档顺序拼接；引用范围取叶子块的公共祖先中仍干净的最外层
  answer=candidates.map(x=>x.text).join('\n\n');
  scopeEl=candidates[0].e;
  for(const x of candidates.slice(1)){while(scopeEl&&!scopeEl.contains(x.e))scopeEl=scopeEl.parentElement;}
  while(scopeEl&&scopeEl.parentElement&&scopeEl.parentElement!==document.body&&!badZone(scopeEl.parentElement)&&!shellish(scopeEl.parentElement)&&!(scopeEl.parentElement.innerText||'').includes(q)&&(scopeEl.parentElement.innerText||'').trim().length<50000)scopeEl=scopeEl.parentElement;
 }else{const g=genericAnswer();if(g){answer=g.text;scopeEl=g.e;}}
 // Grok's status/thinking blocks can be stable while the real answer is still
 // rendering. Never use the generic text-scoring fallback for this platform.
 // Its explicit response-content bodies may live inside layout wrappers whose
 // class names contain sidebar/history; those are not navigation boundaries.
 if(grok){
  answer='';scopeEl=null;
  if(anchor){
   const bodies=[...document.querySelectorAll('[class*="response-content"]')].filter(e=>visible(e)&&solid(e)&&!anchor.contains(e)&&afterAnchor(e)&&!e.closest('nav,aside,header,[role="navigation"],[data-sidebar="sidebar"],[aria-hidden="true"],[aria-live],details'));
   const outer=bodies.filter(e=>!bodies.some(p=>p!==e&&p.contains(e)));
   for(const body of outer){const text=readText(body);if(text.length>20&&text.length<50000&&!shellish(body)){answer=text;scopeEl=body;break;}}
  }
 }
 // ChatGPT's conversation shell may contain "history"/"sidebar" classes or forms.
 // Explicit message roles establish ownership without guessing from shell class names.
 if(host==='chatgpt.com'||host==='chat.openai.com'){
  answer='';scopeEl=null;
  const turns=[...document.querySelectorAll('[data-message-author-role]')].filter(e=>!e.closest('nav,aside,[role="navigation"],[aria-hidden="true"]'));
  const normalize=t=>t.replace(/\s+/g,' ').trim();
  const user=turns.filter(e=>e.getAttribute('data-message-author-role')==='user'&&normalize(e.textContent||'')===normalize(q)).at(-1);
  if(user){
   const following=turns.filter(e=>!!(user.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING));
   const nextUser=following.findIndex(e=>e.getAttribute('data-message-author-role')==='user');
   const responses=(nextUser<0?following:following.slice(0,nextUser)).filter(e=>e.getAttribute('data-message-author-role')==='assistant');
   const response=responses.at(-1);
   if(response){
    const body=response.querySelector('.markdown')||response;
    const text=readText(body);
    if(visible(body)&&text.length>20&&text.length<50000&&!shellish(body)){answer=text;scopeEl=body;}
   }
  }
 }
 // Gemini uses explicit turn elements; generic shell filters can reject its entire form/history subtree.
 if(host==='gemini.google.com'){
  const userTurns=[...document.querySelectorAll('user-query')].filter(e=>(e.textContent||'').includes(q));
  const userTurn=userTurns.at(-1);
  const response=userTurn?[...document.querySelectorAll('model-response')].find(e=>!!(userTurn.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)):null;
  if(response){
   const body=response.querySelector('[class*="response-text"],model-response-text')||response;
   const text=readText(body);
   if(text.length>20&&text.length<50000&&!body.querySelector('textarea,[contenteditable="true"],nav')){answer=text;scopeEl=body;}
  }
 }

  const busy=[...document.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/(停止生成|Stop generating|停止回答)/i.test((e.getAttribute('aria-label')||e.innerText||'').trim()));
 const editor=[...document.querySelectorAll('#prompt-textarea,textarea[placeholder],textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"]')].find(visible),editorValue=editor?(editor.value??editor.innerText??editor.textContent??'').trim():'';
 // questionVisible 用 textContent：innerText 受延迟渲染影响，长对话里滚出视口的原题气泡会误判不可见
 const clone=document.body.cloneNode(true);for(const e of clone.querySelectorAll('#prompt-textarea,textarea,[contenteditable="true"]'))e.remove();const questionVisible=grok?!!anchor:(clone.textContent||'').includes(args.question);
 const modeBtn=[...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')||'').find(l=>/当前模式|当前模型|模式选择|model/i.test(l));
 const modelLabel=modeBtn?((modeBtn.match(/[“"]([^”"]+)[”"]/)||[])[1]||modeBtn.slice(0,40)):'';
 // DOM 遥测：定位“页面有回答但提取为空”类问题（innerText/textContent 长度、Shadow DOM）
 const dbgEl=s=>{const e=document.querySelector(s);return e?{it:(e.innerText||'').trim().length,tc:(e.textContent||'').trim().length,shadow:!!e.shadowRoot}:null;};
 const dom=grok?{anchor:!!anchor,candidates:candidates.length,response:dbgEl('[class*="response-content"]'),markdown:dbgEl('[class*="markdown"]'),bubble:dbgEl('[class*="message-bubble"]'),prose:dbgEl('[class*="prose"]')}:host==='chatgpt.com'||host==='chat.openai.com'?{user:dbgEl('[data-message-author-role="user"]'),assistant:dbgEl('[data-message-author-role="assistant"]'),markdown:dbgEl('[data-message-author-role="assistant"] .markdown'),anchor:!!anchor,candidates:candidates.length}:{modelResponse:dbgEl('model-response'),responseText:dbgEl('[class*="response-text"]'),chatApp:dbgEl('chat-app')};
 if(grok&&!anchor){
  const normalize=t=>String(t||'').replace(/\s+/g,' ').trim();
  const matches=[...document.querySelectorAll('p,div,span')].filter(e=>visible(e)&&solid(e)&&normalize(e.textContent)===normalize(q)&&!e.closest('nav,aside,header,textarea,[contenteditable="true"],[aria-live],[aria-hidden="true"],[class*="sidebar"]'));
  dom.questionPaths=matches.filter(e=>!matches.some(x=>x!==e&&e.contains(x))).slice(0,3).map(e=>{const path=[];for(let n=e;n&&n!==document.body&&path.length<4;n=n.parentElement)path.push(n.tagName.toLowerCase()+'.'+String(n.className).slice(0,95));return path;});

 }
 if(!answer)return {url:location.href,answer:'',busy,editorValue,questionVisible,dom,diagnostic:(grok&&!anchor?'Grok 原题DOM:'+JSON.stringify(dom.questionPaths)+'；':'')+((document.body.innerText||'').slice(-900)||(document.body.textContent||'').slice(-900))};
 return {url:location.href,answer,busy,editorValue,questionVisible,dom,...(modelLabel?{modelLabel}:{}),citations:scopeEl?[...new Set([...scopeEl.querySelectorAll('a[href]')].map(a=>a.href).filter(linkOk))]:[],searchedSources:findSearchedSources(scopeEl)};
}
// Gemini 等平台的正式引用不是 <a href>，而是引用 chip 按钮：逐个按 Enter 打开来源对话框，
// 读对话框里的真实链接，再关闭。只在保存样本前运行一次，不在轮询中执行。
async function harvestCitationsPage(args){
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
 const urls=new Set();let dialogsOpened=0;
 const chips=[...document.querySelectorAll('button[aria-label]')].filter(b=>visible(b)&&/来源详情|来源对话框|citation|source detail/i.test(b.getAttribute('aria-label')||''));
 const fireKey=(el,key)=>{const code=key==='Enter'?13:27;for(const type of ['keydown','keypress','keyup'])el.dispatchEvent(new KeyboardEvent(type,{key,code:key,keyCode:code,which:code,bubbles:true,cancelable:true}));};
 for(const chip of chips.slice(0,24)){
  try{
   chip.scrollIntoView({block:'center'});chip.focus();fireKey(chip,'Enter');
   let dialog=null;
   for(let i=0;i<15;i++){await wait(200);dialog=[...document.querySelectorAll('dialog,[role="dialog"]')].find(d=>visible(d)&&d.querySelector('a[href]'));if(dialog)break;}
   if(dialog){dialogsOpened++;for(const a of dialog.querySelectorAll('a[href]'))if(/^https?:\/\//.test(a.href))urls.add(a.href);
    fireKey(dialog,'Escape');fireKey(document.activeElement||document.body,'Escape');await wait(250);
    if(visible(dialog)){const c=[...dialog.querySelectorAll('button')].find(b=>/关闭|close/i.test((b.getAttribute('aria-label')||'')+(b.innerText||'')));if(c)c.click();await wait(200);}
   }
  }catch(e){}
 }
 // 兜底：结束时再发一次 Escape，避免遗留对话框盖住截图
 fireKey(document.activeElement||document.body,'Escape');
 return {url:location.href,citations:[...urls],chips:chips.length,dialogsOpened};
}
async function execute(command){
 if(Date.now()>command.expiresAt)throw Error('指令过期');
 const {action,args}=command,contextId=args.contextId||'default';let context=contexts.get(contextId);
 // 远程自更新：工作台把新代码推送到项目目录后，让扩展就地重载，免去用户手动进 chrome://extensions。
 if(action==='reload-extension'){setTimeout(()=>chrome.runtime.reload(),400);return {reloading:true};}
 if(action==='open'){
  const u=new URL(args.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('网站地址无效');
  const tab=await chrome.tabs.create({url:u.href,active:true});context={tabId:tab.id,allowedOrigin:u.origin};contexts.set(contextId,context);
  // tab.status 'complete' is also reached for chrome-error pages, so probe the
  // frame with executeScript; error pages reject and trigger a reload retry.
  for(let attempt=1;attempt<=3;attempt++){
   const deadline=Date.now()+30000;let t=null;
   while(Date.now()<deadline){t=await chrome.tabs.get(context.tabId);if(t.status==='complete')break;await wait(250);}
   if(t?.status==='complete'){
    try{const probe=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:()=>({url:location.href,title:document.title})});if(probe[0]?.result)return {url:probe[0].result.url};}catch(e){/* error page or frame gone: reload below */}
   }
   if(attempt<3){await wait(5000);try{await chrome.tabs.update(context.tabId,{url:u.href});}catch(e){}}
  }
  throw Error('页面加载失败：连续 3 次打开都未成功（可能被限流、拦截或网络异常）。请在浏览器手动打开该网站确认后再试。');
 }
 if(!context?.tabId)throw Error('请先打开工作台采集标签页');
 const tab=await chrome.tabs.get(context.tabId);if(new URL(tab.url).origin!==context.allowedOrigin)throw Error('采集页已跳转其他站点；需要用户处理');
 if(action==='close'){await chrome.tabs.remove(context.tabId);contexts.delete(contextId);return {closed:true};}
 if(action==='collect'){
  const result=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:collectPage,args:[args]});
  if(result[0]?.result)return result[0].result;throw Error('页面采集脚本没有返回结果');
 }
 if(action==='harvest-citations'){
  const result=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:harvestCitationsPage,args:[args]});
  if(result[0]?.result)return result[0].result;throw Error('引用提取脚本没有返回结果');
 }
 if(['submit','extract'].includes(action)){
  const result=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:shortPageOperation,args:[action,args]});
  if(result[0]?.result)return result[0].result;
  if(action==='submit'){await wait(800);const after=await chrome.tabs.get(context.tabId);
   // 提交期间页面跳走：若跳去登录页或离开采集站点，不能当作已提交——报需要登录。
   if(/accounts\.google\.com|\/login|signin|servicelogin/i.test(after.url)||new URL(after.url).origin!==context.allowedOrigin)return {url:after.url,loginRequired:true,submitted:false,filled:false,attempts:'navigated',editorValue:''};
   return {url:after.url,submitted:false,navigated:true,filled:null,attempts:'navigation-interrupted',editorValue:'',notice:'页面切换中提交回执丢失，需依据原题与回答确认，不能仅凭跳转认定成功'};}
  throw Error('页面读取脚本没有返回结果');
 }
 if(action==='screenshot'){
  for(let attempt=0;attempt<3;attempt++){
   const window=await chrome.windows.get(tab.windowId);
   await chrome.windows.update(tab.windowId,{focused:true,...(window.state==='minimized'?{state:'normal'}:{})});
   await chrome.tabs.update(context.tabId,{active:true});
   // Activation returns before Chrome has necessarily painted the tab's capture surface.
   await wait(700+attempt*500);
   const before=await chrome.tabs.query({active:true,windowId:tab.windowId});if(before[0]?.id!==context.tabId||before[0]?.url!==tab.url)throw Error('采集标签页不在前台或已跳转');
   let image;
   try{image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});}
   catch(error){if(attempt<2&&/image readback failed/i.test(error.message))continue;throw error;}
   const after=await chrome.tabs.query({active:true,windowId:tab.windowId});if(after[0]?.id!==context.tabId||after[0]?.url!==tab.url)throw Error('截图期间标签页变化，请重试');
   return {url:tab.url,image};
  }
 }
 if(!['snapshot','text','links','click','fill','press'].includes(action))throw Error('不支持的操作');
 const result=await chrome.scripting.executeScript({target:{tabId:context.tabId},func:pageOperation,args:[action,{...args,allowedOrigin:context.allowedOrigin}]});
 if(result[0]?.result)return result[0].result;
 if(['click','press'].includes(action)){await wait(600);const after=await chrome.tabs.get(context.tabId);if(new URL(after.url).origin===context.allowedOrigin)return {url:after.url,navigated:true};}
 throw Error('页面操作没有返回，请重新 snapshot 核对页面状态');
}
async function loop(){
 if(running)return;running=true;const generation=epoch;
 try{while(generation===epoch){
  const {connection}=await chrome.storage.local.get('connection');if(!connection)break;
  try{const {command}=await post(connection,'/poll',{});if(generation!==epoch)break;await status('已连接');if(command){execute(command).then(value=>post(connection,'/result',{id:command.id,value}),e=>post(connection,'/result',{id:command.id,error:e.message})).catch(()=>{});}}
  catch(e){await status(e.message);await wait(2500);}
 }}finally{running=false;}
}
chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
 (async()=>{if(m.type==='connect'){epoch++;await chrome.storage.local.set({connection:m.connection});await chrome.alarms.create('keep-connection',{periodInMinutes:0.5});while(running)await wait(100);loop();return {ok:true};}
 if(m.type==='disconnect'){epoch++;const {connection}=await chrome.storage.local.get('connection');await chrome.storage.local.remove('connection');await chrome.alarms.clear('keep-connection');if(connection)await post(connection,'/disconnect',{}).catch(()=>{});await status('已断开');return {ok:true};}throw Error('未知请求');})().then(reply,e=>reply({error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(()=>loop());chrome.runtime.onStartup.addListener(()=>loop());loop();
