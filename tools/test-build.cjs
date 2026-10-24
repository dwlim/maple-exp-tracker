const assert=require('node:assert/strict'),fs=require('node:fs'),{render}=require('./embed-script.cjs');
const html=fs.readFileSync('index.html','utf8'),source=fs.readFileSync('hud-regions.js','utf8'),next=render(html,'HUD REGIONS',source);
assert.equal(render(next,'HUD REGIONS',source),next,'Embedding must be idempotent');
const order=s=>[...s.matchAll(/<!-- ([A-Z ]+) START -->/g)].map(m=>m[1]);assert.deepEqual(order(next),order(html),'Rebuilding a module must preserve script order');
assert.equal(next.slice(next.indexOf('</head>')),html.slice(html.indexOf('</head>')),'Embedding never changes application code or markup');
assert.throws(()=>render('<head></head>','HUD REGIONS',source),/Missing or duplicate/);
console.log('Build: deterministic embedding, module order, application preservation and missing markers passed.');
