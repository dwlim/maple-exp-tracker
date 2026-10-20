const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),C=require('../stream-card');
const html=fs.readFileSync('index.html','utf8'),required=vm.runInNewContext(html.match(/const required=l=>[^\n]+/)[0]+';required'),totalExp=s=>{let n=s.exp;for(let i=1;i<s.level;i++)n+=required(i);return n;};
const now=Date.now(),state={running:true,updatedAt:now,level:32,samples:[{level:32,exp:1000,t:now-60000},{level:32,exp:2000,t:now}]};
let m=C.metrics(state,now,required,totalExp);assert.equal(m.level,'32');assert.equal(m.rate,'60,000');assert.equal(m.status,'TRACKING');assert.ok(m.percent>1&&m.percent<2);assert.notEqual(m.eta,'Waiting for EXP');
assert.equal(C.metrics({...state,running:false},now,required,totalExp).status,'PAUSED');
assert.equal(C.metrics({...state,samples:state.samples.map(s=>({...s,estimated:true}))},now,required,totalExp).rate,'~60,000','Percentage-only rates must be marked approximate on stream cards');
assert.equal(C.metrics(state,now+21000,required,totalExp).status,'TRACKER OFFLINE');
assert.equal(C.metrics({},now,required,totalExp).level,'—');
assert.equal(C.metrics({level:100,samples:[]},now,required,totalExp).eta,'MAX LEVEL');
assert.equal(C.metrics({...state,samples:[{level:31,exp:108000,t:now-60000},{level:32,exp:100,t:now}]},now,required,totalExp).rate,'34,800','Level-up rate uses total EXP');
assert.equal(C.metrics({...state,samples:[{level:32,exp:1000,t:now-600000}]},now,required,totalExp).rate,'—','Old samples must not show a live rate');
assert.equal(C.metrics({samples:[{level:32,exp:-1,t:now},{level:32,exp:0,t:now+60000}]},now,required,totalExp).level,'—');

// Boot the actual stream URL: it must only render, never request capture or write session data.
const nodes=new Map(),events=new Map(),intervals=[];let writes=0,stored=JSON.stringify(state);
const q=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{add(){},toggle(){}},innerHTML:''});return nodes.get(id);};
const storage={getItem:()=>stored,setItem(){writes++;}};
const win={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setInterval(fn,ms){intervals.push({fn,ms});return 1;},clearInterval(id){assert.equal(id,1);}};
const context={document:{querySelector:q,body:q('body')},window:win,location:{search:'?stream=1'},URLSearchParams,localStorage:storage,MapleStreamCard:C,setInterval(){throw Error('Dashboard loop must not run in the stream card');},navigator:{mediaDevices:{getDisplayMedia(){throw Error('Card must not capture');}}}};
vm.createContext(context);vm.runInContext(html.slice(html.lastIndexOf('(()=>{'),html.lastIndexOf('</script>')),context);
assert.equal(writes,0);assert.equal(q('#cardLevel').textContent,'32');assert.equal(q('#cardRate').textContent,'60,000');assert.equal(intervals[0].ms,5000);
stored=JSON.stringify({...state,samples:[],level:56,running:false});events.get('storage')({key:'maple-track-v1'});assert.equal(q('#cardLevel').textContent,'56');assert.equal(q('#cardStatus').textContent,'PAUSED');
stored='invalid';events.get('storage')({key:null});assert.equal(q('#cardLevel').textContent,'—','Cleared or malformed storage must reset the card');
events.get('pagehide')();assert.equal(events.has('storage'),false);
assert.ok(html.includes(fs.readFileSync('stream-card.js','utf8')),'Embedded stream card must match tested source');
console.log('Stream card: rates, level-ups, ETA, stale/offline state, local storage sync, malformed storage, read-only startup and cleanup passed.');
