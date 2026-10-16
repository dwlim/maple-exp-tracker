const fs=require('node:fs');
const templates=JSON.parse(fs.readFileSync('tools/hud-font-templates.json'));
const source=`/* Digit shapes extracted from local Classic HUD screenshots. */\n(function(root){\nconst templates=${JSON.stringify(templates)};\n${recognize.toString()}\nroot.MapleHudOcr={recognize};\n})(typeof window==='undefined'?globalThis:window);\n`;
fs.writeFileSync('hud-ocr.js',source);
let html=fs.readFileSync('index.html','utf8');
html=html.replace(/<!-- HUD FONT START -->[\s\S]*?<!-- HUD FONT END -->\s*/,'');
html=html.replace('</head>','<!-- HUD FONT START -->\n<script>'+source+'</script>\n<!-- HUD FONT END -->\n</head>');
fs.writeFileSync('index.html',html);
function recognize(image){
 const {width:w,height:h,data}=image,mask=new Uint8Array(w*h),green=new Uint8Array(w);
 for(let x=0;x<w;x++){
  let count=0;
  for(let y=0;y<h;y++){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(g-r>12&&g-b>20)count++;mask[y*w+x]=Math.min(r,g,b)>155&&Math.max(r,g,b)-Math.min(r,g,b)<65&&g-r<15?1:0;}
  if(count>=2){green[x]=1;for(let y=0;y<h;y++)mask[y*w+x]=0;}
 }
 const greenGroups=[];let gs=null,gl=-1;
 for(let x=0;x<w;x++)if(green[x]){if(gs===null)gs=x;else if(x-gl>3){greenGroups.push([gs,gl+1]);gs=x;}gl=x;}
 if(gs!==null)greenGroups.push([gs,gl+1]);
 const end=greenGroups.length>=2?greenGroups[1][0]:w;
 const spans=[];let start=null;
 for(let x=0;x<=end;x++){let on=false;if(x<end)for(let y=0;y<h;y++)on ||= !!mask[y*w+x];if(on&&start===null)start=x;if(!on&&start!==null){spans.push([start,x]);start=null;}}
 let text='',scores=[],details=[];
 for(const [left,right] of spans){
  let top=h,bottom=0;for(let y=0;y<h;y++)for(let x=left;x<right;x++)if(mask[y*w+x]){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  const gw=right-left,gh=bottom-top;
  if(gh< h*.35){text+=gw/gh>1.8?'?':'.';continue;}
  const candidates=[];
  for(const t of templates){if(t.char==='.'||t.char===',')continue;const th=t.rows.length,tw=t.rows[0].length;let diff=0,n=0;
   for(let y=0;y<14;y++)for(let x=0;x<14;x++){const a=mask[(top+Math.min(gh-1,Math.floor((y+.5)*gh/14)))*w+left+Math.min(gw-1,Math.floor((x+.5)*gw/14))],b=t.rows[Math.min(th-1,Math.floor((y+.5)*th/14))][Math.min(tw-1,Math.floor((x+.5)*tw/14))]==='1'?1:0;diff+=a!==b;n++;}
   candidates.push({char:t.char,error:diff/n+Math.abs(gw/gh-tw/th)*.15});
  }
  candidates.sort((a,b)=>a.error-b.error);const best=candidates[0],second=candidates.find(c=>c.char!==best.char),margin=second.error-best.error;
  const char=best.error<.25&&margin>.035?best.char:'?';text+=char;scores.push(1-best.error);details.push({char,error:best.error,margin,left,right});
 }
 // Brackets are green, so reinsert them by their position between white glyphs.
 const opening=green.findIndex(v=>v);if(opening>=0){let before=0;for(const [left] of spans)if(left<opening)before++;text=text.slice(0,before)+'['+text.slice(before)+']';}
 return {text,confidence:scores.length?Math.min(...scores)*100:0,details};
}
if(require.main===module){
 const fixtures=JSON.parse(fs.readFileSync('tools/hud-font-fixtures.json'));let passed=0;
 for(const [i,f] of fixtures.entries()){const r=recognize(f);const actual=r.text.replace(/\[|\]/g,'|').replace(/\|$/,'').replace(/,/g,'.');const expected=f.expected.replace(/,/g,'.');if(actual===expected)passed++;else console.log(i,f.expected,r.text,JSON.stringify(r.details.filter(d=>d.char==='?')));}
 console.log(`${passed}/${fixtures.length} exact matches`);
}
