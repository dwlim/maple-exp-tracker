const fs=require('node:fs');require('../hud-ocr.js');
const fixtures=require('./hud-font-fixtures.json').map(f=>({...f,expected:f.expected.replace('|','[')+']'}));
for(const [file,expected] of [['obs-font-fixture.json','2.304[2.12%]'],['current-font-fixture.json','14.909[13.74%]'],['eight-font-fixture.json','21.892[20.18%]'],['nine-font-fixture-bright.json','19.421[17.90%]']])fixtures.push({...require('./'+file),expected});
const changes=[['original',v=>v],['dim15',v=>v*.85],['dim5',v=>v*.95],['bright5',v=>v*1.05],['bright15',v=>v*1.15],['gamma08',v=>255*(v/255)**.8],['gamma12',v=>255*(v/255)**1.2]];
let exact=0,rejected=0,wrong=0,failures=[];
for(const [i,f] of fixtures.entries())for(const [name,fn] of changes){const data=f.data.map((v,j)=>j%4===3?v:Math.round(Math.max(0,Math.min(255,fn(v))))),r=MapleHudOcr.recognize({...f,data}),expected=f.expected.replace(/,/g,'.');if(r.text===expected)exact++;else if(r.text.includes('?')||!/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(r.text))rejected++;else{wrong++;failures.push({fixture:i,change:name,expected,actual:r.text});}}
console.log(JSON.stringify({total:fixtures.length*changes.length,exact,rejected,wrong,failures},null,2));
if(process.argv.includes('--strict')&&wrong)process.exitCode=1;
