const fs=require('node:fs'),assert=require('node:assert/strict'),L=require('../level-ocr.js');
assert.equal(L.recognize(require('./level25-small-fixture.json')).data.text,'25','A compressed large-glyph calibration must not make a small 5 ambiguous');
const baseline=require('./level-bounds-fixture.json');assert.equal(L.recognize(baseline).data.text,'31');
if(fs.existsSync('tools/browser-level-fixture.json'))assert.equal(L.recognize(require('./browser-level-fixture.json')).data.text,'31','Downloaded browser capture must preserve the leading 3');
const level56=require('./level56-fixture.json');
assert.equal(L.recognize(level56).data.text,'56','Real 4K level 56: tile corner highlights must not distort digit bounds');
for(const factor of [.7,.85,1.15])assert.equal(L.recognize({...level56,data:level56.data.map((v,i)=>i%4===3?v:Math.min(255,Math.round(v*factor)))}).data.text,'56','Level 56 must tolerate brightness changes');
for(const scale of [.5,.75,1.25,1.5]){
 const width=Math.round(level56.width*scale),height=Math.round(level56.height*scale),data=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(Math.min(level56.height-1,Math.floor(y/scale))*level56.width+Math.min(level56.width-1,Math.floor(x/scale)))*4;data.push(...level56.data.slice(i,i+4));}
 assert.equal(L.recognize({width,height,data}).data.text,'56',`Level 56 at scale ${scale}`);
}
let checked=0,exact=0,rejected=0;
if(fs.existsSync('tools/level-scale-fixtures.local.json'))for(const f of require('./level-scale-fixtures.local.json')){const r=L.recognize(f);checked++;if(r.data.text===f.expected)exact++;else{assert.ok(r.data.text.includes('?'),`Scaled false level ${f.expected} → ${r.data.text}`);rejected++;}}
if(fs.existsSync('tools/level-font-fixtures.local.json'))for(const f of require('./level-font-fixtures.local.json')){
 for(const factor of [.7,.85,1,1.15]){const data=f.data.map((v,i)=>i%4===3?v:Math.min(255,Math.round(v*factor))),r=L.recognize({...f,data});checked++;if(r.data.text===f.expected)exact++;else{assert.ok(r.data.text.includes('?'),`False level ${f.expected} → ${r.data.text}`);rejected++;}}
}
assert.equal(L.recognize({width:40,height:20,data:new Uint8Array(3200)}).data.text,'?');
const broadOrange={width:67,height:37,data:Uint8Array.from({length:67*37*4},(_,i)=>[240,130,15,255][i%4])};
assert.equal(L.findTiles(broadOrange),null,'A broad orange area without a dark seam must never be divided into invented tiles');
const read=text=>({data:{text,confidence:95}});
assert.equal(L.checkContinuity(read('31'),null,null).accepted,true);
assert.equal(L.checkContinuity(read('31'),31,null).accepted,true);
assert.equal(L.checkContinuity(read('32'),31,null).accepted,false);
assert.equal(L.checkContinuity(read('32'),31,32).accepted,true);
assert.equal(L.checkContinuity(read('81'),31,81).accepted,false);
assert.equal(L.checkContinuity(read('?1'),31,null).accepted,false);
const baselineData=baseline.data.slice(),shifted=new Uint8Array((baseline.width+6)*(baseline.height+6)*4);for(let y=0;y<baseline.height;y++)shifted.set(baselineData.slice(y*baseline.width*4,(y+1)*baseline.width*4),((y+3)*(baseline.width+6)+3)*4);assert.equal(L.recognize({width:baseline.width+6,height:baseline.height+6,data:shifted}).data.text,'31','Tile padding and translation must preserve the level');
const html=fs.readFileSync('index.html','utf8');assert.ok(!html.includes('Tesseract')&&!html.includes('getOcrWorker'),'Level recognition must not use general OCR or a remote model');
console.log(`Level matcher: baseline/browser 31, blank rejection, continuity and level-up confirmation passed; ${exact}/${checked} transformed local captures exact, ${rejected} safely rejected.`);
