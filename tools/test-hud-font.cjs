const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
require('../hud-ocr.js');
const fixtures=require('./hud-font-fixtures.json');let exact=0,heldOut=0,rejected=0;
for(const [i,f] of fixtures.entries()){
 const r=MapleHudOcr.recognize(f),actual=r.text.replace(/\[|\]/g,'|').replace(/\|$/,'').replace(/,/g,'.'),expected=f.expected.replace(/,/g,'.');
 if(actual===expected){exact++;if(!f.training)heldOut++;}else{assert.ok(r.text.includes('?'),`Fixture ${i} silently misread ${expected}: ${r.text}`);rejected++;}
}
const obs=MapleHudOcr.recognize(require('./obs-font-fixture.json'));
assert.equal(obs.text,'2.304[2.12%]');
assert.equal(MapleHudOcr.recognize(require('./current-font-fixture.json')).text,'14.909[13.74%]');
assert.equal(MapleHudOcr.recognize({width:100,height:16,data:new Uint8Array(100*16*4)}).text,'');
const html=fs.readFileSync('index.html','utf8');
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const context={};vm.createContext(context);vm.runInContext(html.slice(html.indexOf('function parseHudReading'),html.indexOf('async function runOcr')),context);
assert.equal(context.parseHudReading('LV. 31',obs.text).expToken,'2,304');
assert.equal(context.parseHudReading('LV. 31',obs.text).pctToken,'2.12');
assert.ok(html.includes('&&!expResult.uncertain'),'Uncertain glyphs must block sample acceptance');
console.log(`${exact}/30 exact, ${rejected} safely rejected; ${heldOut}/${fixtures.filter(f=>!f.training).length} held-out frames exact; both OBS frames, blank crop, parser and syntax checks passed.`);
