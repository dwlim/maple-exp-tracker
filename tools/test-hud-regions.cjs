const assert=require('node:assert/strict'),R=require('../hud-regions'),L=require('../level-ocr');require('../hud-ocr');
const fixtures=require('./hud-region-fixtures.json');
// Only real HUD crops are stored. Composite them onto blank frames to vary position and size.
function frame(f,scale=1,dx=0,dy=0){
 const width=Math.round(f.width*scale)+Math.max(dx,0),height=Math.round(f.height*scale),data=new Uint8ClampedArray(width*height*4);
 for(const p of f.patches)for(let y=0;y<Math.round(p.height*scale);y++)for(let x=0;x<Math.round(p.width*scale);x++){
  const nx=Math.round(p.x*scale)+x+dx,ny=Math.round(p.y*scale)+y+dy;
  if(nx<0||nx>=width||ny<0||ny>=height)continue;
  const i=(Math.min(p.height-1,Math.floor(y/scale))*p.width+Math.min(p.width-1,Math.floor(x/scale)))*4;
  data.set(p.data.slice(i,i+4),(ny*width+nx)*4);
 }
 return {width,height,data};
}
const pixels=(r,f)=>({x:Math.round(r.x*f.width),y:Math.round(r.y*f.height),w:Math.round(r.w*f.width),h:Math.round(r.h*f.height)});
let count=0;
for(const fixture of fixtures)for(const scale of [.75,1,1.5,2])for(const dx of [0,45]){
 const f=frame(fixture,scale,dx,dx?-20:0),regions=R.detect(f,L,MapleHudOcr);
 assert.ok(regions.level,`Missing level ${fixture.level}, scale ${scale}, shift ${dx}`);
 const text=L.recognize(R.crop(f,pixels(regions.level,f))).data.text;
 assert.ok(text===fixture.level||text.includes('?'),`Wrong level ${text}`);
 if(!fixture.occludedExp&&(fixture.percentageOnly?scale===1||regions.exp:scale>=1||regions.exp)){assert.ok(regions.exp,`Missing EXP at scale ${scale}`);const exp=MapleHudOcr.recognize(R.crop(f,pixels(regions.exp,f)));const expected=fixture.exp||(fixture.level==='2'?'5[14.71%]':'18[0.02%]');assert.ok(exp.text===expected||exp.text.includes('?'),`Wrong accepted EXP: ${exp.text}, expected ${expected}`);
  if(fixture.percentageOnly&&scale===1){assert.equal(text,'60');assert.equal(exp.text,'[92.09%]','Real compressed screenshot must preserve the percentage and exclude the panel border');assert.equal(MapleHudOcr.percentageReading(exp.text,1209994).exp,1114283);}
  if(fixture.level==='44'&&scale===1){assert.equal(text,'44','Blended tile seams must preserve both digits');assert.equal(MapleHudOcr.resolveReading(exp,428280).text,expected,'Level 44 must uniquely validate the EXP percentage');}
  if(fixture.level==='32'&&scale===1){assert.equal(text,'32');assert.equal(exp.text,'412[0.34%]','Resized HUD must exclude the clipped EXP label and retain its decimal point');}
 }
 const tracked=R.detect(f,L,MapleHudOcr,{...regions,width:f.width,height:f.height});assert.ok(tracked.level);
 count++;
}
const blank={width:800,height:600,data:new Uint8ClampedArray(800*600*4)};
assert.deepEqual(R.detect(blank,L,MapleHudOcr),{level:null,exp:null});
const f=frame(fixtures[1]),before=R.detect(f,L,MapleHudOcr),moved=frame(fixtures[1],1,90,-20),after=R.detect(moved,L,MapleHudOcr,{...before,width:f.width,height:f.height});
assert.ok(after.level.x*moved.width>before.level.x*f.width+80,'Resize/move must reacquire the HUD');
const shifted=frame(fixtures[1],1,-90,-20),reacquired=R.detect(shifted,L,MapleHudOcr,{...before,width:f.width,height:f.height});
assert.ok(reacquired.level.x*shifted.width<before.level.x*f.width-80,'A move within the same surface must reacquire the HUD');
const orphan=frame({...fixtures[1],patches:[]});
const levelTile=require('./level56-fixture.json');
for(let y=0;y<levelTile.height;y++)orphan.data.set(levelTile.data.slice(y*levelTile.width*4,(y+1)*levelTile.width*4),((orphan.height-50+y)*orphan.width+20)*4);
assert.equal(R.detect(orphan,L,MapleHudOcr).level,null,'Orange tiles without the LV label are not a level HUD');
const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('index.html','utf8'),calibration={auto:false,level:{x:.1,y:.2,w:.1,h:.1},exp:{x:.4,y:.5,w:.2,h:.1}},context={state:{calibration}};
vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function currentRegions('),html.indexOf('\nfunction cropForOcr')),context);
assert.equal(context.currentRegions({}),calibration,'Custom regions must bypass automatic detection');
assert.ok(html.includes(fs.readFileSync('hud-regions.js','utf8')),'The deployed detector must match its tested source');
console.log(`HUD detection: ${count} real-crop layouts at multiple scales/positions, tracking, reacquisition and blank rejection passed.`);
