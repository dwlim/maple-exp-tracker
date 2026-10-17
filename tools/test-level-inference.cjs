const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),L=require('../level-ocr');
const html=fs.readFileSync('index.html','utf8'),required=vm.runInNewContext(html.match(/const required=l=>[^\n]+/)[0]+';required');
const reading=text=>({data:{text,confidence:text.includes('?')?0:95}});
const infer=(text,e,p,pending=null,frame=100000)=>L.resolveLevel(reading(text),e,p,required,pending,frame);
const first=infer('??',770482,78.82);
assert.equal(first.level,null);assert.equal(first.pending.level,56);
assert.equal(infer('??',770482,78.82,first.pending,100000).level,null,'One frame cannot confirm itself');
const second=infer('5?',770482,78.82,first.pending,110000);
assert.equal(second.level,56);
assert.equal(infer('??',770482,78.82,second.pending,120000).level,56);
assert.equal(infer('??',770482,78.82,first.pending,130000).level,null,'Expired evidence cannot confirm');
assert.equal(infer('??',770482,78.82,first.pending,90000).level,null,'Older frames cannot confirm');
assert.equal(infer('56',770482,78.82).level,56);
assert.equal(infer('58',770482,78.82).source,'conflict');
for(const [e,p] of [[NaN,78.82],[770482,NaN],[0,0],[1,.01],[770482,100],[770482,50]]){
 assert.equal(infer('??',e,p,first.pending,110000).level,null);
 assert.equal(infer('??',e,p,first.pending,110000).pending,null,'Invalid evidence resets confirmation');
}
assert.equal(infer('56',1,0).level,56,'Clear HUD digits still work near zero percent');
assert.equal(L.resolveLevel(reading('??'),500,50,()=>1000,null,1).level,null,'Multiple matching levels stay ambiguous');
assert.equal(L.checkContinuity(reading(String(second.level)),31,null).accepted,false,'Inference cannot bypass session continuity');

// Exercise the app pipeline with controlled recognition results; no fabricated live reports.
const functions=html.slice(html.indexOf('function parseHudReading('),html.indexOf('\nfunction downloadDebugFrame'));
const elements=new Map(),q=id=>{if(!elements.has(id))elements.set(id,{naturalWidth:3840,naturalHeight:2160});return elements.get(id);};
const c={MapleLevelOcr:{...L,recognize:()=>({...reading('??'),expectedDigits:2})},required,q,
 currentRegions:()=>({level:{},exp:{}}),cropLevelDigits:()=>({}),
 readExpGlyphs:()=>({rawText:'770.482[78.82%]',rawConfidence:95,data:{text:'770.482[78.82%]',confidence:95},uncertain:false}),
 document:{createElement:()=>({getContext:()=>({drawImage(){}})})},
 ocrRunning:false,queuedOcrTimestamp:null,lastFrameTimestamp:null,captureGeneration:1,captureStream:{},obsMode:false,debug:false,
 inferredLevelPending:null,pendingLevel:null,pendingLevelFrame:null,state:{level:null,samples:[]},
 Date,setTimeout,reportOcr(){},setTrackingStatus(){},addSample(level,exp,t){c.state.level=level;c.state.samples.push({level,exp,t});}};
vm.createContext(c);vm.runInContext(functions,c);
(async()=>{
 await c.runOcr(1700000000000);assert.equal(c.state.samples.length,0);
 await c.runOcr(1700000000000);assert.equal(c.state.samples.length,0);
 await c.runOcr(1700000010000);assert.equal(c.state.samples[0].level,56);
 assert.match(q('#ocrOutput').textContent,/level from EXP/);
 c.inferredLevelPending=null;c.state.level=null;c.state.samples=[];
 c.readExpGlyphs=()=>({rawText:'770.48?[78.82%]',rawConfidence:0,data:{text:'770.482[78.82%]',confidence:95},uncertain:false});
 await c.runOcr(1700000020000);await c.runOcr(1700000030000);
 assert.equal(c.state.samples.length,0,'Level-dependent EXP repairs cannot independently identify a level');
 console.log('EXP level inference: actual 56 values, confirmation, duplicate/stale frames, conflicts, low percentages, ambiguity, continuity and app pipeline passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
