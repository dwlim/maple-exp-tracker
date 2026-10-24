const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),L=require('../level-ocr'),R=require('../hud-regions');require('../hud-ocr');
const H=MapleHudOcr,html=fs.readFileSync('index.html','utf8'),required=vm.runInNewContext(html.match(/const required=l=>[^\n]+/)[0]+';required');
for(const text of ['[78.82%]','78.82%']){const result=H.percentageReading(text,required(61));assert.ok(result?.estimated);assert.equal(result.exp,Math.round(required(61)*.7882));assert.equal(result.pct,78.82);}
for(const text of ['[?8.82%]','[78.82%','78.82%]','1.200.000[78.82%]','101.00%','-1.00%','78%','78.8%','[EXP 78.82%]'])assert.equal(H.percentageReading(text,required(61)),null,text);
assert.equal(H.percentageReading('[78.82%]',required(56)).exp,Math.round(required(56)*.7882),'The observed HUD format, not a numeric cutoff, selects percentage mode');
assert.equal(H.percentageReading('[0.34%]',required(61)).exp,Math.round(required(61)*.0034),'Valid percentage-only readings below one million must be supported');
assert.equal(H.percentageReading('[78.82%]',NaN),null);
assert.ok(H.percentageReading('[0.34%]',required(99)).exp>1000000);
const nominal=H.percentageReading('[78.82%]',required(61));
assert.equal(H.percentageReading('[78.82%]',required(61),nominal.exp+10).exp,nominal.exp+10,'Switching formats must retain a previous value within the rounding interval');
assert.equal(H.percentageReading('[78.82%]',required(61),nominal.exp+1000).exp,nominal.exp,'Values outside the rounding interval must not override a new reading');

// Construct percentage-only layouts from real, independently verified glyph pixels.
// The level recognizer is stubbed to 99 for detector isolation; these are not live captures.
const fixture=require('./hud-region-fixtures.json').find(f=>f.level==='32'),p=fixture.patches[1];
function assemble(bare=false,withAmount=false){
 const width=fixture.width,height=fixture.height,data=new Uint8ClampedArray(width*height*4);
 const patches=[fixture.patches[0]];
 if(withAmount)patches.push(p);
 else{
  const label=R.crop(p,{x:0,y:0,w:58,h:p.height}),percentage=R.crop(p,{x:96,y:0,w:75,h:p.height});
  if(bare)for(let i=0;i<percentage.data.length;i+=4)if(percentage.data[i+1]-percentage.data[i]>12&&percentage.data[i+1]-percentage.data[i+2]>20)percentage.data.set([45,52,55,255],i);
  patches.push({...label,x:p.x,y:p.y},{...percentage,x:p.x+59,y:p.y});
 }
 for(const patch of patches)for(let y=0;y<patch.height;y++)data.set(patch.data.slice(y*patch.width*4,(y+1)*patch.width*4),((patch.y+y)*width+patch.x)*4);
 return {width,height,data};
}
const highLevel={...L,recognize:image=>{const r=L.recognize(image);return r.expectedDigits?{...r,data:{text:'99',confidence:98}}:r;}};
const pixels=(r,f)=>({x:Math.round(r.x*f.width),y:Math.round(r.y*f.height),w:Math.round(r.w*f.width),h:Math.round(r.h*f.height)});
for(const bare of [false,true]){
 const f=assemble(bare),regions=R.detect(f,highLevel,H);assert.ok(regions.exp,`Percentage-only layout ${bare?'bare':'bracketed'} must be detected`);
 const text=H.recognize(R.crop(f,pixels(regions.exp,f))).text;assert.ok(H.percentageReading(text,required(99)),text);
 const tracked=R.detect(f,highLevel,H,{...regions,width:f.width,height:f.height});assert.ok(tracked.exp);
 const crop=R.crop(f,pixels(regions.exp,f)),readContext={MapleHudOcr:H,required,state:{samples:[]},debug:false,document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>crop})})}};
 vm.createContext(readContext);vm.runInContext(html.slice(html.indexOf('function readExpGlyphs('),html.indexOf('\nfunction beginRegionSelection')),readContext);
 const result=readContext.readExpGlyphs(regions.exp,f,99);assert.equal(result.uncertain,false);assert.equal(result.percentageOnly.estimated,true);
 assert.equal(readContext.readExpGlyphs(regions.exp,f,NaN).uncertain,true,'Actual crop path must reject percentages with no readable level');
}
const full=assemble(false,true),fullRegions=R.detect(full,highLevel,H),fullText=H.recognize(R.crop(full,pixels(fullRegions.exp,full))).text;
assert.equal(fullText,'412[0.34%]','Full-amount readings must not be cropped into percentage-only estimates');
assert.ok(R.detect(assemble(false),L,H).exp,'A percentage-only layout must be locatable without the old hardcoded high-level gate');

