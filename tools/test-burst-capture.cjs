const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('async function captureBrowserFrame('),html.indexOf('\nasync function connect('));
async function run({times=[1,2],outcomes=[{accepted:true,retry:false}],debug=false,paused=false,cancel=null,automatic=true,frameCounts=null}={}){
 let clock=0,decodes=0,encodes=0;const calls=[],canvases=[],delays=[];
 class TestDate extends Date{static now(){return 1700000000000+clock*250;}}
 const video={readyState:2,videoWidth:800,videoHeight:600,get currentTime(){return times[clock];}},image={dataset:{},classList:{remove(){}},set src(v){this.onload();}};
 if(frameCounts)video.getVideoPlaybackQuality=()=>({totalVideoFrames:frameCounts[clock]});
 const c={debug,state:{paused},captureGeneration:1,captureBusy:false,ocrRunning:false,captureStream:{},q:id=>id==='#sharePreview'?video:id==='#latestFrame'?image:id==='#autoOcr'?{checked:automatic}:{style:{},classList:{add(){}}},
 document:{createElement:()=>{const canvas={getContext:()=>({drawImage(){}}),toBlob:fn=>{encodes++;fn({});}};canvases.push(canvas);return canvas;}},
 setTimeout(fn,ms){delays.push(ms);if(ms===250)clock++;if(cancel==='yield'||(cancel==='retry'&&ms===250))c.captureGeneration++;fn();},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Date:TestDate,
 decodeFrame(frame){assert.ok(frame.width&&frame.height);decodes++;if(cancel==='decode')c.captureGeneration++;},drawRegions(){},updateRegionStatus(){},setTrackingStatus(){},
 runOcr:async(t,frame,options)=>{calls.push({t,frame,options});return outcomes[Math.min(calls.length-1,outcomes.length-1)];}};
 vm.createContext(c);vm.runInContext(source,c);await c.captureBrowserFrame();return {c,calls,canvases,decodes,encodes,delays};
}
(async()=>{
 const clear=await run();assert.equal(clear.decodes,1);assert.equal(clear.canvases.length,1);assert.equal(clear.calls.length,1,'A clear reading is validated once');assert.equal(clear.encodes,0);assert.ok(!clear.delays.includes(250),'No burst delay for a clear frame');assert.equal(Math.round(clear.calls[0].t*1000),clear.calls[0].frame._capturedAt);
 const retry=await run({outcomes:[{accepted:false,retry:true},{accepted:true,retry:false}]});assert.equal(retry.decodes,2);assert.equal(retry.canvases.length,2);assert.equal(retry.calls.length,2);assert.notEqual(retry.calls[0].frame,retry.calls[1].frame);assert.ok(retry.calls[1].t>retry.calls[0].t,'Confirmation uses a fresh capture timestamp');assert.equal(retry.calls[0].options.report,false,'Interim failures do not download screenshots');
 const frozen=await run({times:[1,1],outcomes:[{accepted:false,retry:true}]});assert.equal(frozen.decodes,1);assert.equal(frozen.canvases.length,1);assert.equal(frozen.calls[0].t,frozen.calls[1].t,'A frozen video cannot provide a fresh confirmation');
 const stalledDecoder=await run({times:[1,2],frameCounts:[10,10],outcomes:[{accepted:false,retry:true}]});assert.equal(stalledDecoder.decodes,1,'An advancing playback clock alone cannot confirm if the decoder frame counter is frozen');
 const advancedDecoder=await run({times:[1,1],frameCounts:[10,11],outcomes:[{accepted:false,retry:true},{accepted:true,retry:false}]});assert.equal(advancedDecoder.decodes,2,'Use real decoded-frame advancement when available');
 const wrongCharacter=await run({outcomes:[{accepted:false,retry:false}]});assert.equal(wrongCharacter.decodes,1);assert.ok(!wrongCharacter.delays.includes(250),'A session mismatch needs user action rather than another capture');
 const paused=await run({paused:true});assert.equal(paused.decodes,0);assert.equal(paused.canvases.length,0);
 for(const cancel of ['yield','decode','retry']){const stopped=await run({cancel,outcomes:[{accepted:false,retry:true}]});assert.ok(stopped.calls.length<2,'Cancellation prevents a later confirmation');assert.equal(stopped.c.captureBusy,false);assert.ok(stopped.canvases.every(canvas=>canvas.width===0&&canvas.height===0));}
 const diagnostics=await run({debug:true,outcomes:[{accepted:false,retry:true},{accepted:false,retry:false}]});assert.equal(diagnostics.encodes,1);assert.ok(diagnostics.calls.at(-1).frame._pngBlob,'Final debug rejection reuses its exact preview PNG');
 const manual=await run({automatic:false});assert.equal(manual.decodes,0);assert.equal(manual.encodes,1);assert.equal(manual.calls.length,0);
 for(const result of [clear,retry,frozen,wrongCharacter,diagnostics,manual]){assert.equal(result.c.captureBusy,false);assert.ok(result.canvases.every(canvas=>canvas.width===0&&canvas.height===0),'All capture backing stores are released');}
 const pauseContext={captureStream:{},state:{paused:false,running:true,samples:[{level:68,exp:100}]},captureGeneration:2,queuedOcrTimestamp:123,pendingLevel:69,pendingLevelFrame:1,inferredLevelPending:{},setTrackingStatus(k,t){this.status=t;},update(){},captureBrowserFrame(){pauseContext.resumes=(pauseContext.resumes||0)+1;}};
 vm.createContext(pauseContext);vm.runInContext(html.slice(html.indexOf('function toggleSessionPause('),html.indexOf('function stopSharing(')),pauseContext);
 pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,true);assert.equal(pauseContext.state.running,false);assert.equal(pauseContext.captureGeneration,3);assert.equal(pauseContext.queuedOcrTimestamp,null);assert.equal(pauseContext.state.samples.length,1);assert.ok(pauseContext.captureStream);
 pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,false);assert.equal(pauseContext.state.running,true);assert.equal(pauseContext.resumes,1);assert.equal(pauseContext.state.samples.length,1);
 pauseContext.captureStream=null;pauseContext.toggleSessionPause();assert.equal(pauseContext.state.paused,false);
 console.log('Capture: single clear frame, ambiguity-only fresh retry, frozen-frame protection, cancellation, debug output and pause/resume passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
