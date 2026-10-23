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
  if(fixture.percentageOnly&&scale===1){assert.equal(text,fixture.level);assert.equal(exp.text,fixture.exp,'Real compressed screenshot must preserve the percentage and exclude the panel border');assert.equal(MapleHudOcr.percentageReading(exp.text,fixture.requiredExp||1209994).exp,fixture.estimatedExp||1114283);}
  if(fixture.level==='44'&&scale===1){assert.equal(text,'44','Blended tile seams must preserve both digits');assert.equal(MapleHudOcr.resolveReading(exp,428280).text,expected,'Level 44 must uniquely validate the EXP percentage');}
  if(fixture.level==='32'&&scale===1){assert.equal(text,'32');assert.equal(exp.text,'412[0.34%]','Resized HUD must exclude the clipped EXP label and retain its decimal point');}
 }
 const tracked=R.detect(f,L,MapleHudOcr,{...regions,width:f.width,height:f.height});assert.ok(tracked.level);
 count++;
}
// Localization must survive unreadable glyphs without turning them into accepted data.
const labelled=frame(fixtures.find(f=>f.level==='68'));
const cached=R.detect(labelled,L,MapleHudOcr),noOcr={recognize(){throw Error('Stable layout must not rerun OCR during localization');}};
assert.deepEqual(R.detect(labelled,noOcr,noOcr,{...cached,width:labelled.width,height:labelled.height}),cached,'Validate cached labels before any full-frame search');
const uncertainOcr={...MapleHudOcr,recognize:image=>{const r=MapleHudOcr.recognize(image);return r.text==='[54.37%]'?{...r,text:'[?437%]'}:r;}};
assert.ok(R.detect(labelled,L,uncertainOcr).exp,'A labelled percentage HUD must remain located when a digit or decimal is unclear');
assert.equal(MapleHudOcr.percentageReading('[?437%]',1854143),null,'Locating an uncertain percentage must not make it valid');
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
// Static native controls register a scaled HUD independently of OCR output.
for(const c of require('./hud-anchor-fixtures.json'))for(const scale of [.75,1,1.5]){
 const rgba=require('node:zlib').inflateSync(Buffer.from(c.rgba,'base64'));
 const f=frame({width:c.width,height:c.height,patches:[{x:c.x,y:c.y,width:c.w,height:c.h,data:rgba}]},scale,35,-15);
 const anchor=R.anchors(f);assert.equal(anchor.length,1,`Cash Shop alignment: ${c.name} at ${scale}`);
 const regions=R.detect(f,L,MapleHudOcr);assert.ok(regions.level&&regions.exp,'Registered HUD must locate both fields');
 assert.ok(regions.level.x<regions.exp.x&&regions.exp.x*f.width<anchor[0].x);
 // Remove the neighboring controls: a lone red panel must not register a HUD.
 const b=anchor[0];for(let y=Math.floor(b.y);y<Math.min(f.height,Math.ceil(b.y+b.h));y++)for(let x=Math.floor(b.x+b.w);x<Math.min(f.width,Math.ceil(b.x+b.w*3.2));x++)f.data.fill(0,(y*f.width+x)*4,(y*f.width+x)*4+4);
 assert.equal(R.anchors(f).length,0,'Cash Shop color alone is insufficient');
}
const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('index.html','utf8'),calibration={auto:false,level:{x:.1,y:.2,w:.1,h:.1},exp:{x:.4,y:.5,w:.2,h:.1}},context={state:{calibration}};
vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function currentRegions('),html.indexOf('\nfunction cropForOcr')),context);
assert.equal(context.currentRegions({}),calibration,'Custom regions must bypass automatic detection');
assert.ok(html.includes(fs.readFileSync('hud-regions.js','utf8')),'The deployed detector must match its tested source');
console.log(`HUD detection: ${count} real-crop layouts at multiple scales/positions, tracking, reacquisition and blank rejection passed.`);
