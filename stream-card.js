(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MapleStreamCard=api;})(typeof window==='undefined'?globalThis:window,function(){
function metrics(state,now,required,totalExp){
 const samples=(Array.isArray(state.samples)?state.samples:[]).filter(s=>Number.isInteger(s.level)&&s.level>=1&&s.level<=100&&Number.isFinite(s.exp)&&s.exp>=0&&Number.isFinite(s.t)&&s.t<=now).sort((a,b)=>a.t-b.t),latest=samples.at(-1),base=samples.find(s=>s.t>=now-300000);
 const level=latest?.level??state.level,need=required(level),exp=latest?.exp||0;
 const rate=base&&latest&&latest.t>base.t?Math.max(0,(totalExp(latest)-totalExp(base))/((latest.t-base.t)/3600000)):0;
 const remaining=need>0&&rate>0?Math.max(0,(need-exp)/rate*3600000):null;
 const eta=level===100?'MAX LEVEL':remaining===null?'Waiting for EXP':remaining<60000?'Under 1 min':remaining<3600000?Math.round(remaining/60000)+' min':Math.floor(remaining/3600000)+'h '+Math.floor(remaining%3600000/60000)+'m';
 return {level:Number.isInteger(level)&&level>=1&&level<=100?String(level):'—',rate:rate?Math.round(rate).toLocaleString('en-US'):'—',percent:need?Math.max(0,Math.min(100,exp/need*100)):0,eta,status:!state.updatedAt||now-state.updatedAt>20000?'TRACKER OFFLINE':state.running?'TRACKING':'PAUSED'};
}
function mount({document,window,storage,key,required,totalExp}){
 document.title='Maple Track · Stream card';document.body.classList.add('stream-card');
 document.querySelector('.app').innerHTML='<section class="stream-panel" aria-label="Maple Track live stream card"><header><span>MAPLE TRACK</span><span id="cardStatus">CONNECTING</span></header><div class="stream-values"><div><span>LEVEL</span><strong id="cardLevel">—</strong></div><div><span>EXP / HOUR</span><strong id="cardRate">—</strong></div></div><div class="stream-progress"><i id="cardFill"></i></div><footer><span id="cardPercent">0.00%</span><span id="cardEta">Waiting for EXP</span></footer></section>';
 const q=id=>document.querySelector(id);
 function render(){let state={};try{state=JSON.parse(storage.getItem(key)||'{}')||{};}catch{}const m=metrics(state,Date.now(),required,totalExp);q('#cardLevel').textContent=m.level;q('#cardRate').textContent=m.rate;q('#cardPercent').textContent=m.percent.toFixed(2)+'%';q('#cardFill').style.width=m.percent+'%';q('#cardEta').textContent=m.eta==='MAX LEVEL'?m.eta:'Level up · '+m.eta;q('#cardStatus').textContent=m.status;}
 const onStorage=event=>{if(event.key===key||event.key===null)render();};window.addEventListener('storage',onStorage);const timer=window.setInterval(render,5000);
 window.addEventListener('pagehide',()=>{window.clearInterval(timer);window.removeEventListener('storage',onStorage);},{once:true});render();
}
return {metrics,mount};
});
