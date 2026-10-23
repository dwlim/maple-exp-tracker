// Independent, visually labelled stream captures. Never consumed by font generators.
const fs=require('node:fs'),R=require('../hud-regions'),L=require('../level-ocr');require('../hud-ocr');
const results=[];
for(const f of require('./stream-holdout-fixtures.json')){
 const frame={width:f.width,height:f.height,data:new Uint8ClampedArray(f.width*f.height*4)};
 for(const p of f.patches)for(let y=0;y<p.height;y++)frame.data.set(p.data.slice(y*p.width*4,(y+1)*p.width*4),((p.y+y)*f.width+p.x)*4);
 const regions=R.detect(frame,L,MapleHudOcr),crop=r=>R.crop(frame,{x:Math.round(r.x*f.width),y:Math.round(r.y*f.height),w:Math.round(r.w*f.width),h:Math.round(r.h*f.height)});
 const level=regions.level?L.recognize(crop(regions.level)).data.text:null,exp=regions.exp?MapleHudOcr.recognize(crop(regions.exp)).text:null;
 const readable=level&&exp&&!level.includes('?')&&!exp.includes('?'),exact=level===f.level&&exp===f.exp;
 results.push({name:f.name,expected:{level:f.level,exp:f.exp},actual:{level,exp},status:exact?'pass':readable?'wrong':'rejected'});
}
const report={total:results.length,passed:results.filter(r=>r.status==='pass').length,rejected:results.filter(r=>r.status==='rejected').length,wrong:results.filter(r=>r.status==='wrong').length,results};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--write-report'))fs.writeFileSync('tools/stream-holdout-baseline.json',JSON.stringify(report,null,2)+'\n');
if(report.wrong||process.argv.includes('--strict')&&report.rejected)process.exitCode=1;
