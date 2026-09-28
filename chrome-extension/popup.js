const status=document.querySelector('#status');
document.querySelector('#connect').onclick=async()=>{try{
 const c=JSON.parse(document.querySelector('#connection').value);
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(c.endpoint)||! /^[a-f0-9]{64}$/.test(c.token))throw Error('连接码格式不正确');
 const allowed=await chrome.permissions.request({origins:['<all_urls>']});if(!allowed)throw Error('未授权网页访问，尚未连接');
 const r=await chrome.runtime.sendMessage({type:'connect',connection:c});if(r.error)throw Error(r.error);status.textContent='已发起连接，请在 DSH 点击“检查连接”。';
}catch(e){status.textContent=e.message;}};
document.querySelector('#disconnect').onclick=async()=>{await chrome.runtime.sendMessage({type:'disconnect'});status.textContent='已断开';};
chrome.storage.local.get('status').then(s=>status.textContent=s.status||'尚未连接');
