const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('async function captureBrowserFrame('),html.indexOf('\nasync function connect('));
async function run(times,cancel=false,paused=false,debug=false){
 let clock=0,reads=0,passed,encodes=0,sourceFrame;const decodeClocks=[],canvases=[];const video={readyState:2,videoWidth:800,videoHeight:600,get currentTime(){return times[clock];}},image={dataset:{},classList:{remove(){}},set src(v){this.onload();}};
 const c={debug,state:{paused},captureGeneration:1,captureBusy:false,ocrRunning:false,captureStream:{},q:id=>id==='#sharePreview'?video:id==='#latestFrame'?image:id==='#autoOcr'?{checked:true}:{style:{},classList:{add(){}}},
 document:{createElement:()=>{const canvas={getContext:()=>({drawImage(){}}),toBlob:fn=>{encodes++;fn({});}};canvases.push(canvas);return canvas;}},
 setTimeout(fn,ms){if(ms===250)clock++;if(cancel)c.captureGeneration++;fn();},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Date,
 burstReading(){reads++;decodeClocks.push(clock);return {level:70,text:'[79.93%]'};},drawRegions(){},updateRegionStatus(){},setTrackingStatus(){},runOcr:async(t,burst,frame)=>{passed=burst;sourceFrame=frame;}};
 vm.createContext(c);vm.runInContext(source,c);await c.captureBrowserFrame();return {reads,passed,c,decodeClocks,canvases,encodes,sourceFrame};
}
(async()=>{
 const paused=await run([0,.25,.5],false,true);assert.equal(paused.reads,0);assert.equal(paused.passed,undefined,'A paused session must not capture frames');
 const fresh=await run([0,.25,.5]);assert.equal(fresh.reads,3);assert.deepEqual(fresh.decodeClocks,[2,2,2],'Freeze the entire burst before starting expensive OCR');assert.equal(fresh.passed.filter(Boolean).length,3);assert.equal(fresh.c.captureBusy,false);assert.ok(fresh.canvases.every(canvas=>canvas.width===0&&canvas.height===0),'Release capture backing stores after the burst');
 assert.equal(fresh.encodes,0,'Normal tracking must skip full-frame PNG encoding');assert.equal(fresh.sourceFrame,fresh.canvases.at(-1),'Validation reuses the last captured frame');
 const diagnostics=await run([0,.25,.5],false,false,true);assert.equal(diagnostics.encodes,1,'Debug mode retains its screenshot preview');
 const frozen=await run([0,0,0]);assert.equal(frozen.reads,1);assert.equal(frozen.passed.filter(Boolean).length,1,'Repeated video frames cannot vote');
 const partial=await run([0,.25,.25]);assert.equal(partial.reads,2);assert.equal(partial.passed.filter(Boolean).length,2);
 const stopped=await run([0,.25,.5],true);assert.equal(stopped.passed,undefined,'Stopping sharing cancels the burst');assert.equal(stopped.c.captureBusy,false);assert.ok(stopped.canvases.every(canvas=>canvas.width===0&&canvas.height===0),'Cancellation releases allocated frames');
 const pauseContext={captureStream:{},state:{paused:false,running:true,samples:[{level:68,exp:100}]},captureGeneration:2,queuedOcrTimestamp:123,pendingLevel:69,pendingLevelFrame:1,inferredLevelPending:{},setTrackingStatus(k,t){this.status=t;},update(){},captureBrowserFrame(){pauseContext.resumes=(pauseContext.resumes||0)+1;}};
 vm.createContext(pauseContext);vm.runInContext(html.slice(html.indexOf('function toggleSessionPause('),html.indexOf('function stopSharing(')),pauseContext);
 pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,true);assert.equal(pauseContext.state.running,false);assert.equal(pauseContext.captureGeneration,3);assert.equal(pauseContext.queuedOcrTimestamp,null);assert.equal(pauseContext.state.samples.length,1);assert.ok(pauseContext.captureStream);
 pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,false);assert.equal(pauseContext.state.running,true);assert.equal(pauseContext.resumes,1);assert.equal(pauseContext.state.samples.length,1);
 pauseContext.captureStream=null;pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,false);
 console.log('Burst capture: distinct video frames, frozen/partly frozen video, cancellation and lock cleanup passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
