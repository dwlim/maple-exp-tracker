const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),html=fs.readFileSync('index.html','utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function levelHudBounds'),html.indexOf('function cropLevelDigits')),ctx);
const bounds=ctx.levelHudBounds(require('./level-bounds-fixture.json'));assert.equal(bounds.tiles.length,2);assert.ok(bounds.tiles[0].right<=bounds.tiles[1].left);
const r=(text,confidence=90)=>({data:{text,confidence}});
assert.equal(ctx.levelDigitConsensus([r('3'),r('1'),r('3')]).text,'3');
assert.equal(ctx.levelDigitConsensus([r('3'),r('8'),r('')]).text,'?');
assert.equal(ctx.levelDigitConsensus([r('3',10),r('3',10),r('1')]).text,'?');
(async()=>{
 const modes=[],results=[r('3'),r('1'),r('3'),r('1'),r('1'),r('1')],worker={setParameters:async p=>modes.push(p.tessedit_pageseg_mode),recognize:async()=>results.shift()};
 const result=await ctx.readLevel(worker,{tileVariants:[[1,2,3],[4,5,6]]});assert.equal(result.data.text,'31');assert.equal(results.length,0);assert.equal(modes[0],'10');
 const uncertain=[r('3'),r('8'),r(''),r('1'),r('1'),r('1')];worker.recognize=async()=>uncertain.shift();assert.equal((await ctx.readLevel(worker,{tileVariants:[[1,2,3],[4,5,6]]})).data.text,'?1');
 console.log('Level tile detection, 31 single-digit recognition, consensus, confidence and disagreement rejection checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
