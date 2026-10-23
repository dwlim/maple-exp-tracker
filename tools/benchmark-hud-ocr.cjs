// Manual CPU comparison; timing is deliberately not a CI pass/fail condition.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fixtures=require('./hud-font-fixtures.json');
const baseline=process.argv[2]||'0eeaa56';
function load(source){const context={};vm.runInNewContext(source,context);return context.MapleHudOcr;}
const before=load(execFileSync('git',['show',baseline+':hud-ocr.js'],{encoding:'utf8'}));
const after=load(fs.readFileSync('hud-ocr.js','utf8'));
for(const fixture of fixtures)assert.equal(JSON.stringify(after.recognize(fixture)),JSON.stringify(before.recognize(fixture)),'Text, confidence and candidate details must remain identical');
const timings={};
for(const [name,reader] of [['before',before],['after',after]]){
 const start=performance.now();
 for(let repeat=0;repeat<3;repeat++)for(const fixture of fixtures)reader.recognize(fixture);
 timings[name]=Math.round(performance.now()-start);
}
console.log(JSON.stringify({baseline,reads:fixtures.length*3,beforeMs:timings.before,afterMs:timings.after,speedup:Number((timings.before/timings.after).toFixed(2)),identicalResults:true},null,2));