const nodes=new Map(),q=id=>{if(!nodes.has(id))nodes.set(id,{naturalWidth:2564,naturalHeight:1486,dataset:{}});return nodes.get(id);};
const c={MapleLevelOcr:L,required,fmt:n=>String(n),q,currentRegions:()=>({level:{},exp:{}}),cropLevelDigits:()=>({}),
 readExpGlyphs:()=>({rawText:'[78.82%]',rawConfidence:95,data:{text:'[78.82%]',confidence:95},percentageOnly:H.percentageReading('[78.82%]',required(61)),uncertain:false}),
 document:{createElement:()=>({getContext:()=>({drawImage(){}})})},ocrRunning:false,queuedOcrTimestamp:null,lastFrameTimestamp:null,captureGeneration:1,captureStream:{},debug:false,inferredLevelPending:null,pendingLevel:null,pendingLevelFrame:null,state:{level:null,samples:[]},Date,setTimeout,setTrackingStatus(){},
 addSample(level,exp,t,meta){c.state.level=level;c.state.samples.push({level,exp,t,...meta});}};
c.MapleLevelOcr={...L,recognize:()=>({data:{text:'61',confidence:95},expectedDigits:2})};
c.samples=()=>c.state.samples;
vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function updateRateHint('),html.indexOf('function draw(ss)')),c);vm.runInContext(html.match(/function setTrackingStatus[^\n]+/)[0],c);vm.runInContext(html.slice(html.indexOf('function parseHudReading('),html.indexOf('\nfunction downloadDebugFrame')),c);
(async()=>{
 await c.runOcr(1700000000000);assert.equal(c.state.samples.length,1);assert.equal(c.state.samples[0].estimated,true);assert.equal(c.state.samples[0].exp,Math.round(required(61)*.7882));
 assert.match(q('#ocrOutput').textContent,/estimated from percentage/);
 const before=c.state.samples.length;
 await c.runOcr(1700000001000);
 assert.equal(c.state.samples.length,before+1,'One clear frame saves without a burst');
 c.state.samples.splice(1);

 c.MapleLevelOcr.recognize=()=>({data:{text:'??',confidence:0},expectedDigits:2});await c.runOcr(1700000010000);assert.equal(c.state.samples.length,1,'Percentage alone cannot recover an unreadable level');
 c.MapleLevelOcr.recognize=()=>({data:{text:'62',confidence:95},expectedDigits:2});
 c.readExpGlyphs=()=>({rawText:'[0.92%]',rawConfidence:95,data:{text:'[0.92%]',confidence:95},percentageOnly:H.percentageReading('[0.92%]',required(62)),uncertain:false});
 const pending=await c.runOcr(1700000020000);assert.equal(pending.accepted,false);assert.equal(pending.retry,true,'A level-up requests fresh confirmation');const count=c.state.samples.length;await c.runOcr(1700000020000);assert.equal(c.state.samples.length,count,'The same captured frame cannot confirm its own level-up');await c.runOcr(1700000030000);assert.equal(c.state.samples.at(-1).level,62);assert.equal(c.state.samples.at(-1).estimated,true,'Level-up must accept a percentage-only reading below one million');
 c.readExpGlyphs=()=>({rawText:'12.345[0.92%]',rawConfidence:95,data:{text:'12.345[0.92%]',confidence:95},uncertain:false});
 await c.runOcr(1700000035000);assert.equal(c.state.samples.at(-1).level,62);assert.equal(c.state.samples.at(-1).exp,12345);assert.ok(!c.state.samples.at(-1).estimated,'Level-up returns to exact amount mode');
 // Full app pipeline using the real percentage-only HUD crops supplied by the user.
 for(const real of [...require('./hud-region-fixtures.json'),...require('./downloaded-hud-fixtures.json')].filter(f=>f.percentageOnly)){
 const actual={width:real.width,height:real.height,data:new Uint8ClampedArray(real.width*real.height*4)};
 for(const p of real.patches)for(let y=0;y<p.height;y++)actual.data.set(p.data.slice(y*p.width*4,(y+1)*p.width*4),((p.y+y)*actual.width+p.x)*4);
 c.state={level:null,samples:[]};c.pendingLevel=c.pendingLevelFrame=c.inferredLevelPending=null;c.MapleLevelOcr=L;c.MapleHudOcr=H;
 q('#latestFrame').naturalWidth=actual.width;q('#latestFrame').naturalHeight=actual.height;
 c.currentRegions=()=>R.detect(actual,L,H);c.cropLevelDigits=r=>R.crop(actual,pixels(r,actual));
 c.document={createElement:()=>{let rect;return {getContext:()=>({drawImage(...args){if(args.length>3)rect={x:args[1],y:args[2],w:args[3],h:args[4]};},getImageData:()=>R.crop(actual,rect)})};}};
 vm.runInContext(html.slice(html.indexOf('function readExpGlyphs('),html.indexOf('\nfunction beginRegionSelection')),c);
 await c.runOcr(1700000040000);assert.equal(c.state.samples[0].level,Number(real.level));assert.equal(c.state.samples[0].pct,Number(real.exp.match(/[\d.]+/)[0]));assert.equal(c.state.samples[0].exp,real.estimatedExp||1114283);assert.equal(c.state.samples[0].estimated,true);
 const accepted=c.state.samples[0];c.state={level:32,samples:[]};c.pendingLevel=null;
 await c.runOcr(1700000050000);assert.equal(c.state.samples.length,0);assert.match(q('#rateHint').textContent,/saved level 32/,'Persisted-level rejection must be visible in the rate card');
 c.state={level:null,samples:[]};c.pendingLevel=null;
 await c.runOcr(1700000060000);await c.runOcr(1700000070000);assert.equal(c.state.samples.length,2,'Two fresh accepted frames must accumulate after resetting the session');c.updateRateHint();assert.match(q('#rateHint').textContent,/Estimated/);assert.equal(c.state.samples[0].exp,accepted.exp);
 }
 console.log('Percentage-only: rounding estimates, format/range validation, below-one-million level-ups, bare/bracketed detection, saved-session blockers, consecutive samples and exact-mode restoration passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Explicit occlusion mode must find a unique complete bracket pair, never guess one.
for(const fixture of require('./covered-exp-fixtures.json')){
 const image={width:fixture.width,height:fixture.height,data:new Uint8ClampedArray(fixture.width*fixture.height*4)};
 for(const p of fixture.patches){const data=require('node:zlib').inflateSync(Buffer.from(p.rgba,'base64'));for(let y=0;y<p.height;y++)image.data.set(data.subarray(y*p.width*4,(y+1)*p.width*4),((p.y+y)*image.width+p.x)*4);}
 const region=R.detect(image,L,H).exp,percent=R.percentageRegion(image,region);assert.ok(percent);assert.ok(percent.w<region.w,'Percentage mode excludes occluding inventory fragments');
 const blank={...image,data:new Uint8ClampedArray(image.data.length)};assert.equal(R.percentageRegion(blank,region),null,'Missing brackets must reject rather than fall back to covered text');
}
