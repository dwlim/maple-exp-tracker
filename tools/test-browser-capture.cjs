const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('function stopSharing(){'),html.indexOf('\nfunction addSample'));
function fixture(getDisplayMedia){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{disabled:false,classList:{add(){},remove(){}},pause(){},play:async()=>{},readyState:0});return elements.get(id);};
 const c={captureGeneration:0,captureTimer:null,captureStream:null,captureBusy:false,queuedOcrTimestamp:1,ocrRunning:false,overlay:false,state:{samples:[{exp:123}],running:false,source:null,startAt:null},navigator:{mediaDevices:{getDisplayMedia}},q:element,update(){},setTrackingStatus(kind,text){c.status={kind,text};},clearInterval(){c.cleared=true;},setInterval(fn,ms){c.intervalMs=ms;return 1;},Date,console};vm.createContext(c);vm.runInContext(source,c);c.captureBrowserFrame=async()=>{c.captured=(c.captured||0)+1;};return c;
}
(async()=>{
 let stopped=0,ended;const track={stop(){stopped++;},addEventListener(event,fn){assert.equal(event,'ended');ended=fn;}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const c=fixture(async options=>{assert.equal(options.audio,false);assert.equal(options.video.displaySurface,'window');return stream;});
 await c.connect();assert.equal(c.state.running,true);assert.equal(c.intervalMs,10000);assert.equal(c.captured,1);assert.equal(c.captureStream,stream);
 ended();assert.equal(stopped,1);assert.equal(c.captureStream,null);assert.equal(c.state.running,false);assert.equal(c.state.samples[0].exp,123);assert.equal(c.queuedOcrTimestamp,null);
 const cancelled=fixture(async()=>{throw Object.assign(new Error('cancelled'),{name:'NotAllowedError'});});await cancelled.connect();assert.equal(cancelled.captureStream,null);assert.equal(cancelled.q('#shareGameBtn').disabled,false);assert.match(cancelled.status.text,/cancelled/);
 const unsupported=fixture(undefined);await unsupported.connect();assert.match(unsupported.status.text,/unavailable/);
 const failed=fixture(async()=>stream);failed.q('#sharePreview').play=async()=>{throw Error('Video playback unavailable');};await failed.connect();assert.equal(failed.captureStream,null);assert.equal(failed.state.running,false);
 assert.ok(html.includes('if(!obsMode)return;try{'),'Browser OCR reporting must not call the OBS bridge');
 assert.ok(html.includes('if(overlay||!obsMode)return;'),'Browser tracking must not publish to the OBS bridge');
 console.log('Browser capture start, 10-second scheduling, audio disabled, ended cleanup, cancelled picker, unsupported browser and failed playback checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
