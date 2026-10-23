const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs'),{createWorker}=require('tesseract.js'),R=require('../hud-regions'),L=require('../level-ocr'),N=require('../local-ocr');require('../hud-ocr');
(async()=>{
 assert.equal(N.choose([{text:'[94.65%]',confidence:75},{text:'[94.66%]',confidence:80}],'exp'),null,'Conflicting variants must reject');
 assert.equal(N.choose([{text:'[94.65%]',confidence:0},{text:'[94.65%]',confidence:0}],'exp'),null,'Low-confidence agreement alone must reject');
 assert.equal(N.choose([{text:'[194.65%]',confidence:90},{text:'[194.65%]',confidence:90}],'exp'),null,'Percentages over 100 must reject');
 let unnecessaryCalls=0;const fastOnly=N.createReader(async()=>{unnecessaryCalls++;throw Error('Should not load model');});
 await fastOnly.read({nativeLevel:{data:{text:'68'}},nativeExp:{text:'[54.96%]'}});await fastOnly.read({nativeLevel:{data:{text:'68'}},nativeExp:{text:'1?[54.96%]'}});assert.equal(unnecessaryCalls,0,'Clear text and absent images must not load a worker');
 assert.equal(N.choose([{text:'[54.96%]',confidence:90},{text:'[54.96%]',confidence:90}],'exp',{text:'1?[54.96%]'}),null,'An uncertain full amount cannot become a percentage-only estimate');
 const worker=await createWorker('eng',1,{langPath:path.resolve('assets/ocr'),gzip:true,cacheMethod:'none'});
 const reader=N.createReader(async(pixels,kind)=>{await worker.setParameters({tessedit_pageseg_mode:7,tessedit_char_whitelist:kind==='level'?'LV.0123456789':'0123456789.[]%'});const {data}=await worker.recognize(PNG.sync.write({width:pixels.width,height:pixels.height,data:Buffer.from(pixels.data)}));if(process.env.OCR_TRACE)console.log(kind,JSON.stringify(data.text.trim()),data.confidence);return {text:data.text,confidence:data.confidence};});
 try{
 for(const f of require('./stream-holdout-fixtures.json')){
  const image={width:f.width,height:f.height,data:new Uint8ClampedArray(f.width*f.height*4)};for(const p of f.patches)for(let y=0;y<p.height;y++)image.data.set(p.data.slice(y*p.width*4,(y+1)*p.width*4),((p.y+y)*f.width+p.x)*4);
  const rs=R.detect(image,L,MapleHudOcr);assert.ok(rs.level&&rs.exp,f.name+' detection');
  const box=r=>({x:Math.round(r.x*f.width),y:Math.round(r.y*f.height),w:Math.round(r.w*f.width),h:Math.round(r.h*f.height)}),lb=box(rs.level),nativeLevel=L.recognize(R.crop(image,lb)),expImage=R.crop(image,box(rs.exp)),nativeExp=MapleHudOcr.recognize(expImage),levelImage=R.crop(image,{x:lb.x-lb.h*3,y:lb.y-lb.h*.6,w:lb.w+lb.h*3.4,h:lb.h*2}),recovered=await reader.read({levelImage,expImage,nativeLevel,nativeExp});
  if(f.exp.startsWith('['))assert.equal(recovered.level?.text||nativeLevel.data.text,f.level,f.name+' level');assert.equal(recovered.exp?.text||nativeExp.text,f.exp,f.name+' EXP');
  const vm=require('node:vm'),html=fs.readFileSync('index.html','utf8'),required=vm.runInNewContext(html.match(/const required=l=>[^\n]+/)[0]+';required'),nodes=new Map(),q=id=>{if(!nodes.has(id))nodes.set(id,{naturalWidth:f.width,naturalHeight:f.height,dataset:{},textContent:''});return nodes.get(id);};
  const context={MapleLevelOcr:L,MapleHudOcr,MapleHudRegions:R,MapleLocalOcr:reader,required,fmt:String,q,currentRegions:()=>rs,cropLevelDigits:r=>R.crop(image,box(r)),
   document:{createElement:()=>{let rect;return {getContext:()=>({drawImage(...args){if(args.length>3)rect={x:args[1],y:args[2],w:args[3],h:args[4]};},getImageData:()=>rect?R.crop(image,rect):image})};}},
   ocrRunning:false,queuedOcrTimestamp:null,lastFrameTimestamp:null,captureGeneration:1,captureStream:{},debug:false,inferredLevelPending:null,pendingLevel:null,pendingLevelFrame:null,state:{level:null,samples:[],calibration:{auto:true}},Date,setTimeout,setTrackingStatus(kind,text){context.status={kind,text};},addSample(level,exp,t,meta){context.state.level=level;context.state.samples.push({level,exp,t,...meta});}};
  vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function readExpGlyphs('),html.indexOf('\nfunction beginRegionSelection')),context);vm.runInContext(html.slice(html.indexOf('function parseHudReading('),html.indexOf('\nfunction downloadDebugFrame')),context);vm.runInContext(html.slice(html.indexOf('async function burstReading('),html.indexOf('async function captureBrowserFrame(')),context);
  const frame={width:f.width,height:f.height,getContext:()=>({getImageData:()=>image})},vote=await context.burstReading(frame);assert.equal(vote?.level,Number(f.level));assert.equal(vote?.text,f.exp);
  await context.runOcr(1700000000000,[vote,vote,null]);if(!f.exp.startsWith('[')&&!recovered.level){assert.equal(context.state.samples.length,0,'An inferred level must await another distinct frame');await context.runOcr(1700000010000,[vote,vote,null]);}assert.equal(context.state.samples.length,1,JSON.stringify(context.status));assert.equal(context.state.samples[0].level,Number(f.level));if(f.exp.startsWith('['))assert.equal(context.state.samples[0].pct,Number(f.exp.match(/[\d.]+/)[0]));else{assert.equal(context.state.samples[0].exp,Number(f.exp.split('[')[0].replace(/\./g,'')));assert.ok(!context.state.samples[0].estimated);}
  await context.runOcr(1700000020000,[vote,null,null]);assert.equal(context.state.samples.length,1,'One vote must not save even with the neural fallback');
  console.log(f.name+' passed real engine, burst decoding, conversion, sample saving and single-vote rejection');
 }
 let uncertain=0;
 const optionalLevels=require('./neural-safety-fixtures.json');
 for(const f of optionalLevels){const nativeLevel=L.recognize(f);if(!nativeLevel.data.text.includes('?'))continue;const r=await reader.read({levelImage:f,nativeLevel,nativeExp:{text:''}});if(r.level&&r.level.text!==f.expected)console.log('NEURAL_CONFLICT',JSON.stringify({expected:f.expected,reading:r.level,native:nativeLevel}));if(r.level)assert.equal(r.level.text,f.expected,'Neural fallback must never turn a safely rejected level into a wrong accepted level');uncertain++;}
 if(uncertain)console.log('Neural safety checks passed for '+uncertain+' previously uncertain level variants');
 }finally{await worker.terminate();}
})().catch(e=>{console.error(e);process.exitCode=1;});
