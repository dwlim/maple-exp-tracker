const fs=require('node:fs'),L=require('../level-ocr.js');const fixtures=require('./level-font-fixtures.local.json'),templates=[];
for(const f of fixtures)if(f.training){const b=L.findTiles(f);if(!b||b.tiles.length!==f.expected.length)throw Error('Tile count mismatch for '+f.expected);for(const [i,tile] of b.tiles.entries()){const g=L.softMask(f,tile,b);if(!g)throw Error('Missing glyph');templates.push({...g,text:f.expected[i],...(f.minHeight?{minHeight:f.minHeight}:{})});}}
if(new Set(templates.map(t=>t.text)).size!==10)throw Error('Need all ten digits');
let source=fs.readFileSync('level-ocr.js','utf8');source=source.replace(/\/\* LEVEL_TEMPLATES_START \*\/[\s\S]*?\/\* LEVEL_TEMPLATES_END \*\//,'/* LEVEL_TEMPLATES_START */const templates='+JSON.stringify(templates)+';/* LEVEL_TEMPLATES_END */');fs.writeFileSync('level-ocr.js',source);
require('./embed-script.cjs').write('LEVEL FONT',source);console.log('Built '+templates.length+' level templates covering all ten digits.');
